// Cascade Freight Fleet Compliance, real-data adapter.
// Fetches latest.json + the roadside registry, exposes the same window.NORFAB_DATA
// API the design components use (DRIVERS, UNITS, TRIPS, DVIR, dayCompliance, ...).

(function () {
  const PPB = { lat: 53.585, lng: -113.561, address: "16425 130 Ave NW, Edmonton, AB T5V 1K5" };
  const SFC = { carrier: "Cascade Freight Inc.", nsc: "AB-NSC-013-2241", expires: "2028-11-30" };
  // Canonical worker-facing host. GitHub Pages serves PDFs inline with no
  // Microsoft login required (unlike SharePoint, which forces auth even on
  // "Anyone with the link" shares when the tenant restricts them).
  const PUBLISH_BASE = "https://norfab-fleet.pages.dev";
  // SharePoint mirror is kept as a backup channel (per-driver folder structure
  // is preserved at the OneDrive sync target). Not used for worker links.
  const SHAREPOINT_MIRROR_BASE = "https://cascadefreight.sharepoint.com/sites/FleetAutomation/Shared%20Documents/40_SFC_Evidence_and_Roadside";

  // Static fleet catalog, 8 units. GVW/tare confirmed by Cascade Freight.
  // klass: "heavy" if GVW >= 11,794 kg (Alberta full-log threshold), else "light".
  const UNITS = [
    { id: "FDT12", year: 2007, make: "GMC",   model: "C5500 Flatbed",   gvw_kg: 23000, tare_kg: 4550, klass: "heavy", photo: "assets/units/FDT12.jpg" },
    { id: "FDT14", year: 2012, make: "Ford",  model: "F-550 Crew",      gvw_kg: 15950, tare_kg: 5000, klass: "heavy", photo: "assets/units/FDT14.jpg" },
    { id: "FDT15", year: 2024, make: "Ford",  model: "F-550 Crew",      gvw_kg: 15900, tare_kg: 5000, klass: "heavy", photo: "assets/units/FDT15.jpg" },
    { id: "FPT10", year: 2009, make: "GMC",   model: "Sierra 3500HD",   gvw_kg: 6350,  tare_kg: 3200, klass: "light", photo: "assets/units/FPT10.jpg" },
    { id: "FPT20", year: 2010, make: "GMC",   model: "Sierra 1500",     gvw_kg: 4400,  tare_kg: 2700, klass: "light", photo: "assets/units/FPT20.jpg" },
    { id: "FPT21", year: 2011, make: "GMC",   model: "Sierra",          gvw_kg: 5000,  tare_kg: 2750, klass: "light" },
    { id: "FPT22", year: 2005, make: "Dodge", model: "Ram 2500",        gvw_kg: 4309,  tare_kg: 2650, klass: "light", photo: "assets/units/FPT22.jpg" },
    { id: "FPT23", year: 2012, make: "Ford",  model: "F350",            gvw_kg: 7400,  tare_kg: 3100, klass: "light" },
  ];

  // Per-driver static contact extras. Empty for now, Ray will fill in.
  // Keyed by normalised driver name (lower-case, no punctuation).
  const DRIVER_CONTACT = {
    // "adel elsirri": { email: "...", phone: "..." },
  };

  // ----- Helpers -----
  const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const driverIdFor = (name) => normKey(name);

  // Parse "Mar 26, 2026 8:01:01 AM" → Date in local time.
  function parseTitanTimestamp(s) {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Convert a Date to minutes since local midnight.
  function minutesOfDay(d) {
    if (!d) return null;
    return d.getHours() * 60 + d.getMinutes();
  }
  // Parse "12:57 PM" → minutes since midnight.
  function parseClockToMinutes(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = (m[3] || "").toUpperCase();
    if (ap === "AM") { if (h === 12) h = 0; }
    else if (ap === "PM") { if (h !== 12) h += 12; }
    return h * 60 + mm;
  }
  // Earth-distance via haversine (km).
  function haversineKm(a, b) {
    if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
    const R = 6371;
    const toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Today's date in the fleet's local timezone (Mountain). NEVER use
  // toISOString().slice(0,10) for "today" — that's UTC, and UTC midnight
  // is 6pm Mountain, so every evening the UTC date rolls to tomorrow and
  // breaks day-comparison logic (day_complete, todayHasActivity, etc.).
  // Titan trip dates are Mountain-local; comparisons must match.
  function localTodayISO() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
  }

  // ----- Adapter state -----
  let DRIVERS = [];
  let TRIPS = [];
  let YARD_MOVES = [];
  let DVIR = [];
  let TODAY = localTodayISO();

  // Build driver list from sitedocs + titan records (excluding obvious test drivers).
  function buildDrivers(latest, registry) {
    const namesFromSiteDocs = new Set();
    const namesFromTitan = new Set();
    for (const s of latest.sitedocs_records || []) {
      if (s.driver && !/findlay|test/i.test(s.driver)) namesFromSiteDocs.add(s.driver);
    }
    for (const t of latest.titan_records || []) {
      if (t.driver && !/findlay|test/i.test(t.driver)) namesFromTitan.add(t.driver);
    }
    // Use the union so a driver who hasn't filed DVIR yet still appears.
    const all = Array.from(new Set([...namesFromSiteDocs, ...namesFromTitan])).sort();
    return all.map(name => {
      const id = driverIdFor(name);
      const regKey = name.toLowerCase();
      const regEntry = (registry && registry.drivers && registry.drivers[regKey]) || {};
      const contact = DRIVER_CONTACT[id] || {};
      // Most-recent unit driven by this person (best signal for the "primary unit" pill).
      const lastTrip = (latest.titan_records || [])
        .filter(t => t.driver === name && t.unit)
        .sort((a, b) => String(b.tripDate || "").localeCompare(String(a.tripDate || "")))[0];
      return {
        id,
        name,
        email: contact.email || "",
        phone: contact.phone || "",
        unit: lastTrip ? lastTrip.unit : "",
        token: regEntry.token || "",
      };
    });
  }

  // Convert one Titan record into the design's trip shape.
  function adaptTrip(rec, idx) {
    const start = parseTitanTimestamp(rec.tripStart);
    const end   = parseTitanTimestamp(rec.tripEnd);
    const date  = rec.tripDate || (start ? start.toISOString().slice(0, 10) : "");
    const km    = Number(rec.tripDistance) || 0;
    const startCoords = rec.startCoords ? { lat: rec.startCoords.lat, lng: rec.startCoords.lon } : null;
    const endCoords   = rec.endCoords   ? { lat: rec.endCoords.lat,   lng: rec.endCoords.lon }   : null;
    const distFromHomeStart = startCoords ? haversineKm({ lat: PPB.lat, lon: PPB.lng }, { lat: startCoords.lat, lon: startCoords.lng }) : null;
    const distFromHomeEnd   = endCoords   ? haversineKm({ lat: PPB.lat, lon: PPB.lng }, { lat: endCoords.lat,   lon: endCoords.lng })   : null;
    const maxRadius = Math.max(distFromHomeStart || 0, distFromHomeEnd || 0);
    const outside_radius = maxRadius > 160;
    const returned = (distFromHomeEnd != null) && (distFromHomeEnd <= 1.5);
    const unitInfo = UNITS.find(u => u.id === rec.unit) || null;
    return {
      id: rec.row_index != null ? rec.row_index : idx,
      driver: driverIdFor(rec.driver),
      driver_name: rec.driver || "",
      unit: rec.unit || "",
      // Alberta HOS rules apply only to commercial vehicles with GVW
      // >= 11,794 kg (or trailer combinations that hit that threshold).
      // Carry the unit's class on the trip so dayCompliance can gate the
      // 160 km exemption test by whether the truck is even in scope.
      // Defaults to "heavy" for unknown units so unrecognised vehicles
      // are treated conservatively (full HOS check applied).
      unit_class: unitInfo ? unitInfo.klass : "heavy",
      date,
      tripStart: rec.tripStart,
      tripEnd: rec.tripEnd,
      start_min: minutesOfDay(start),
      end_min: minutesOfDay(end),
      tripDistance: km,
      km,
      endingOdometer: rec.endingOdometer || null,
      // Both start and end location names. The trip table shows them as
      // separate columns so an auditor can read "Head Office → Gold Bar" at
      // a glance instead of guessing what "Site" means.
      //
      // Fallback: when Titan didn't geocode a location (empty name) but
      // the coords are within 500m of a known Cascade Freight shop, synthesize the
      // shop name so the trip table shows "Head Office" instead of raw
      // coords. The data layer prefers raw Titan-provided names — this
      // only fills in the blanks.
      start_site: rec.startLocationName || shopNameForCoords(startCoords) || "",
      end_site: rec.endLocationName || shopNameForCoords(endCoords) || "",
      site: rec.endLocationName || rec.startLocationName
        || shopNameForCoords(endCoords) || shopNameForCoords(startCoords)
        || "",
      site_lat: endCoords ? endCoords.lat : (startCoords ? startCoords.lat : null),
      site_lng: endCoords ? endCoords.lng : (startCoords ? startCoords.lng : null),
      // Note: these `returned` and `outside_radius` flags are computed
      // against the carrier PPB and are kept for legacy reasons only.
      // dayCompliance re-annotates each trip with the regulation-correct
      // `outside_radius` (measured from day-start) before display.
      site_dist: maxRadius,
      returned,
      outside_radius,
      flagged: outside_radius || (rec.flags && rec.flags.length > 0),
      startCoords: startCoords ? [startCoords.lat, startCoords.lng] : null,
      endCoords:   endCoords   ? [endCoords.lat,   endCoords.lng]   : null,
      flags: rec.flags || [],
      source_file: rec.source_file || "",
    };
  }

  // Convert one SiteDocs record into the design's inspection shape.
  function adaptInspection(rec, idx) {
    const tt = String(rec.trip_type || "").toLowerCase();
    const type = tt.includes("post") ? "Post" : "Pre";
    return {
      id: idx,
      driver: driverIdFor(rec.driver || rec.inspector),
      driver_name: rec.driver || rec.inspector || "",
      unit: rec.unit_no || "",
      unit_label: rec.unit_label || "",
      trailer_unit: rec.trailer_unit || "",
      trailer_unit_label: rec.trailer_unit_label || "",
      trailer_plate: rec.trailer_plate || "",
      date_local: rec.date_local || "",
      trip_type: type,
      time_local: rec.time_local || "",
      time_min: parseClockToMinutes(rec.time_local),
      odometer_km: rec.odometer_km || null,
      source_pdf: rec.source_pdf ? rec.source_pdf.split(/[\\/]/).pop() : (rec.source_file || ""),
      defects_present: rec.defects_present === true ? true : rec.defects_present === false ? false : null,
      defect_notes: typeof rec.defect_notes === "string" ? rec.defect_notes.trim() : "",
    };
  }

  // ----- API exposed on window.NORFAB_DATA -----
  // dayCompliance: state reflects ONLY the 160 km HOS exemption test per
  // AB Reg 317/2002 §78 / NSC Standard 9. The regulation specifies three
  // conditions, ALL measured against "the location at which the driver
  // started the day", NOT the carrier's home-terminal address:
  //
  //   (a) operates within 160 km of the day-start location,
  //   (b) returns to the day-start location at end of day, and
  //   (c) released from work within 15 hours of coming on duty.
  //
  // For drivers who take the truck home overnight, "day-start" is wherever
  // the truck began that day's first trip (usually the driver's home),
  // NOT the carrier's PPB address (16425 130 Ave NW). The earlier version
  // measured against PPB and falsely flagged take-truck-home drivers.
  //
  // Pre-trip / post-trip DVIR is NSC Standard 13, a separate compliance
  // dimension we report alongside but never use to flag the log state.
  //
  // Hour totals rounded to the nearest 0.25h (15-min legal precision).
  function roundQuarterHour(hours) {
    if (!isFinite(hours)) return 0;
    return Math.round(hours * 4) / 4;
  }
  const SHIFT_LIMIT_HOURS = 15;       // 160 km exemption: shift released within 15h
  const RETURN_TOLERANCE_KM = 1.5;    // a return is within this radius of day-start
  const RADIUS_LIMIT_KM = 160;

  // Compute haversine km between two [lat, lng] arrays (the shape adaptTrip
  // emits). Returns null if either coord is missing.
  function coordDistKm(a, b) {
    if (!a || !b) return null;
    return haversineKm({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
  }

  // A "noise" trip is engine-on telemetry that isn't really a trip:
  // distance < 100 m AND wall-clock < 2 min. Titan emits these when a vehicle
  // is started, rolls a few feet, and shuts off (yard re-parks, idle blips).
  // Including them inflates the trip count and clutters the trip table.
  function isNoiseTrip(t) {
    const km = Number(t && t.km) || 0;
    const dur = Math.max(0, (Number(t && t.end_min) || 0) - (Number(t && t.start_min) || 0));
    return km < 0.1 && dur < 2;
  }

  // Known Cascade Freight shop locations. A trip whose start AND end are within
  // SHOP_RADIUS_KM of one of these is considered movement inside the
  // home terminal, not a real trip. Add new shops here as Cascade Freight opens
  // additional locations — the dashboard will start picking them up
  // automatically on the next load.
  //
  // Coords are pulled from the actual Titan geofence centroids:
  //   - 'Head Office' is CFI-yard (the main shop with corporate offices),
  //     where Titan labels trip endpoints as 'Head Office'.
  //   - 'NFB' is the separate Cascade Freight building across the street from
  //     CFI-yard, with its own Titan geofence (Ray confirmed 53.59120,
  //     -113.60778 from Titan's NFB perimeter setup).
  //
  // The PPB constant's coords (53.585, -113.561) are NOT a Cascade Freight
  // building. Empirically they're near Nelson Lumber. PPB is preserved
  // elsewhere because it's the carrier-registered address used in the
  // 160 km HOS haversine check, but it doesn't belong in this shop-
  // detection list.
  const HOME_TERMINALS = [
    { name: "Head Office", lat: 53.590474, lng: -113.608617 },
    { name: "NFB",         lat: 53.59120,  lng: -113.60778  },
  ];
  const SHOP_RADIUS_KM = 0.5;

  // Returns the matched HOME_TERMINALS name when the given coords are
  // within SHOP_RADIUS_KM of a known shop. Coords accepted as either
  // {lat, lng} object or [lat, lng] array. Returns null if not at any
  // known shop or if the coords are unusable.
  //
  // Returns the CLOSEST shop, not the first one within radius. NFM
  // and NFB are about 95 m apart, so both can be inside the 500 m
  // radius simultaneously — picking the closer one keeps trips labeled
  // with the building they were actually at.
  function shopNameForCoords(coords) {
    if (!coords) return null;
    let lat, lng;
    if (Array.isArray(coords)) {
      if (coords.length < 2) return null;
      lat = coords[0]; lng = coords[1];
    } else {
      lat = coords.lat; lng = coords.lng;
    }
    if (lat == null || lng == null) return null;
    let bestName = null;
    let bestDist = Infinity;
    for (const s of HOME_TERMINALS) {
      const d = haversineKm({ lat: s.lat, lon: s.lng }, { lat, lon: lng });
      if (d != null && d <= SHOP_RADIUS_KM && d < bestDist) {
        bestDist = d;
        bestName = s.name;
      }
    }
    return bestName;
  }

  function coordsNearShop(coords) {
    return shopNameForCoords(coords) !== null;
  }

  // True if the given location (either name or coords) resolves to a known
  // shop. Used by isYardMove — both endpoints must satisfy this for a
  // trip to count as a yard move, not just one.
  function atShop(name, coords) {
    const n = String(name || "").toLowerCase();
    if (n.includes("head office") || n.includes("nfb") || n.includes("norfab")) return true;
    return coordsNearShop(coords);
  }

  // A "yard move" is a brief movement at one of Cascade Freight's shop locations
  // — typically a mechanic repositioning the truck after maintenance, a
  // driver backing it out for a pre-trip walkaround, or a brief test
  // after a fix. Surfacing these on the Unit detail page lets a
  // supervisor see a truck WAS touched on a day that would otherwise
  // look idle (no DVI, no driver assigned, no "real" trip).
  //
  // Definition:
  //   - Brief: km < 2 AND duration < 15 min (covers shuffling between
  //     buildings on a multi-acre yard without letting a real local
  //     errand sneak in)
  //   - BOTH start AND end resolve to a known shop, where "at shop" =
  //     name contains 'head office' / 'nfb' / 'norfab' OR coords are
  //     within 500m of a HOME_TERMINALS entry
  //
  // Requiring BOTH endpoints to be at shop prevents flagging real short
  // trips that start at the shop but go somewhere else.
  function isYardMove(t) {
    if (!t) return false;
    const km = Number(t.km) || 0;
    const dur = Math.max(0, (Number(t.end_min) || 0) - (Number(t.start_min) || 0));
    if (km >= 2 || dur >= 15) return false;
    return atShop(t.start_site, t.startCoords) && atShop(t.end_site, t.endCoords);
  }

  // Single source of truth for the duty-status timeline.
  // Returns a list of {start, end, row} where row: 0=Off, 1=Sleeper, 2=Driving, 3=OnDuty.
  // Guarantees: sorted, non-overlapping, covers exactly 24*60 minutes, rows in {0..3}.
  // Used by BOTH the dashboard's DutyChart (driver-screens.jsx) AND the phone
  // view's DutyMini (phone-view.jsx) so they can never disagree.
  function buildSegmentsFromTrips(trips, pre, post) {
    const DAY = 24 * 60;
    const clamp = (v) => Math.max(0, Math.min(DAY, v));
    // 1. Sanitise + sort + merge overlapping/duplicate driving intervals.
    const rawTrips = (Array.isArray(trips) ? trips : [])
      .filter(t => t && Number.isFinite(t.start_min) && Number.isFinite(t.end_min) && t.end_min >= t.start_min)
      .map(t => ({ start: clamp(t.start_min), end: clamp(t.end_min) }))
      .sort((a, b) => a.start - b.start);
    if (rawTrips.length === 0) return [];
    const drives = [];
    for (const t of rawTrips) {
      const prev = drives[drives.length - 1];
      if (prev && t.start <= prev.end) {
        if (t.end > prev.end) prev.end = t.end;
      } else {
        drives.push({ start: t.start, end: t.end });
      }
    }
    // 2. Anchor the work shift on the actual DVIR signed times. Pre-trip
    //    bookend is only drawn when DVIR was signed strictly BEFORE first
    //    trip; post-trip bookend only when signed AFTER last trip. No
    //    synthesized 15/10-min windows that aren't in the data.
    const preTimeMin = (pre && Number.isFinite(pre.time_min)) ? clamp(pre.time_min) : null;
    const postTimeMin = (post && Number.isFinite(post.time_min)) ? clamp(post.time_min) : null;
    const firstStart = drives[0].start;
    const lastEnd = drives[drives.length - 1].end;
    const workStart = (preTimeMin != null && preTimeMin < firstStart) ? preTimeMin : firstStart;
    const workEnd = (postTimeMin != null && postTimeMin > lastEnd) ? postTimeMin : lastEnd;
    // 3. Compose segments.
    const raw = [];
    if (workStart > 0) raw.push({ start: 0, end: workStart, row: 0 });
    if (workStart < firstStart) raw.push({ start: workStart, end: firstStart, row: 3 });
    for (let i = 0; i < drives.length; i++) {
      const d = drives[i];
      if (d.end > d.start) raw.push({ start: d.start, end: d.end, row: 2 });
      if (i < drives.length - 1) {
        const nextStart = drives[i + 1].start;
        if (nextStart > d.end) raw.push({ start: d.end, end: nextStart, row: 3 });
      }
    }
    if (workEnd > lastEnd) raw.push({ start: lastEnd, end: workEnd, row: 3 });
    if (workEnd < DAY) raw.push({ start: workEnd, end: DAY, row: 0 });
    // 4. Clamp + merge same-row adjacent segments for a clean stepped path.
    const cleaned = raw
      .map(s => ({ start: clamp(s.start), end: clamp(s.end), row: (s.row >= 0 && s.row <= 3) ? s.row : 0 }))
      .filter(s => s.end > s.start);
    const merged = [];
    for (const s of cleaned) {
      const last = merged[merged.length - 1];
      if (last && last.row === s.row && last.end === s.start) {
        last.end = s.end;
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  }

  function dayCompliance(driverId, dayISO) {
    const dayTrips = TRIPS
      .filter(t => t.driver === driverId && t.date === dayISO)
      .filter(t => !isNoiseTrip(t))
      .sort((a, b) => (a.start_min || 0) - (b.start_min || 0));
    if (dayTrips.length === 0) {
      const today_iso_empty = localTodayISO();
      return {
        state: "none", trips: 0, km: 0, drive_hrs: 0, onduty_hrs: 0, shift_hrs: 0,
        pre: null, post: null, dayTrips: [], reasons: [],
        outside: false, allReturned: true, over_shift_limit: false,
        day_start_coords: null, max_radius_km: 0,
        subject_to_hos: false, primary_unit_class: "", trailer_on_day: false,
        day_complete: dayISO < today_iso_empty, idle_minutes: null,
      };
    }
    const km = dayTrips.reduce((s, t) => s + (t.km || 0), 0);
    const first = dayTrips[0].start_min || 0;
    const last  = dayTrips[dayTrips.length - 1].end_min || 0;
    const shiftMin = Math.max(0, last - first);

    // Compute duty minutes the same way the chart will draw them: each
    // merged driving interval is driving; gaps between intervals are
    // on-duty. We must MERGE overlapping/duplicate trip intervals first,
    // Titan emits duplicates when a unit has multiple drivers or noisy
    // GPS, and without merging the totals can exceed 24h.
    const mergedDrives = [];
    const sortedByStart = [...dayTrips]
      .filter(t => Number.isFinite(t && t.start_min) && Number.isFinite(t && t.end_min) && t.end_min >= t.start_min)
      .sort((a, b) => (a.start_min || 0) - (b.start_min || 0));
    for (const t of sortedByStart) {
      const s = Math.max(0, Math.min(1440, t.start_min || 0));
      const e = Math.max(0, Math.min(1440, t.end_min || 0));
      if (e <= s) continue;
      const prev = mergedDrives[mergedDrives.length - 1];
      if (prev && s <= prev.end) {
        if (e > prev.end) prev.end = e;
      } else {
        mergedDrives.push({ start: s, end: e });
      }
    }
    let driveMin = 0;
    let onDutyMin = 0;
    for (let i = 0; i < mergedDrives.length; i++) {
      driveMin += (mergedDrives[i].end - mergedDrives[i].start);
      if (i < mergedDrives.length - 1) {
        onDutyMin += (mergedDrives[i + 1].start - mergedDrives[i].end);
      }
    }
    const pre  = DVIR.find(i => i.driver === driverId && i.date_local === dayISO && i.trip_type === "Pre") || null;
    const post = DVIR.find(i => i.driver === driverId && i.date_local === dayISO && i.trip_type === "Post") || null;
    // Pre/post bookends use the ACTUAL DVIR signed time, not a hardcoded
    // 15/10 minute assumption. Only count on-duty time that is genuinely
    // between the DVIR signing and the trip activity, never invent time.
    const _firstStart = mergedDrives.length ? mergedDrives[0].start : Infinity;
    const _lastEnd = mergedDrives.length ? mergedDrives[mergedDrives.length - 1].end : -Infinity;
    if (pre && Number.isFinite(pre.time_min) && pre.time_min < _firstStart) {
      onDutyMin += (_firstStart - pre.time_min);
    }
    if (post && Number.isFinite(post.time_min) && post.time_min > _lastEnd) {
      onDutyMin += (post.time_min - _lastEnd);
    }

    // Day-start = first trip's start coordinates. This is the regulation's
    // reference point ("location at which the driver started the day"),
    // not the carrier PPB address.
    const dayStart = dayTrips[0].startCoords || null;
    const dayEnd   = dayTrips[dayTrips.length - 1].endCoords || null;

    // Max distance from day-start to any trip endpoint (per condition (a)).
    let maxRadiusKm = 0;
    if (dayStart) {
      for (const t of dayTrips) {
        for (const c of [t.startCoords, t.endCoords]) {
          const d = coordDistKm(dayStart, c);
          if (d != null && d > maxRadiusKm) maxRadiusKm = d;
        }
      }
    }
    const outside = maxRadiusKm > RADIUS_LIMIT_KM;

    // Returned-to-start = last trip's end coords within tolerance of day-start
    // (per condition (b)). If we can't compute distance (missing coords) we
    // conservatively treat it as not-returned so the day isn't silently
    // exempted on missing data.
    let returnDistKm = null;
    if (dayStart && dayEnd) returnDistKm = coordDistKm(dayStart, dayEnd);
    const allReturned = (returnDistKm != null) && (returnDistKm <= RETURN_TOLERANCE_KM);
    const over_shift_limit = (shiftMin / 60) > SHIFT_LIMIT_HOURS;

    // HOS subjectivity: Alberta hours-of-service rules (AR 317/2002) only
    // apply to commercial vehicles with GVW >= 11,794 kg, or truck/trailer
    // combinations that hit that threshold. Light pickups under that
    // weight aren't subject to the 160 km exemption test at all - no
    // logbook of any kind is required, regardless of distance or hours.
    // We don't track trailer GVWs, so the conservative model is:
    //   heavy unit (any day)         -> subject (always run the test)
    //   light unit + trailer on DVI  -> subject (combined weight unknown,
    //                                   safe to assume it could cross)
    //   light unit + no trailer      -> NOT subject (skip the test)
    const primaryUnitClass = (dayTrips[0] && dayTrips[0].unit_class) || "heavy";
    const trailer_on_day = !!(
      (pre  && pre.trailer_unit  && String(pre.trailer_unit).trim()) ||
      (post && post.trailer_unit && String(post.trailer_unit).trim())
    );
    const subject_to_hos = primaryUnitClass === "heavy" || trailer_on_day;

    // Day-complete gate for the "returned to start" check.
    // The regulation condition (b) is an END-OF-DAY determination
    // ("returns to the day-start location at end of day"). During an
    // active shift the driver is obviously away from start, so flagging
    // mid-day produces false alarms.
    // A day is treated as complete when ANY of:
    //   1. The calendar date is in the past
    //   2. A post-trip DVI has been filed (explicit driver sign-off)
    //   3. The truck is currently parked at the day-start location AND
    //      has been idle for >= IDLE_DONE_THRESHOLD_MIN minutes (assumes
    //      the driver finished but didn't file a post-trip)
    // The third clause re-evaluates on every render: when a new trip
    // lands in the data the idle counter resets to the time since THAT
    // trip ended, so a driver who came home for a long lunch and then
    // went out again automatically flips back to "in progress".
    const IDLE_DONE_THRESHOLD_MIN = 120;
    const today_iso = localTodayISO();
    let idle_minutes = null;
    const last_trip = dayTrips[dayTrips.length - 1];
    if (last_trip && Number.isFinite(last_trip.end_min)) {
      const last_end_ms = new Date(`${dayISO}T00:00:00`).getTime() + last_trip.end_min * 60 * 1000;
      idle_minutes = (Date.now() - last_end_ms) / (60 * 1000);
    }
    const day_complete = dayISO < today_iso
      || !!post
      || (allReturned && idle_minutes != null && idle_minutes >= IDLE_DONE_THRESHOLD_MIN);
    const return_check_failed = day_complete && !allReturned;

    let state = (outside || return_check_failed || over_shift_limit) ? "full-log" : "exempt";
    if (!subject_to_hos) {
      // Light unit, no trailer on DVI: not in scope of the regulation.
      // Force state back to "exempt" (the compliant/no-flag visual) and
      // suppress the failure reasons array so the dashboard doesn't show
      // the orange "Full log" pill or the day-detail banner.
      state = "exempt";
    }

    // Total on-duty time = driving + on-duty-not-driving (per HOS terminology).
    // Shift hours = wall-clock first-trip-start to last-trip-end (regulatory
    // 15-hour test). These are different totals and shown in different places.
    const totalOnDutyMin = driveMin + onDutyMin;

    // Annotate each displayed trip with its max distance from the day-start
    // location. This replaces the old per-trip "returned" flag (which was
    // measured against the carrier PPB and produced nonsense in the trip
    // table). The annotated `outside_radius` is what the trip-records table
    // uses to show the "Outside 160 km" pill.
    const dayTripsAnnotated = dayTrips.map(t => {
      let d = 0;
      if (dayStart) {
        for (const c of [t.startCoords, t.endCoords]) {
          const dd = coordDistKm(dayStart, c);
          if (dd != null && dd > d) d = dd;
        }
      }
      return { ...t, dist_from_start_km: d, outside_radius: d > RADIUS_LIMIT_KM };
    });

    // Build the 24-hour duty-status segment list, single source of truth
    // used by BOTH the dashboard's DutyChart AND the phone view's DutyMini
    // so they cannot drift. Same rules as before: each trip is one DRIVING
    // segment, overlapping trips merge, gaps between trips are ON-DUTY,
    // pre/post DVIR add on-duty bookends ONLY when the actual signed time
    // is outside the trip window, everything else is OFF-DUTY.
    const segments = buildSegmentsFromTrips(dayTrips, pre, post);

    return {
      state,
      trips: dayTripsAnnotated.length,
      km,
      drive_hrs: roundQuarterHour(driveMin / 60),
      onduty_hrs: roundQuarterHour(totalOnDutyMin / 60),
      shift_hrs: roundQuarterHour(shiftMin / 60),
      pre, post,
      dayTrips: dayTripsAnnotated,
      segments,
      outside, allReturned, over_shift_limit,
      day_start_coords: dayStart,
      max_radius_km: maxRadiusKm,
      return_dist_km: returnDistKm,
      subject_to_hos,
      primary_unit_class: primaryUnitClass,
      trailer_on_day,
      day_complete,
      idle_minutes,
      reasons: subject_to_hos ? [
        outside && `operated outside ${RADIUS_LIMIT_KM} km of the day-start location (${maxRadiusKm.toFixed(1)} km maximum)`,
        return_check_failed && (returnDistKm != null
          ? `did not return to the day-start location (${returnDistKm.toFixed(1)} km away at end of day)`
          : `return-to-start could not be verified (missing trip coordinates)`),
        over_shift_limit && `work shift exceeded ${SHIFT_LIMIT_HOURS} hours (${(shiftMin/60).toFixed(1)}h recorded)`,
      ].filter(Boolean) : [],
    };
  }

  function todayStatus(driverId, today) { return dayCompliance(driverId, today || TODAY); }

  // Canonical worker-facing URL: the React phone view on GitHub Pages.
  // Fancy iOS-frame UI with duty-status chart, trip timeline, etc. Loads
  // React + Babel from CDN, transpiles JSX in-browser, fetches latest.json
  // + drivers.json (same-origin on Pages), filters to one driver by token.
  // Pages serves text/html inline guaranteeing it opens in every browser.
  function roadsideUrl(driverId) {
    const d = DRIVERS.find(x => x.id === driverId);
    if (!d || !d.token) return "";
    return `${PUBLISH_BASE}/app/Driver%20Phone%20View.html?token=${d.token}`;
  }
  // Static plain-HTML fallback (paper-style roadside packet, no JS).
  // Same data, simpler render, useful if the phone view ever fails to load.
  function roadsideStaticUrl(driverId) {
    const d = DRIVERS.find(x => x.id === driverId);
    if (!d || !d.token) return "";
    return `${PUBLISH_BASE}/drivers/${d.token}/`;
  }
  function roadsidePdfUrl(driverId) {
    const d = DRIVERS.find(x => x.id === driverId);
    if (!d || !d.token) return "";
    return `${PUBLISH_BASE}/drivers/${d.token}/latest.pdf`;
  }
  // Legacy SharePoint mirror URL, kept for archive only, not exposed.
  function roadsidePhoneViewUrl(driverId) {
    const d = DRIVERS.find(x => x.id === driverId);
    if (!d || !d.token) return "";
    return `${SHAREPOINT_MIRROR_BASE}/app/Driver%20Phone%20View.html?token=${d.token}`;
  }

  function tripsForRange(driverId, fromISO, toISO) {
    return TRIPS.filter(t => (driverId === "ALL" || t.driver === driverId) && t.date >= fromISO && t.date <= toISO);
  }

  function minToHHMM(m) {
    if (m == null || isNaN(m)) return "-";
    const h = Math.floor(m / 60), mm = m % 60;
    const ap = h >= 12 ? "p.m." : "a.m.";
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${String(mm).padStart(2, "0")} ${ap}`;
  }

  // Fleet metadata adapter state (vehicle status + per-vehicle/-driver
  // compliance dates that aren't in SiteDocs or Titan).
  let FLEET_META = { vehicles: {}, drivers: {} };

  // Maintenance data (schedule rules + event log).
  let MAINTENANCE = { schedule: [], log: [] };

  // Helpers exposed on NORFAB_DATA for the new views.
  function vehicleMeta(unitId) {
    return (FLEET_META && FLEET_META.vehicles && FLEET_META.vehicles[unitId]) || {};
  }
  function driverMeta(driverId) {
    return (FLEET_META && FLEET_META.drivers && FLEET_META.drivers[driverId]) || {};
  }
  // Days until an ISO date. Returns null if no date provided. Negative if past.
  function daysUntil(iso) {
    if (!iso) return null;
    const target = new Date(iso + "T00:00:00");
    if (isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / (24 * 60 * 60 * 1000));
  }

  // Resolve which units a schedule rule applies to.
  // Rule.unit can be "*" (all), "heavy", "light", or a specific unit ID.
  function resolveScheduleUnits(rule) {
    if (!rule || !rule.unit) return [];
    if (rule.unit === "*") return UNITS.map(u => u.id);
    if (rule.unit === "heavy") return UNITS.filter(u => u.klass === "heavy").map(u => u.id);
    if (rule.unit === "light") return UNITS.filter(u => u.klass === "light").map(u => u.id);
    return [rule.unit];
  }

  // Most recent maintenance log entry for a given unit + item label.
  // Used to compute "next due" from a schedule rule's interval.
  function lastLogFor(unitId, item) {
    const log = (MAINTENANCE && MAINTENANCE.log) || [];
    let best = null;
    for (const entry of log) {
      if (entry.unit !== unitId) continue;
      if ((entry.item || "").toLowerCase() !== (item || "").toLowerCase()) continue;
      if (!best || (entry.date || "") > (best.date || "")) best = entry;
    }
    return best;
  }

  // Open driver-reported defects, aggregated from DVIR Remarks fields and
  // filtered against closure records in maintenance.json#defects_resolved.
  //
  // Grouping key: (unit, defect_notes) - exact text match. Variants of the
  // same issue ("Block heater is not working" vs "doesn't work") will show
  // as separate rows; a single closure with text_match="Block heater" closes
  // both via case-insensitive substring matching.
  //
  // A defect is OPEN when its most recent DVI report date is AFTER its most
  // recent matching closure (so the same issue can re-open if it recurs).
  function openDefects() {
    const closures = (MAINTENANCE && MAINTENANCE.defects_resolved) || [];
    const reports = DVIR.filter(d => d.defects_present === true && d.defect_notes);
    // PDF URL points at a flat defects/ folder in the publish bundle.
    // The publisher copies every defect-flagged DVI's source PDF there
    // (see fleet_roadside_publish.py#publish_to_github_pages), so URLs are
    // valid regardless of the per-driver publish window. The DVI record's
    // source_pdf field already carries just the basename (adapter trims
    // any directory prefix).
    const buildPdfUrl = (sourcePdfName) => {
      if (!sourcePdfName) return null;
      return `${PUBLISH_BASE}/defects/${encodeURIComponent(sourcePdfName)}`;
    };

    const groups = new Map();
    for (const r of reports) {
      const key = `${r.unit}::${r.defect_notes}`;
      let g = groups.get(key);
      if (!g) {
        g = { unit: r.unit, text: r.defect_notes,
              first_reported: r.date_local, last_seen: r.date_local,
              occurrences: 0, drivers: new Set(), reports: [] };
        groups.set(key, g);
      }
      if (r.date_local && (g.first_reported === "" || r.date_local < g.first_reported)) g.first_reported = r.date_local;
      if (r.date_local && r.date_local > g.last_seen) g.last_seen = r.date_local;
      g.occurrences += 1;
      if (r.driver_name) g.drivers.add(r.driver_name);
      g.reports.push({
        date: r.date_local || "",
        driver_name: r.driver_name || "",
        pdf_url: buildPdfUrl(r.source_pdf),
      });
    }
    const out = [];
    for (const g of groups.values()) {
      const matching = closures.filter(c =>
        c && c.unit === g.unit && c.text_match &&
        g.text.toLowerCase().includes(String(c.text_match).toLowerCase())
      );
      let latestClose = "";
      for (const c of matching) {
        if (c.resolved_date && c.resolved_date > latestClose) latestClose = c.resolved_date;
      }
      const isOpen = !latestClose || g.last_seen > latestClose;
      if (!isOpen) continue;
      // Sort reports newest-first so the modal date picker leads with the
      // most recent DVI.
      const sortedReports = g.reports.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      out.push({
        unit: g.unit,
        text: g.text,
        first_reported: g.first_reported,
        last_seen: g.last_seen,
        occurrences: g.occurrences,
        drivers: Array.from(g.drivers).sort(),
        days_open: g.first_reported ? Math.max(0, -daysUntil(g.first_reported)) : null,
        reports: sortedReports,
      });
    }
    out.sort((a, b) => (b.days_open || 0) - (a.days_open || 0));
    return out;
  }

  // Open-defect count for a single unit. Used by the Fleet view to badge
  // vehicle cards.
  function defectCountForUnit(unitId) {
    return openDefects().filter(d => d.unit === unitId).length;
  }

  // Compute the live "due" view: every schedule rule expanded across the
  // units it applies to, each augmented with last_performed + due status.
  function maintenanceDueList() {
    const rules = (MAINTENANCE && MAINTENANCE.schedule) || [];
    const out = [];
    for (const rule of rules) {
      const units = resolveScheduleUnits(rule);
      for (const uid of units) {
        const last = lastLogFor(uid, rule.item);
        let dueDate = null, dueKm = null, status = "unknown";
        if (rule.interval_type === "date" && rule.interval_days) {
          if (last && last.date) {
            const d = new Date(last.date + "T00:00:00");
            d.setDate(d.getDate() + rule.interval_days);
            dueDate = d.toISOString().slice(0, 10);
            const days = daysUntil(dueDate);
            status = days == null ? "unknown" : days < 0 ? "overdue" : days <= 30 ? "due-soon" : "ok";
          } else {
            status = "no-history";
          }
        } else if (rule.interval_type === "km" && rule.interval_km) {
          if (last && last.odometer_km != null) {
            dueKm = last.odometer_km + rule.interval_km;
            // We don't know the live odometer cheaply here. The view layer
            // can compare to the last Titan trip's endingOdometer for the
            // unit if it cares about km-based "now" precision.
            status = "tracked-km";
          } else {
            status = "no-history";
          }
        }
        out.push({
          unit: uid,
          item: rule.item,
          interval_type: rule.interval_type,
          interval_days: rule.interval_days,
          interval_km: rule.interval_km,
          priority: rule.priority || "routine",
          notes: rule.notes || "",
          last_log: last,
          due_date: dueDate,
          due_km: dueKm,
          status,
        });
      }
    }
    return out;
  }

  // ----- Bootstrap (async): fetch latest.json + registry, populate adapter state.
  async function init() {
    const latestUrl   = window.NORFAB_LATEST_JSON_URL   || "./latest.json";
    const registryUrl = window.CASCADE FREIGHT_REGISTRY_JSON_URL || "./drivers.json";
    const metaUrl     = window.CASCADE FREIGHT_FLEET_META_URL    || "./fleet-meta.json";
    const maintUrl    = window.CASCADE FREIGHT_MAINTENANCE_URL   || "./maintenance.json";
    // credentials: "include" is required for cross-origin fetches to the
    // Cloudflare Worker API when Access is protecting the /admin route.
    // Without it, the browser refuses to send the CF_AppSession cookie
    // and Access redirects each fetch to the login page (which returns
    // HTML, not JSON, silently blanking the dashboard). Harmless for
    // same-origin requests to ./latest.json etc.
    const FETCH_OPTS = { cache: "no-store", credentials: "include" };
    let latest = {};
    let registry = {};
    try {
      const r = await fetch(latestUrl, FETCH_OPTS);
      if (r.ok) latest = await r.json();
    } catch (e) { console.error("Failed to load latest.json:", e); }
    try {
      const r = await fetch(registryUrl, FETCH_OPTS);
      if (r.ok) registry = await r.json();
    } catch (e) { /* registry is optional - drivers just won't have tokens */ }
    try {
      const r = await fetch(metaUrl, FETCH_OPTS);
      if (r.ok) FLEET_META = await r.json();
    } catch (e) { /* fleet-meta is optional - vehicles default to in_service, no expiry warnings */ }
    try {
      const r = await fetch(maintUrl, FETCH_OPTS);
      if (r.ok) MAINTENANCE = await r.json();
    } catch (e) { /* maintenance is optional - empty schedule + log = no maintenance UI data */ }

    DRIVERS = buildDrivers(latest, registry);
    // All adapted Titan records up-front so we can split into TRIPS (real
    // drives, with a driver assigned) and YARD_MOVES (unassigned brief
    // movements at the home terminal — surfaced separately so the unit
    // view can show "truck was touched on May 26" even on no-driver days).
    const ALL_ADAPTED = (latest.titan_records || []).map(adaptTrip);
    TRIPS = ALL_ADAPTED.filter(t => t.driver);
    YARD_MOVES = ALL_ADAPTED.filter(t => !t.driver && isYardMove(t));
    DVIR  = (latest.sitedocs_records || []).map(adaptInspection).filter(i => i.driver);

    // CALENDAR_TODAY = wall-clock today in the fleet's local timezone.
    // LATEST_DATA_DAY = most recent day with any fleet activity (might be earlier).
    // TODAY = the day the dashboard renders. Falls back to LATEST_DATA_DAY when
    // there's no activity today yet (so the dashboard isn't empty on a quiet
    // morning), but the hero shows the calendar date so users know it's Tuesday.
    //
    // Mountain-local (see localTodayISO). Must not be UTC — UTC midnight is
    // 6pm Mountain, which previously made evening renders think "today" was
    // tomorrow and show a self-contradictory "no activity today, showing
    // latest from <today>" banner.
    const CALENDAR_TODAY = localTodayISO();
    const LATEST_DATA_DAY = TRIPS.length ? TRIPS.map(t => t.date).sort().slice(-1)[0] : null;
    const todayHasActivity = !!LATEST_DATA_DAY && TRIPS.some(t => t.date === CALENDAR_TODAY);
    TODAY = todayHasActivity ? CALENDAR_TODAY : (LATEST_DATA_DAY || CALENDAR_TODAY);

    // Sync timestamp pulled from the registry (publisher writes this on
    // every run). Falls back to latest.json's generated_at if present.
    const LATEST_SYNC_UTC =
      (registry && registry.updated_at_utc) ||
      (latest && latest.generated_at) ||
      "";

    // Refresh the live API in case anyone took a reference earlier.
    Object.assign(window.NORFAB_DATA, {
      DRIVERS, UNITS, TRIPS, YARD_MOVES, DVIR, FLEET_META, MAINTENANCE,
      dayCompliance, todayStatus, roadsideUrl, roadsideStaticUrl, roadsidePdfUrl, roadsidePhoneViewUrl, tripsForRange, minToHHMM,
      vehicleMeta, driverMeta, daysUntil, localTodayISO,
      resolveScheduleUnits, lastLogFor, maintenanceDueList,
      openDefects, defectCountForUnit,
      TODAY, CALENDAR_TODAY, LATEST_DATA_DAY, LATEST_SYNC_UTC, PPB, SFC, PUBLISH_BASE,
    });
    window.dispatchEvent(new CustomEvent("nf-data-ready"));
  }

  // Expose an empty shell synchronously so component files don't crash on load.
  window.NORFAB_DATA = {
    DRIVERS, UNITS, TRIPS, YARD_MOVES, DVIR, FLEET_META,
    dayCompliance, todayStatus, roadsideUrl, roadsideStaticUrl, roadsidePdfUrl, roadsidePhoneViewUrl, tripsForRange, minToHHMM,
    vehicleMeta, driverMeta, daysUntil, localTodayISO,
    TODAY, PPB, SFC, PUBLISH_BASE,
    init, ready: false,
  };

  // ----- Auto-refresh: poll for new pipeline output every 5 minutes while
  // the tab is visible. The dashboard publishes hourly (xx:07), so a 5
  // minute poll catches new data within ~5 minutes of it landing. When
  // the tab is hidden (Ray opened another window / locked the screen)
  // polling pauses to keep traffic minimal. Visibility wakeup also
  // triggers an immediate refetch so the dashboard is current the moment
  // it's brought back into focus.
  const POLL_INTERVAL_MS = 5 * 60 * 1000;
  let pollInFlight = false;
  let lastFetchAtMs = 0;
  async function refetch(reason) {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      await init();
      lastFetchAtMs = Date.now();
      window.NORFAB_DATA.LAST_FETCH_AT_MS = lastFetchAtMs;
      window.dispatchEvent(new CustomEvent("nf-data-refreshed", { detail: { reason } }));
    } finally {
      pollInFlight = false;
    }
  }
  function startPolling() {
    setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refetch("interval");
    }, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        // Only auto-refetch on wake if we've been hidden long enough that
        // data might be stale. Avoids hammering the CDN on quick tab
        // switches.
        const ageMs = Date.now() - lastFetchAtMs;
        if (ageMs > POLL_INTERVAL_MS) refetch("visibility");
      }
    });
  }

  // Kick the loader. The app polls nf-data-ready to know when to re-render.
  init().then(() => {
    window.NORFAB_DATA.ready = true;
    lastFetchAtMs = Date.now();
    window.NORFAB_DATA.LAST_FETCH_AT_MS = lastFetchAtMs;
    startPolling();
  });
})();
