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


def fake_name_for(real_name):
    if not real_name or not real_name.strip():
        return real_name
    return stable_choice(FAKE_DRIVER_NAMES, f"driver:{real_name.strip().lower()}")


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
        num = stable_int(f"unit:{real_unit}", 90) + 10
        _fake_unit_map[real_unit] = f"{prefix}{num}"
    return _fake_unit_map[real_unit]


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def collect_real_strings_to_guard(data):
    """Real strings that must NEVER appear in output. Length >= 6 to avoid
    false positives (e.g., a real name 'Sam' colliding with fake 'Sam Delacroix')."""
    strings = set()

    def add(v):
        if v and isinstance(v, str) and len(v.strip()) >= 6:
            strings.add(v.strip())

    for r in data.get("titan_records", []):
        add(r.get("driver"))
        add(r.get("startLocationName"))
        add(r.get("endLocationName"))
        add(r.get("assetName"))
    for r in data.get("sitedocs_records", []):
        add(r.get("driver"))
        add(r.get("driver_name_raw"))
        add(r.get("inspector"))
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


def anonymize_titan(records):
    out = []
    for r in records:
        r = dict(r)
        if r.get("driver"):
            r["driver"] = fake_name_for(r["driver"])
        if r.get("unit"):
            r["unit"] = fake_unit_for(r["unit"])
        if r.get("assetName"):
            r["assetName"] = fake_unit_for(r["assetName"])
        # Route stop and home location labels
        if r.get("startLocationName"):
            r["startLocationName"] = "Route Stop"
        if r.get("endLocationName"):
            end = r.get("endLocationName") or ""
            r["endLocationName"] = (
                FAKE_HOME_LABEL if "office" in end.lower() or "yard" in end.lower() else "Route Stop"
            )
        # GPS coords: deterministic jitter around fake home
        for coord_field in ("startCoords", "endCoords"):
            c = r.get(coord_field)
            if c and isinstance(c, dict) and "lat" in c and "lon" in c:
                lat, lon = fake_coords_for(c["lat"], c["lon"])
                r[coord_field] = {"lat": lat, "lon": lon}
        out.append(r)
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
        # File paths
        if r.get("source_file"):
            r["source_file"] = "SAMPLE_DVI_placeholder.pdf"
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


def anonymize_maintenance_json(prod):
    """Rewrite unit references in schedule + log + defects_resolved. Keep everything else."""
    out = dict(prod)
    # schedule: entries have "unit" field (can be * / heavy / light / specific code)
    new_schedule = []
    for entry in (prod.get("schedule") or []):
        e = dict(entry)
        u = e.get("unit")
        if u and u not in ("*", "heavy", "light"):
            e["unit"] = fake_unit_for(u)
        new_schedule.append(e)
    out["schedule"] = new_schedule
    # log: entries reference a specific unit + performer + notes
    new_log = []
    for entry in (prod.get("log") or []):
        e = dict(entry)
        if e.get("unit"):
            e["unit"] = fake_unit_for(e["unit"])
        if e.get("performer") and "norfab" in e["performer"].lower():
            e["performer"] = FAKE_COMPANY + " shop"
        if e.get("notes"):
            e["notes"] = re.sub(r"(?i)norfab[a-z\s()0-9]*inc\.?", FAKE_COMPANY, e["notes"])
        new_log.append(e)
    out["log"] = new_log
    # defects_resolved: entries reference a unit
    new_defects = []
    for entry in (prod.get("defects_resolved") or []):
        e = dict(entry)
        if e.get("unit"):
            e["unit"] = fake_unit_for(e["unit"])
        new_defects.append(e)
    out["defects_resolved"] = new_defects
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

    drivers_out = anonymize_drivers_json(prod_drivers)
    fleet_meta_out = anonymize_fleet_meta_json(prod_fleet_meta)
    maintenance_out = anonymize_maintenance_json(prod_maintenance)

    # Guard all three against leaks too
    for label, prod_data, out_data in (
        ("drivers.json", prod_drivers, drivers_out),
        ("fleet-meta.json", prod_fleet_meta, fleet_meta_out),
        ("maintenance.json", prod_maintenance, maintenance_out),
    ):
        gs = collect_real_strings_to_guard({
            "titan_records": [],
            "sitedocs_records": [{"driver": n, "unit": u, "carrier": prod_fleet_meta.get("_comment", "")}
                                  for n in [(d.get("name") if isinstance(d, dict) else None)
                                            for d in (prod_data.get("drivers") or {}).values()]
                                  for u in [None]],
        })
        # Also add every real driver name + unit code from production
        for d in (prod_drivers.get("drivers") or {}).values():
            if isinstance(d, dict) and d.get("name") and len(d["name"]) >= 6:
                gs.add(d["name"])
        for real_unit in (prod_fleet_meta.get("vehicles") or {}).keys():
            if len(real_unit) >= 4:
                gs.add(real_unit)
        for marker in ["Norfab", "norfab", "NORFAB", "Findlay", "NFM", "norfabmfg", "sharepoint.com"]:
            gs.add(marker)
        leaks_here = list(find_leaks_in_object(out_data, gs))
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
