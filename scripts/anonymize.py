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
import sys
from datetime import datetime, timezone
from pathlib import Path


R2_ENDPOINT = "https://dc8101f3cdb435a804c5d4e4e4a2f79b.r2.cloudflarestorage.com"
R2_BUCKET = "FLEET_DATA"
R2_KEY_LATEST = "latest.json"

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
    for r in data.get("sitedocs_records", []):
        add(r.get("driver"))
        add(r.get("driver_name_raw"))
    # Explicit brand markers
    for marker in ["Norfab", "norfab", "NORFAB", "Findlay", "findlay", "NFM", "Raymond"]:
        strings.add(marker)
    strings.discard("")
    return strings


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
        if r.get("driver"):
            r["driver"] = fake_name_for(r["driver"])
        if r.get("unit"):
            r["unit"] = fake_unit_for(r["unit"])
        if r.get("driver_name_raw"):
            r["driver_name_raw"] = fake_name_for(r["driver_name_raw"])
        if r.get("unit_raw"):
            r["unit_raw"] = fake_unit_for(r["unit_raw"])
        # Point PDF references at a placeholder
        if r.get("source_file"):
            r["source_file"] = "SAMPLE_DVI_placeholder.pdf"
        out.append(r)
    return out


def generate_drivers_json(all_real_names):
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    out = {"version": 1, "updated_at_utc": now, "drivers": {}}
    for real_name in sorted(all_real_names):
        fake_name = fake_name_for(real_name)
        fake_token = fake_token_for(f"drv_{hashlib.sha256(real_name.encode()).hexdigest()[:16]}")
        key = fake_name.lower()
        out["drivers"][key] = {
            "name": fake_name,
            "token": fake_token,
            "created_at_utc": "2026-03-01T12:00:00Z",
            "last_published_at_utc": now,
        }
    return out


def generate_fleet_meta_json(all_real_units):
    vehicles = {}
    for real_unit in sorted(all_real_units):
        fake_unit = fake_unit_for(real_unit)
        cvip_month = stable_int(f"cvip:{fake_unit}", 12) + 1
        reg_month = stable_int(f"reg:{fake_unit}", 12) + 1
        vehicles[fake_unit] = {
            "vehicle_id": fake_unit,
            "cvip_due": f"2027-{cvip_month:02d}-15",
            "registration_expiry": f"2027-{reg_month:02d}-30",
            "insurance_expiry": "2027-06-30",
        }
    return {
        "_comment": "Demo fleet metadata. Synthetic data — not a real carrier.",
        "carrier": {
            "name": FAKE_COMPANY,
            "short": FAKE_COMPANY_SHORT,
            "nsc": FAKE_NSC,
            "nsc_valid_to": "2028-11-30",
            "home_terminal_address": FAKE_HOME_ADDRESS,
        },
        "vehicles": vehicles,
        "drivers": {},
    }


def generate_maintenance_json():
    return {
        "_comment": "Demo maintenance data. Synthetic for portfolio dashboard.",
        "schedule": [
            {"item": "CVIP", "unit": "*", "interval_days": 365},
            {"item": "Oil change", "unit": "*", "interval_km": 8000},
        ],
        "log": [],
        "defects_resolved": [],
    }


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
    output_text = json.dumps(data)
    leaks = [s for s in real_strings if s in output_text]
    if leaks:
        print(f"\nERROR: {len(leaks)} real value(s) leaked into output:", file=sys.stderr)
        for s in leaks[:20]:
            print(f"  - {s!r}", file=sys.stderr)
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

    with open(out_dir / "drivers.json", "w", encoding="utf-8") as f:
        json.dump(generate_drivers_json(all_real_names), f, indent=2)
    print(f"Wrote app/drivers.json ({len(all_real_names)} drivers)")

    with open(out_dir / "fleet-meta.json", "w", encoding="utf-8") as f:
        json.dump(generate_fleet_meta_json(all_real_units), f, indent=2)
    print(f"Wrote app/fleet-meta.json ({len(all_real_units)} vehicles)")

    with open(out_dir / "maintenance.json", "w", encoding="utf-8") as f:
        json.dump(generate_maintenance_json(), f, indent=2)
    print("Wrote app/maintenance.json")

    print("\n[OK] Anonymization complete.")


if __name__ == "__main__":
    main()
