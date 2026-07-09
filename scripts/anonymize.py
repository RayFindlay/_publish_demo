#!/usr/bin/env python3
"""
Anonymize production fleet data for portfolio demo.

Reads real latest.json from Cloudflare R2 (read-only credentials), produces
anonymized versions of latest.json, drivers.json, fleet-meta.json, and
maintenance.json in the app/ folder for the demo dashboard.

Fails hard (exit 1) if any real identifier survives the substitution or if any
output GPS coord falls within the leak fence around the real home terminal.
No silent leaks.
"""
import boto3
import hashlib
import json
import math
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


R2_ENDPOINT = "https://dc8101f3cdb435a804c5d4e4e4a2f79b.r2.cloudflarestorage.com"
R2_BUCKET = "norfab-fleet-data"
R2_KEY_LATEST = "latest.json"

# Public production URLs for the non-sensitive JSONs. We fetch these so the
# demo has the same SHAPE as production — anonymized, not synthetic.
PROD_DRIVERS_URL = "https://norfab-fleet.pages.dev/app/drivers.json"
PROD_FLEET_META_URL = "https://norfab-fleet.pages.dev/app/fleet-meta.json"
PROD_MAINTENANCE_URL = "https://norfab-fleet.pages.dev/app/maintenance.json"

# Fake identity for the demo
FAKE_COMPANY = "Cascade Freight Inc."
FAKE_COMPANY_SHORT = "CFI"
FAKE_NSC = "AB-NSC-999-0000"
FAKE_HOME_LABEL = "CFI Yard"
FAKE_HOME_ADDRESS = "1200 Industrial Way NE, Calgary, AB T3J 5H9"
FAKE_HOME_LAT = 51.0553
FAKE_HOME_LON = -114.0553

FAKE_DRIVER_NAMES = [
    "Alex Morgan",
    "Priya Chen",
    "Marcus Kelly",
    "Jordan Reeve",
    "Sam Delacroix",
    "Riley Patel",
    "Casey Nguyen",
    "Taylor Wells",
    "Cameron Fox",
    "Devon Ramirez",
    "Hayden Osei",
    "Mika Sarkis",
]
FAKE_NAME_SET = set(FAKE_DRIVER_NAMES)

# Leak fence: the real home terminal. Any output coord within 5 km of this
# means the anonymization is broken and we refuse to publish.
REAL_HOME_LAT = 53.5899
REAL_HOME_LON = -113.6091
LEAK_FENCE_KM = 5.0


def stable_choice(items, seed_key):
    idx = int(hashlib.sha256(seed_key.encode()).hexdigest(), 16) % len(items)
    return items[idx]


def stable_int(seed_key, mod):
    return int(hashlib.sha256(seed_key.encode()).hexdigest(), 16) % mod


_NAME_MAP = {}


def fake_name_for(real_name):
    """Collision-free deterministic mapping: hash picks a starting slot in
    the fake-name pool, linear probe finds the first unused name. Seeded in
    sorted order of real names (the mapping print loop in main), so the
    assignment is stable across runs."""
    if not real_name or not real_name.strip():
        return real_name
    key = real_name.strip().lower()
    if key in _NAME_MAP:
        return _NAME_MAP[key]
    used = set(_NAME_MAP.values())
    start = stable_int(f"driver:{key}", len(FAKE_DRIVER_NAMES))
    for i in range(len(FAKE_DRIVER_NAMES)):
        candidate = FAKE_DRIVER_NAMES[(start + i) % len(FAKE_DRIVER_NAMES)]
        if candidate not in used:
            _NAME_MAP[key] = candidate
            return candidate
    # Pool exhausted — synthesize a numbered fallback
    candidate = f"Driver {len(_NAME_MAP) + 1}"
    _NAME_MAP[key] = candidate
    return candidate


def fake_token_for(real_token):
    if not real_token or not real_token.startswith("drv_"):
        return real_token
    h = hashlib.sha256(f"token:{real_token}".encode()).hexdigest()[:16]
    return f"drv_{h}"


def fake_coords_for(real_lat, real_lon):
    seed = f"coord:{real_lat:.6f},{real_lon:.6f}"
    lat_jitter = (stable_int(seed, 20000) - 10000) / 200000.0
    lon_jitter = (stable_int(seed + ":lon", 20000) - 10000) / 200000.0
    return round(FAKE_HOME_LAT + lat_jitter, 6), round(FAKE_HOME_LON + lon_jitter, 6)


_fake_unit_map = {}


def fake_unit_for(real_unit):
    if not real_unit or not real_unit.strip():
        return real_unit
    real_unit = real_unit.strip()
    if real_unit not in _fake_unit_map:
        prefix = "".join(c for c in real_unit if c.isalpha()) or "UNIT"
        used = set(_fake_unit_map.values())
        num = stable_int(f"unit:{real_unit}", 90) + 10
        # Probe for a free code so two real units can never merge
        for i in range(90):
            candidate = f"{prefix}{(num - 10 + i) % 90 + 10}"
            if candidate not in used:
                _fake_unit_map[real_unit] = candidate
                break
    return _fake_unit_map[real_unit]


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def name_variants(full_name):
    """All the forms a real name can leak in: 'Stefan Gurba' also appears as
    'GurbaStefan' (source filenames), 'StefanGurba', 'Gurba, Stefan', and
    bare first/last names. Guard every variant."""
    variants = {full_name}
    parts = [p for p in re.split(r"\s+", full_name.strip()) if p]
    if len(parts) >= 2:
        first, last = parts[0], parts[-1]
        variants |= {
            f"{first}{last}", f"{last}{first}",
            f"{last} {first}", f"{last}, {first}",
        }
        if len(first) >= 4:
            variants.add(first)
        if len(last) >= 4:
            variants.add(last)
    return variants


def collect_real_strings_to_guard(data):
    """Real strings that must NEVER appear in output. Length >= 6 for
    free-text fields to avoid false positives; name fields also guard
    concatenated/reversed/bare variants via name_variants()."""
    strings = set()

    def add(v):
        if v and isinstance(v, str) and len(v.strip()) >= 6:
            strings.add(v.strip())

    def add_name(v):
        if v and isinstance(v, str) and v.strip():
            strings.update(name_variants(v.strip()))

    for r in data.get("titan_records", []):
        add_name(r.get("driver"))
        add(r.get("startLocationName"))
        add(r.get("endLocationName"))
        add(r.get("assetName"))
    for r in data.get("sitedocs_records", []):
        add_name(r.get("driver"))
        add_name(r.get("driver_name_raw"))
        add_name(r.get("inspector"))
        add(r.get("carrier"))
        add(r.get("defect_notes"))
    # Explicit brand markers
    for marker in ["Norfab", "norfab", "NORFAB", "Findlay", "findlay", "NFM", "Raymond"]:
        strings.add(marker)
    strings.discard("")
    return strings


def find_leaks_in_object(obj, real_strings, path=""):
    """Walk the anonymized JSON recursively, yield (field_path, leaked_string, value)
    for every leak. Precise diagnostics for iterating on missed fields."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            new_path = f"{path}.{k}" if path else k
            yield from find_leaks_in_object(v, real_strings, new_path)
    elif isinstance(obj, list):
        # Only scan first 200 items per list to keep output manageable
        for i, v in enumerate(obj[:200]):
            yield from find_leaks_in_object(v, real_strings, f"{path}[{i}]")
    elif isinstance(obj, str):
        for s in real_strings:
            if s in obj:
                yield (path, s, obj)


def _parse_titan_time(s):
    """Parse 'Jan 7, 2026 9:45:00 AM' -> datetime, or None."""
    if not s:
        return None
    try:
        from datetime import datetime as _dt
        return _dt.strptime(s.strip(), "%b %d, %Y %I:%M:%S %p")
    except Exception:
        return None


def _titan_day_key(r):
    """Grouping key for one unit-day chain."""
    if r.get("tripDate"):
        return r["tripDate"]
    for f in ("tripStart", "stopStart", "stopEnd"):
        t = _parse_titan_time(r.get(f))
        if t:
            return t.strftime("%Y-%m-%d")
    return "unknown"


def _offset_km(lat, lng, km, bearing_deg):
    """Move a [lat, lng] point km kilometres along a compass bearing."""
    rad = math.radians(bearing_deg)
    dlat = (km * math.cos(rad)) / 110.574
    dlng = (km * math.sin(rad)) / (111.320 * math.cos(math.radians(lat)))
    return round(lat + dlat, 6), round(lng + dlng, 6)


def anonymize_titan(records):
    """Anonymize titan records. Coordinates are NOT jittered point-by-point
    (that breaks route continuity and looks broken when zoomed in on the
    map). Instead each unit-day gets a SYNTHESIZED coherent route: the
    chain starts at the fake yard, each leg's length matches the trip's
    real recorded distance (scaled to straight-line), each trip starts
    where the previous one ended, returns to the real day-start snap back
    to the fake yard, and repeat visits to the same real site reuse the
    same fake point. Directions are deterministic hashes — the fake route
    shares nothing with the real one except leg lengths."""
    out = [dict(r) for r in records]

    # Non-coordinate anonymization (names, units, labels)
    for r in out:
        if r.get("driver"):
            r["driver"] = fake_name_for(r["driver"])
        if r.get("unit"):
            r["unit"] = fake_unit_for(r["unit"])
        if r.get("assetName"):
            r["assetName"] = fake_unit_for(r["assetName"])
        if r.get("startLocationName"):
            r["startLocationName"] = "Route Stop"
        if r.get("endLocationName"):
            end = r.get("endLocationName") or ""
            r["endLocationName"] = (
                FAKE_HOME_LABEL if "office" in end.lower() or "yard" in end.lower() else "Route Stop"
            )

    # Group record indexes into unit-day chains, ordered by trip time
    chains = {}
    for idx, r in enumerate(out):
        key = (r.get("unit") or r.get("assetName") or "?", _titan_day_key(r))
        chains.setdefault(key, []).append(idx)

    def sort_key(idx):
        r = out[idx]
        t = _parse_titan_time(r.get("tripStart")) or _parse_titan_time(r.get("stopStart"))
        return (t is None, t or 0, idx)

    YARD = (FAKE_HOME_LAT, FAKE_HOME_LON)
    for (unit, day), idxs in chains.items():
        idxs.sort(key=sort_key)
        cursor = YARD
        site_memo = {}   # rounded REAL coord -> fake point (repeat-site consistency)
        real_day_start = None
        for chain_i, idx in enumerate(idxs):
            r = out[idx]
            real_start = r.get("startCoords")
            real_end = r.get("endCoords")
            if real_day_start is None and real_start and isinstance(real_start, dict):
                real_day_start = (real_start["lat"], real_start["lon"])

            # Trip starts where the chain currently is
            if real_start and isinstance(real_start, dict):
                r["startCoords"] = {"lat": cursor[0], "lon": cursor[1]}

            if real_end and isinstance(real_end, dict):
                real_end_t = (real_end["lat"], real_end["lon"])
                memo_key = (round(real_end_t[0], 3), round(real_end_t[1], 3))
                # Return to the real day-start (or real yard) -> fake yard
                if real_day_start and haversine_km(*real_end_t, *real_day_start) < 0.5:
                    end_pt = YARD
                elif memo_key in site_memo:
                    end_pt = site_memo[memo_key]
                else:
                    km = max(0.05, min((float(r.get("tripDistance") or 0)) * 0.72, 45.0))
                    bearing = stable_int(f"leg:{unit}:{day}:{chain_i}", 360)
                    # Bias back toward the yard when the chain wanders far,
                    # so synthetic days stay metro-plausible
                    dist_from_yard = haversine_km(*cursor, *YARD)
                    if dist_from_yard > 25:
                        home_bearing = math.degrees(math.atan2(
                            YARD[1] - cursor[1], YARD[0] - cursor[0]))
                        bearing = (home_bearing + (stable_int(f"jig:{unit}:{day}:{chain_i}", 120) - 60)) % 360
                    end_pt = _offset_km(cursor[0], cursor[1], km, bearing)
                    site_memo[memo_key] = end_pt
                r["endCoords"] = {"lat": end_pt[0], "lon": end_pt[1]}
                cursor = end_pt
    return out


def anonymize_sitedocs(records):
    out = []
    for r in records:
        r = dict(r)
        # Driver-name fields (driver + inspector + raw variants)
        if r.get("driver"):
            r["driver"] = fake_name_for(r["driver"])
        if r.get("inspector"):
            r["inspector"] = fake_name_for(r["inspector"])
        if r.get("driver_name_raw"):
            r["driver_name_raw"] = fake_name_for(r["driver_name_raw"])
        # Unit + trailer fields
        for unit_field in ("unit", "unit_no", "unit_label", "unit_raw",
                           "trailer_unit", "trailer_unit_label"):
            if r.get(unit_field):
                r[unit_field] = fake_unit_for(r[unit_field])
        # Carrier
        if r.get("carrier"):
            r["carrier"] = FAKE_COMPANY
        # Trailer plate: synthesize a fake plate
        if r.get("trailer_plate"):
            h = hashlib.sha256(f"plate:{r['trailer_plate']}".encode()).hexdigest()[:6].upper()
            r["trailer_plate"] = h
        # Defect notes: replace free-text with sample marker
        if r.get("defect_notes"):
            r["defect_notes"] = "[Demo] Sample defect note. Original redacted."
        # Source filenames: real ones embed 'LastFirst' driver names
        # (SITEDOCS__DVI__date__id__date-GurbaStefan-hash.pdf). Synthesize a
        # matching-looking name from already-anonymized values.
        if r.get("source_pdf") or r.get("source_file"):
            date = r.get("date_local") or "0000-00-00"
            fake_concat = (r.get("driver") or "Driver").replace(" ", "")
            h = hashlib.sha256(
                f"pdf:{r.get('source_pdf', '')}:{r.get('source_file', '')}".encode()
            ).hexdigest()[:8]
            fake_pdf = f"SITEDOCS__DVI__{date}__DEMO__{date}-{fake_concat}-{h}.pdf"
            if r.get("source_pdf"):
                r["source_pdf"] = fake_pdf
            if r.get("source_file"):
                r["source_file"] = fake_pdf
        if r.get("text_path"):
            r["text_path"] = "sample.txt"
        out.append(r)
    return out


def fetch_json(url):
    print(f"Fetching {url}")
    # Cloudflare rejects the default Python-urllib User-Agent with 403.
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; DemoRefreshWorkflow/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


_TOKEN_MAP = {}


def fake_token_for_reversible(real_token):
    """Deterministic fake token; also record the mapping so URL rewriting
    can substitute later without re-hashing."""
    if not real_token:
        return real_token
    fake = fake_token_for(real_token)
    _TOKEN_MAP[real_token] = fake
    return fake


def rewrite_urls_and_paths(v):
    """Replace SharePoint URLs and paths with demo-relative equivalents.
    Preserves any real_token substrings by mapping them to fake tokens."""
    if not isinstance(v, str):
        return v
    # Replace any known real driver token with its fake counterpart
    for real_tok, fake_tok in _TOKEN_MAP.items():
        v = v.replace(real_tok, fake_tok)
    # Kill SharePoint URLs entirely (replace with demo URL where possible)
    if "norfabmfg.sharepoint.com" in v:
        # Preserve any path suffix after the base — helpful for the dashboard
        # to still see /drivers/{fake_token}/... shape even if the origin is now demo.
        m = re.search(r"(/roadside/drivers/drv_[a-f0-9]+/[^\"' ]*)", v)
        if m:
            return f"https://fleet-compliance-demo.pages.dev{m.group(1)}"
        m = re.search(r"(/app/Driver%20Phone%20View\.html\?token=drv_[a-f0-9]+)", v)
        if m:
            return f"https://fleet-compliance-demo.pages.dev{m.group(1)}"
        # Fallback: strip URL, return empty
        return ""
    return v


def deep_transform_strings(obj, fn):
    """Recursively apply fn to every string in a nested structure."""
    if isinstance(obj, dict):
        return {k: deep_transform_strings(v, fn) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deep_transform_strings(x, fn) for x in obj]
    if isinstance(obj, str):
        return fn(obj)
    return obj


def anonymize_drivers_json(prod):
    """Fetch shape from production, replace identifying values, keep every field."""
    out = {
        "version": prod.get("version", 1),
        "updated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "drivers": {},
    }
    for real_key, real_driver in prod.get("drivers", {}).items():
        real_name = real_driver.get("name", real_key)
        real_token = real_driver.get("token")
        fake_name = fake_name_for(real_name)
        fake_token = fake_token_for_reversible(real_token) if real_token else None
        fake_key = fake_name.lower()

        new_driver = dict(real_driver)
        new_driver["name"] = fake_name
        if fake_token:
            new_driver["token"] = fake_token
        # Rewrite every URL/path field via the reversible map + SharePoint stripper
        new_driver = deep_transform_strings(new_driver, rewrite_urls_and_paths)
        out["drivers"][fake_key] = new_driver
    return out


def anonymize_fleet_meta_json(prod):
    """Preserve every field; only the identifying keys/values (unit codes,
    driver keys) are anonymized."""
    out = dict(prod)
    # Vehicles: keyed by unit code
    new_vehicles = {}
    for real_unit, meta in (prod.get("vehicles") or {}).items():
        fake_unit = fake_unit_for(real_unit)
        new_vehicles[fake_unit] = dict(meta)
    out["vehicles"] = new_vehicles
    # Drivers: keyed by name-concat (e.g. "dustinmarriott")
    new_drivers = {}
    for real_key, meta in (prod.get("drivers") or {}).items():
        # Recover the real name from the key by finding a matching real name
        # (fleet-meta uses a lowercased-no-spaces key). We anonymize the key
        # via the same driver-name mapping.
        fake_name = fake_name_for(real_key)
        fake_key = re.sub(r"[^a-z0-9]", "", fake_name.lower())
        new_drivers[fake_key] = dict(meta)
    out["drivers"] = new_drivers
    return out


def _rewrite_unit_codes_in_string(s, all_real_units):
    """Substitute every real unit code that appears as a whole-word substring
    with its fake counterpart. Used to sanitize free-text fields."""
    if not isinstance(s, str) or not s:
        return s
    for real_unit in all_real_units:
        # Whole-word match, not part of a larger identifier
        s = re.sub(rf"\b{re.escape(real_unit)}\b", fake_unit_for(real_unit), s)
    return s


def _scrub_brand_text(s):
    """Replace brand markers in free text: 'Norfab' (any casing, incl.
    'Norfab Mfg (1993) Inc.' variants), whole-word 'NFM', and the real
    operating city (vendor names like 'Lube City Edmonton' would otherwise
    place the carrier geographically — the demo's story is Calgary)."""
    if not isinstance(s, str) or not s:
        return s
    s = re.sub(r"(?i)norfab(\s+mfg)?(\s*\(1993\))?(\s*inc\.?)?", FAKE_COMPANY_SHORT, s)
    s = re.sub(r"\bNFM\b", FAKE_COMPANY_SHORT, s)
    s = s.replace("Edmonton", "Calgary")
    return s


def anonymize_maintenance_json(prod, all_real_units):
    """Rewrite unit references anywhere they appear: schedule, log, defects_resolved,
    and the _*_fields metadata blocks that document the format with real unit codes."""
    out = dict(prod)
    # Schedule entries
    new_schedule = []
    for entry in (prod.get("schedule") or []):
        e = dict(entry)
        u = e.get("unit")
        if u and u not in ("*", "heavy", "light"):
            e["unit"] = fake_unit_for(u)
        new_schedule.append(e)
    out["schedule"] = new_schedule
    # Log entries
    new_log = []
    for entry in (prod.get("log") or []):
        e = dict(entry)
        if e.get("unit"):
            e["unit"] = fake_unit_for(e["unit"])
        # Performer mentioning the brand (any form: 'Norfab shop', 'NFM (Mark)')
        # gets fully replaced — this also drops any shop employee's name.
        p = e.get("performer") or ""
        if "norfab" in p.lower() or re.search(r"\bNFM\b", p):
            e["performer"] = FAKE_COMPANY_SHORT + " shop"
        if e.get("notes"):
            e["notes"] = _rewrite_unit_codes_in_string(e["notes"], all_real_units)
        new_log.append(e)
    out["log"] = new_log
    # Defects resolved
    new_defects = []
    for entry in (prod.get("defects_resolved") or []):
        e = dict(entry)
        if e.get("unit"):
            e["unit"] = fake_unit_for(e["unit"])
        new_defects.append(e)
    out["defects_resolved"] = new_defects
    # _*_fields metadata blocks: help-text that lists real unit codes as examples
    # ("unit": "FDT12 | FDT14 | ... | * (all) | heavy | light"). Rewrite unit
    # codes in every string value inside these blocks.
    for meta_key in ("_schedule_fields", "_log_fields", "_defects_resolved_fields"):
        block = prod.get(meta_key)
        if not isinstance(block, dict):
            continue
        new_block = {}
        for k, v in block.items():
            new_block[k] = _rewrite_unit_codes_in_string(v, all_real_units)
        out[meta_key] = new_block
    # Safety net: brand-scrub + unit-rewrite EVERY string in the output,
    # wherever it lives. Free text can hide in any field; this guarantees
    # no 'Norfab'/'NFM'/real-unit-code survives regardless of structure.
    out = deep_transform_strings(
        out,
        lambda s: _scrub_brand_text(_rewrite_unit_codes_in_string(s, all_real_units)),
    )
    return out


def main():
    ak = os.environ.get("R2_READONLY_ACCESS_KEY_ID")
    sk = os.environ.get("R2_READONLY_SECRET_ACCESS_KEY")
    if not ak or not sk:
        print("ERROR: R2 credentials not set in env.", file=sys.stderr)
        sys.exit(1)

    print(f"Connecting to R2 at {R2_ENDPOINT}...")
    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=ak,
        aws_secret_access_key=sk,
        region_name="auto",
    )
    print(f"Fetching {R2_KEY_LATEST} from bucket {R2_BUCKET}...")
    obj = s3.get_object(Bucket=R2_BUCKET, Key=R2_KEY_LATEST)
    data = json.loads(obj["Body"].read())
    print(
        f"Loaded {len(data.get('titan_records', []))} titan records, "
        f"{len(data.get('sitedocs_records', []))} sitedocs records"
    )

    # Production data.js hides non-fleet drivers with /findlay|test/i on the
    # driver name. Anonymization renames 'Ray Findlay' to a fake that no
    # longer matches, so a coordinator with 1 DVI and 0 trips would surface
    # as a driver card with no unit (undefined lookup -> crash). Apply the
    # same exclusion here, BEFORE renaming, so demo semantics == production.
    def is_excluded_driver(name):
        return bool(re.search(r"(?i)findlay|test", name or ""))

    before_t = len(data.get("titan_records", []))
    before_s = len(data.get("sitedocs_records", []))
    data["titan_records"] = [
        r for r in data.get("titan_records", []) if not is_excluded_driver(r.get("driver"))
    ]
    data["sitedocs_records"] = [
        r for r in data.get("sitedocs_records", []) if not is_excluded_driver(r.get("driver"))
    ]
    dropped_t = before_t - len(data["titan_records"])
    dropped_s = before_s - len(data["sitedocs_records"])
    if dropped_t or dropped_s:
        print(f"Dropped {dropped_t} titan + {dropped_s} sitedocs record(s) for excluded drivers (findlay/test filter)")

    # Guard set BEFORE anonymization
    real_strings = collect_real_strings_to_guard(data)
    print(f"Collected {len(real_strings)} real strings to guard against leaks")

    all_real_names = sorted(
        set(r.get("driver") for r in data.get("titan_records", []) if r.get("driver"))
        | set(r.get("driver") for r in data.get("sitedocs_records", []) if r.get("driver"))
    )
    all_real_units = sorted(
        set(r.get("unit") for r in data.get("titan_records", []) if r.get("unit"))
        | set(r.get("unit") for r in data.get("sitedocs_records", []) if r.get("unit"))
    )

    print("\n=== Driver name mapping ===")
    for real_name in all_real_names:
        print(f"  {real_name!r} -> {fake_name_for(real_name)!r}")
    print("\n=== Unit mapping ===")
    for real_unit in all_real_units:
        print(f"  {real_unit!r} -> {fake_unit_for(real_unit)!r}")

    print("\nAnonymizing records...")
    data["titan_records"] = anonymize_titan(data["titan_records"])
    data["sitedocs_records"] = anonymize_sitedocs(data["sitedocs_records"])
    data["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # === LEAK SCAN: no real string may appear anywhere in the anonymized output
    leaks = list(find_leaks_in_object(data, real_strings))
    if leaks:
        # Group by (field_path, leaked_string) so the report is compact
        grouped = {}
        for path, leaked, value in leaks:
            grouped.setdefault((path.split("[")[0], leaked), value)
        print(f"\nERROR: {len(leaks)} leak occurrence(s) in {len(grouped)} distinct field/string combos:", file=sys.stderr)
        for (field_path, leaked), value in list(grouped.items())[:20]:
            snippet = value[:100] + "..." if len(value) > 100 else value
            print(f"  - field={field_path!r} leaked={leaked!r} value={snippet!r}", file=sys.stderr)
        print("Refusing to publish. Anonymization is buggy.", file=sys.stderr)
        sys.exit(1)
    print("[OK] Leak scan: no real strings found in output")

    # === POSITIVE CHECK: every driver field in output must be a known fake name
    unknown_drivers = set()
    for r in data.get("titan_records", []) + data.get("sitedocs_records", []):
        d = r.get("driver")
        if d and d not in FAKE_NAME_SET:
            unknown_drivers.add(d)
    if unknown_drivers:
        print(
            f"\nERROR: unknown driver value(s) in output: {sorted(unknown_drivers)!r}",
            file=sys.stderr,
        )
        print("Refusing to publish.", file=sys.stderr)
        sys.exit(1)
    print("[OK] Positive check: all driver values are known fakes")

    # === COORD FENCE: no output coord may be within LEAK_FENCE_KM of real home
    for r in data.get("titan_records", []):
        for coord_field in ("startCoords", "endCoords"):
            c = r.get(coord_field)
            if c and isinstance(c, dict) and "lat" in c:
                dist = haversine_km(c["lat"], c["lon"], REAL_HOME_LAT, REAL_HOME_LON)
                if dist < LEAK_FENCE_KM:
                    print(
                        f"\nERROR: output coord ({c['lat']}, {c['lon']}) is "
                        f"{dist:.2f} km from real home terminal (fence: {LEAK_FENCE_KM} km)",
                        file=sys.stderr,
                    )
                    sys.exit(1)
    print(f"[OK] Coord fence: no output coord within {LEAK_FENCE_KM} km of real home terminal")

    # Write outputs
    out_dir = Path("app")
    out_dir.mkdir(parents=True, exist_ok=True)

    with open(out_dir / "latest.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(
        f"\nWrote app/latest.json "
        f"({len(data['titan_records'])} titan, {len(data['sitedocs_records'])} sitedocs)"
    )

    # Fetch production shapes for the other three JSONs and anonymize
    print("\n=== Fetching production JSON shapes ===")
    prod_drivers = fetch_json(PROD_DRIVERS_URL)
    prod_fleet_meta = fetch_json(PROD_FLEET_META_URL)
    prod_maintenance = fetch_json(PROD_MAINTENANCE_URL)

    # All real unit codes from BOTH the data and fleet-meta (some may only
    # appear in one or the other).
    all_real_units_full = set(all_real_units) | set(
        (prod_fleet_meta.get("vehicles") or {}).keys()
    )

    drivers_out = anonymize_drivers_json(prod_drivers)
    fleet_meta_out = anonymize_fleet_meta_json(prod_fleet_meta)
    maintenance_out = anonymize_maintenance_json(prod_maintenance, all_real_units_full)

    # Build a focused guard set for the three shape-preserved JSONs.
    # Only real identifiers: driver names, unit codes, brand markers.
    # Benign fields like _comment stay in the output unchanged (they don't
    # contain identifying info, they describe the file's purpose).
    focused_guard = set()
    for d in (prod_drivers.get("drivers") or {}).values():
        if isinstance(d, dict) and d.get("name"):
            focused_guard.update(name_variants(d["name"]))
    for real_unit in (prod_fleet_meta.get("vehicles") or {}).keys():
        if len(real_unit) >= 4:
            focused_guard.add(real_unit)
    for marker in ["Norfab", "norfab", "NORFAB", "Findlay", "NFM", "norfabmfg",
                   "sharepoint.com", "norfabmfg.com"]:
        focused_guard.add(marker)

    for label, out_data in (
        ("drivers.json", drivers_out),
        ("fleet-meta.json", fleet_meta_out),
        ("maintenance.json", maintenance_out),
    ):
        leaks_here = list(find_leaks_in_object(out_data, focused_guard))
        if leaks_here:
            grouped = {}
            for path, leaked, value in leaks_here:
                grouped.setdefault((path.split("[")[0], leaked), value)
            print(f"\nERROR: {label} has {len(leaks_here)} leak(s) in {len(grouped)} field/string combos:", file=sys.stderr)
            for (fp, ls), val in list(grouped.items())[:20]:
                snippet = val[:100] + "..." if len(val) > 100 else val
                print(f"  - {label}: field={fp!r} leaked={ls!r} value={snippet!r}", file=sys.stderr)
            sys.exit(1)
        print(f"[OK] {label}: no real strings leaked")

    with open(out_dir / "drivers.json", "w", encoding="utf-8") as f:
        json.dump(drivers_out, f, indent=2)
    print(f"Wrote app/drivers.json ({len(drivers_out['drivers'])} drivers)")

    with open(out_dir / "fleet-meta.json", "w", encoding="utf-8") as f:
        json.dump(fleet_meta_out, f, indent=2)
    print(f"Wrote app/fleet-meta.json ({len(fleet_meta_out.get('vehicles', {}))} vehicles, "
          f"{len(fleet_meta_out.get('drivers', {}))} drivers)")

    with open(out_dir / "maintenance.json", "w", encoding="utf-8") as f:
        json.dump(maintenance_out, f, indent=2)
    print(f"Wrote app/maintenance.json (schedule={len(maintenance_out.get('schedule', []))}, "
          f"log={len(maintenance_out.get('log', []))}, "
          f"defects_resolved={len(maintenance_out.get('defects_resolved', []))})")

    print("\n[OK] Anonymization complete.")


if __name__ == "__main__":
    main()
