// Norfab Fleet Compliance, pure regulation-evaluation module.
//
// This is the testable, pure-function version of the compliance logic
// that ALSO lives inside data.js's IIFE. Both must stay in sync; the
// long-term plan is for data.js to import from here so there's one
// source of truth. Until that migration lands, this module is the
// canonical reference (tests pin its behavior) and data.js is the
// browser-loaded copy (currently identical logic).
//
// Everything here is pure: functions take all their inputs as
// arguments and return values. No module-level mutable state.
// Safe to test, safe to call from any context (Node CI, browser, etc.).
//
// References:
//   AB Reg 317/2002 §78, 160 km exemption for commercial vehicles
//   NSC Standard 9, daily hours of service
//   NSC Standard 13, vehicle inspection requirements

// ---------- regulatory constants ----------
// Edit ONLY with a citation to the regulation that changed.
export const SHIFT_LIMIT_HOURS = 15;       // 160 km exemption: shift released within 15h
export const RETURN_TOLERANCE_KM = 1.5;    // a return is within this radius of day-start
export const RADIUS_LIMIT_KM = 160;        // the "160 km" in "160 km exemption"

// ---------- math helpers ----------

// Round hours to nearest 0.25h (15-min legal precision).
export function roundQuarterHour(hours) {
  if (!isFinite(hours)) return 0;
  return Math.round(hours * 4) / 4;
}

// Great-circle distance between two {lat, lon} points in km.
export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Compute haversine km between two [lat, lng] arrays (the shape adaptTrip emits).
export function coordDistKm(a, b) {
  if (!a || !b) return null;
  return haversineKm({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
}

// A "noise" trip is engine-on telemetry that isn't really a trip:
// distance < 100 m AND wall-clock < 2 min. Titan emits these when a vehicle
// is started, rolls a few feet, and shuts off (yard re-parks, idle blips).
export function isNoiseTrip(t) {
  const km = Number(t && t.km) || 0;
  const dur = Math.max(0, (Number(t && t.end_min) || 0) - (Number(t && t.start_min) || 0));
  return km < 0.1 && dur < 2;
}

// ---------- duty-segment builder ----------
// Returns a list of {start, end, row} where row: 0=Off, 1=Sleeper, 2=Driving, 3=OnDuty.
// Guarantees: sorted, non-overlapping, covers exactly 24*60 minutes, rows in {0..3}.
export function buildSegmentsFromTrips(trips, pre, post) {
  const DAY = 24 * 60;
  const clamp = (v) => Math.max(0, Math.min(DAY, v));
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
  const preTimeMin = (pre && Number.isFinite(pre.time_min)) ? clamp(pre.time_min) : null;
  const postTimeMin = (post && Number.isFinite(post.time_min)) ? clamp(post.time_min) : null;
  const firstStart = drives[0].start;
  const lastEnd = drives[drives.length - 1].end;
  const workStart = (preTimeMin != null && preTimeMin < firstStart) ? preTimeMin : firstStart;
  const workEnd = (postTimeMin != null && postTimeMin > lastEnd) ? postTimeMin : lastEnd;
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

// ---------- main entry point ----------
//
// Evaluate compliance for a single driver-day per AB Reg 317/2002 §78.
// All three conditions must be met for "exempt":
//   (a) operates within 160 km of the day-start location
//   (b) returns to the day-start location at end of day (within RETURN_TOLERANCE_KM)
//   (c) released from work within 15 hours of coming on duty
//
// Inputs (PURE, no module state):
//   driverId  - the driver identifier (matches t.driver in trips)
//   dayISO    - ISO date string "YYYY-MM-DD"
//   trips     - array of trip records (TRIPS from data.js's adaptTrip shape)
//   dvir      - array of inspection records (DVIR from adaptInspection shape)
//
// Returns: a compliance verdict object, see end of function for shape.
export function dayCompliance(driverId, dayISO, trips, dvir, options = {}) {
  trips = Array.isArray(trips) ? trips : [];
  dvir  = Array.isArray(dvir) ? dvir : [];
  // options:
  //   today_iso  - the ISO date to compare against for past-day completion.
  //                Defaults to today's Mountain-local date. NOT UTC: UTC
  //                midnight is 6pm Mountain, so a UTC default would mark
  //                today's days complete every evening. Callers (the
  //                dashboard) pass an explicit Mountain-local today_iso;
  //                tests pass a fixed value.
  //   now_ms     - the wall-clock reference for the idle threshold.
  //                Defaults to Date.now(). Tests pass a fixed value for
  //                deterministic results.
  const today_iso = options.today_iso || new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
  const now_ms    = Number.isFinite(options.now_ms) ? options.now_ms : Date.now();

  const dayTrips = trips
    .filter(t => t.driver === driverId && t.date === dayISO)
    .filter(t => !isNoiseTrip(t))
    .sort((a, b) => (a.start_min || 0) - (b.start_min || 0));

  if (dayTrips.length === 0) {
    return {
      state: "none", trips: 0, km: 0, drive_hrs: 0, onduty_hrs: 0, shift_hrs: 0,
      pre: null, post: null, dayTrips: [], reasons: [],
      outside: false, allReturned: true, over_shift_limit: false,
      day_start_coords: null, max_radius_km: 0,
      subject_to_hos: false, primary_unit_class: "", trailer_on_day: false,
      day_complete: dayISO < today_iso, idle_minutes: null,
    };
  }

  const km = dayTrips.reduce((s, t) => s + (t.km || 0), 0);
  const first = dayTrips[0].start_min || 0;
  const last  = dayTrips[dayTrips.length - 1].end_min || 0;
  const shiftMin = Math.max(0, last - first);

  // Compute duty minutes the same way the chart draws them: each merged
  // driving interval is DRIVING; gaps between intervals are ON-DUTY.
  // Merge overlapping/duplicate trip intervals first, Titan emits
  // duplicates when GPS is noisy and totals can exceed 24h otherwise.
  const mergedDrives = [];
  const sortedByStart = [...dayTrips]
    .filter(t => Number.isFinite(t.start_min) && Number.isFinite(t.end_min) && t.end_min >= t.start_min)
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
  const pre  = dvir.find(i => i.driver === driverId && i.date_local === dayISO && i.trip_type === "Pre") || null;
  const post = dvir.find(i => i.driver === driverId && i.date_local === dayISO && i.trip_type === "Post") || null;
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
  // NOT the carrier PPB address. Drivers who take the truck home overnight
  // start their day at home, not at the yard.
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
  // (per condition (b)). Missing coords = conservatively NOT returned (so
  // the day isn't silently exempted on missing data).
  let returnDistKm = null;
  if (dayStart && dayEnd) returnDistKm = coordDistKm(dayStart, dayEnd);
  const allReturned = (returnDistKm != null) && (returnDistKm <= RETURN_TOLERANCE_KM);
  const over_shift_limit = (shiftMin / 60) > SHIFT_LIMIT_HOURS;

  // HOS subjectivity: Alberta hours-of-service rules (AR 317/2002) only
  // apply to commercial vehicles with GVW >= 11,794 kg, or truck/trailer
  // combinations that hit that threshold. Light pickups under that weight
  // aren't subject to the 160 km exemption test at all - no logbook of
  // any kind is required regardless of distance or hours.
  // Conservative model (we don't track trailer GVWs, only presence):
  //   heavy unit (any day)         -> subject (always run the test)
  //   light unit + trailer on DVI  -> subject (combined weight unknown)
  //   light unit + no trailer      -> NOT subject (skip the test)
  // Default to "heavy" for trips missing unit_class so unrecognised
  // vehicles are treated conservatively.
  const primaryUnitClass = (dayTrips[0] && dayTrips[0].unit_class) || "heavy";
  const trailer_on_day = !!(
    (pre  && pre.trailer_unit  && String(pre.trailer_unit).trim()) ||
    (post && post.trailer_unit && String(post.trailer_unit).trim())
  );
  const subject_to_hos = primaryUnitClass === "heavy" || trailer_on_day;

  // Day-complete gate for the "returned to start" check.
  // Condition (b) of the 160 km exemption is an END-OF-DAY determination,
  // so flagging mid-shift produces false alarms (the driver is obviously
  // away from start during work). A day is complete when ANY of:
  //   1. The calendar date is in the past
  //   2. A post-trip DVI has been filed (explicit driver sign-off)
  //   3. The truck is currently parked at the day-start location AND
  //      has been idle for >= IDLE_DONE_THRESHOLD_MIN minutes
  // Clause 3 re-evaluates each call: a driver who came home for a long
  // lunch and then went back out automatically flips back to "in progress"
  // when the next trip's data arrives.
  const IDLE_DONE_THRESHOLD_MIN = 120;
  let idle_minutes = null;
  const last_trip = dayTrips[dayTrips.length - 1];
  if (last_trip && Number.isFinite(last_trip.end_min)) {
    const last_end_ms = new Date(`${dayISO}T00:00:00`).getTime() + last_trip.end_min * 60 * 1000;
    idle_minutes = (now_ms - last_end_ms) / (60 * 1000);
  }
  const day_complete = dayISO < today_iso
    || !!post
    || (allReturned && idle_minutes != null && idle_minutes >= IDLE_DONE_THRESHOLD_MIN);
  const return_check_failed = day_complete && !allReturned;

  let state = (outside || return_check_failed || over_shift_limit) ? "full-log" : "exempt";
  if (!subject_to_hos) {
    // Light unit, no trailer on DVI: not in scope of the regulation.
    // Force state back to "exempt" (the compliant/no-flag visual) and
    // suppress the failure reasons so consumers don't show the orange
    // "Full log" pill or the day-detail banner.
    state = "exempt";
  }

  const totalOnDutyMin = driveMin + onDutyMin;

  // Annotate each displayed trip with its max distance from the day-start
  // location. Overwrites the legacy adaptTrip outside_radius (PPB-relative)
  // with the regulation-correct value (day-start-relative).
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
      over_shift_limit && `work shift exceeded ${SHIFT_LIMIT_HOURS} hours (${(shiftMin / 60).toFixed(1)}h recorded)`,
    ].filter(Boolean) : [],
  };
}
