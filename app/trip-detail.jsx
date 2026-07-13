// Trip Detail screen, map + timeline of stops for a single day
// Shows the GPS evidence chain that proves NSC compliance

// Haversine km between two [lat, lng] arrays. Presentation-side copy of
// data.js's coordDistKm (which is not exported); used to annotate this
// screen's trips against the day-start anchor.
function tripDetailDistKm(a, b) {
  if (!a || !b || a[0] == null || b[0] == null) return null;
  const R = 6371, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Annotate a day's raw trips against the DAY-START location (where the first
// trip began), not the carrier PPB. Same anchor + rule dayCompliance uses;
// the raw adaptTrip outside_radius is PPB-based and documented there as
// producing nonsense per-trip. Shared by the vehicle trip screen AND the
// driver day screen so both draw identical maps and flags. Sorts internally
// (by start_min) so callers can pass an unsorted filter result safely.
// Returns { trips, dayStart, maxRadiusKm }.
function annotateDayTrips(rawTrips) {
  const sorted = [...(rawTrips || [])].sort((a, b) => a.start_min - b.start_min);
  const dayStart = sorted.length
    ? (sorted[0].startCoords || sorted.map(t => t.startCoords || t.endCoords).find(Boolean) || null)
    : null;
  const trips = sorted.map(t => {
    let d = 0;
    if (dayStart) {
      for (const c of [t.startCoords, t.endCoords]) {
        const dd = tripDetailDistKm(dayStart, c);
        if (dd != null && dd > d) d = dd;
      }
    }
    const outside_radius = dayStart ? d > 160 : t.outside_radius;
    return {
      ...t,
      dist_from_start_km: d,
      outside_radius,
      flagged: outside_radius || (t.flags && t.flags.length > 0),
    };
  });
  const maxRadiusKm = Math.max(0, ...trips.map(t => t.dist_from_start_km || 0));
  return { trips, dayStart, maxRadiusKm };
}

const TripDetail = ({ unitId, dayISO, onClose, onPrint }) => {
  const D = window.NORFAB_DATA;
  const unit = D.UNITS.find(u => u.id === unitId);
  const rawTrips = D.TRIPS.filter(t => t.unit === unitId && t.date === dayISO);
  if (!unit || rawTrips.length === 0) {
    return (
      <div style={{ padding: 32 }}>
        <Btn kind="secondary" onClick={onClose}>← Back</Btn>
        <p style={{ marginTop: 16 }}>No trips logged for {dayISO} on {unitId}.</p>
      </div>
    );
  }

  const { trips, dayStart, maxRadiusKm } = annotateDayTrips(rawTrips);

  const totalKm = trips.reduce((s, t) => s + t.km, 0);
  const totalMin = trips[trips.length - 1].end_min - trips[0].start_min;
  const flagged = trips.filter(t => t.flagged);
  const dateLabel = new Date(dayISO + "T12:00").toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 24, padding: 24, height: "100%", minHeight: 0 }}>
      {/* Map + header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <Btn kind="ghost" onClick={onClose} size="sm" style={{ marginLeft: -8, marginBottom: 8 }}>← Back</Btn>
            <Eyebrow>Trip detail · Unit {unit.id}</Eyebrow>
            <div style={{ font: "700 28px/1.15 var(--font-display)", color: "var(--navy-900)", letterSpacing: "-0.01em", marginTop: 6 }}>
              {dateLabel}
            </div>
            <div style={{ font: "14px/1.5 var(--font-sans)", color: "var(--fg-subtle)", marginTop: 4 }}>
              {unit.year} {unit.make} {unit.model} · {unit.driver} · GVW {unit.gvw_kg.toLocaleString()} kg
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="secondary" size="sm" onClick={onPrint} icon={<Icon name="printer" size={14} />}>Print</Btn>
          </div>
        </div>

        <Card padding={0} style={{ flex: 1, minHeight: 320, position: "relative", overflow: "hidden" }}>
          <TripMap trips={trips} dayStart={dayStart} maxRadiusKm={maxRadiusKm} />
        </Card>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)",
        }}>
          <Stat label="Trips" value={trips.length} />
          <Stat label="Distance" value={`${totalKm.toFixed(1)} km`} sub={unit.klass === "heavy" ? "160 km exemption applies" : "Light unit"} />
          <Stat label="Window" value={`${D.minToHHMM(trips[0].start_min)} – ${D.minToHHMM(trips[trips.length - 1].end_min)}`} sub={`${(totalMin / 60).toFixed(1)} hrs span`} />
          <Stat label="Flags" value={flagged.length} accent={flagged.length ? "var(--accent-600)" : undefined}
            sub={flagged.length ? flagged.map(f => f.outside_radius ? "Outside radius" : (f.flags && f.flags[0]) || "Flagged").join(" · ") : "Clean day"} />
        </div>
      </div>

      {/* Timeline rail */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <SectionHead title="Stop timeline" eyebrow={`${trips.length} trip${trips.length === 1 ? "" : "s"}`} />
        <div style={{ overflowY: "auto", flex: 1, paddingRight: 4 }}>
          <Timeline trips={trips} />
        </div>
      </div>
    </div>
  );
};

// ---------- Map ----------
// Real interactive map (Leaflet + OpenStreetMap): zoom/pan, actual roads
// and place names for orientation, numbered stop markers with popups, a
// geodesically TRUE 160 km exemption circle around the day-start anchor,
// and a built-in scale control. Legs are straight lines between GPS
// points (not road routing) and the map says so.
function TripMap({ trips, dayStart, maxRadiusKm }) {
  const containerRef = React.useRef(null);

  // Cluster stops that share a location (return-to-yard days) so numbered
  // markers don't stack invisibly. ~11 m resolution.
  const clusters = new Map();
  trips.forEach((t, i) => {
    const end = t.endCoords || (t.site_lat != null ? [t.site_lat, t.site_lng] : null);
    if (!end) return;
    const key = `${end[0].toFixed(4)}:${end[1].toFixed(4)}`;
    if (!clusters.has(key)) clusters.set(key, { pos: end, stops: [] });
    clusters.get(key).stops.push({ n: i + 1, t });
  });

  React.useEffect(() => {
    if (!window.L || !containerRef.current) return;
    const L = window.L;
    const NAVY = "#3C5E7E", ACCENT = "#D9501F", INK = "#112436";
    const map = L.map(containerRef.current, { zoomSnap: 0.5 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    const boundPts = [];

    // TRUE 160 km exemption circle around the day-start anchor
    if (dayStart) {
      L.circle(dayStart, {
        radius: 160000, color: ACCENT, weight: 1.5,
        dashArray: "6 6", fill: false, opacity: 0.6,
      }).addTo(map);
      L.marker(dayStart, {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:16px;height:16px;background:${INK};display:grid;place-items:center">
                   <div style="width:8px;height:8px;background:${ACCENT}"></div></div>`,
          iconSize: [16, 16], iconAnchor: [8, 8],
        }),
        zIndexOffset: 500,
      }).addTo(map).bindTooltip("Day start", { permanent: false });
      boundPts.push(dayStart);
    }

    // Route legs in chronological order (straight lines between GPS points)
    const D = window.NORFAB_DATA;
    for (const t of trips) {
      const s = t.startCoords, e = t.endCoords || (t.site_lat != null ? [t.site_lat, t.site_lng] : null);
      if (s) boundPts.push(s);
      if (e) boundPts.push(e);
      if (!s || !e) continue;
      L.polyline([s, e], {
        color: t.flagged ? ACCENT : NAVY,
        weight: t.flagged ? 3 : 2.5, opacity: 0.85,
      }).addTo(map);
    }

    // Numbered stop markers (clustered when co-located) with detail popups
    for (const c of clusters.values()) {
      const nums = c.stops.map(s => s.n);
      const anyFlag = c.stops.some(s => s.t.flagged);
      const label = nums.length > 1 ? `${nums[0]}+` : `${nums[0]}`;
      const popup = c.stops.map(s =>
        `<div style="margin:2px 0"><b>Stop ${s.n}</b> · ${s.t.site || "Unnamed"}<br>` +
        `${D.minToHHMM(s.t.start_min)} → ${D.minToHHMM(s.t.end_min)} · ${s.t.km.toFixed(1)} km` +
        `${s.t.outside_radius ? ' · <span style="color:#D9501F;font-weight:600">Outside 160 km</span>' : ""}</div>`
      ).join("");
      L.marker(c.pos, {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:22px;height:22px;border-radius:50%;background:#fff;` +
            `border:2px solid ${anyFlag ? ACCENT : INK};display:grid;place-items:center;` +
            `font:600 11px 'Segoe UI',sans-serif;color:${INK}">${label}</div>`,
          iconSize: [22, 22], iconAnchor: [11, 11],
        }),
        zIndexOffset: 600, // above the day-start square so stop numbers stay readable at the yard
      }).addTo(map).bindPopup(popup);
    }

    if (boundPts.length > 0) {
      map.fitBounds(L.latLngBounds(boundPts).pad(0.25), { maxZoom: 15 });
    } else {
      map.setView([53.55, -113.5], 9);
    }
    L.control.scale({ imperial: false }).addTo(map);

    return () => { map.remove(); };
  }, []);

  if (!window.L) {
    return <TripMapSchematic trips={trips} dayStart={dayStart} maxRadiusKm={maxRadiusKm} />;
  }
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      {/* Compliance readout above the map panes */}
      <div style={{
        position: "absolute", top: 12, right: 12, zIndex: 1100,
        background: "var(--white)", border: "1px solid var(--border)",
        padding: "8px 12px", boxShadow: "0 1px 4px rgba(17,36,54,0.12)",
      }}>
        <div style={{ font: "600 9.5px var(--font-sans)", color: "var(--fg-muted)", letterSpacing: "0.12em" }}>FURTHEST POINT FROM DAY START</div>
        <div style={{ font: "600 13px var(--font-sans)", marginTop: 2, color: maxRadiusKm > 160 ? "var(--accent-600)" : "var(--navy-900)" }}>
          {maxRadiusKm.toFixed(1)} km of 160 km limit
        </div>
      </div>
      <div style={{
        position: "absolute", bottom: 4, left: 80, zIndex: 1100,
        font: "10px var(--font-sans)", color: "var(--fg-muted)",
        background: "rgba(255,255,255,0.8)", padding: "1px 6px",
      }}>
        Straight-line legs between GPS points, not road routes
      </div>
    </div>
  );
}

// Fallback schematic when the Leaflet CDN is unreachable.
function TripMapSchematic({ trips, dayStart, maxRadiusKm }) {
  const W = 1000, H = 600;
  const RADIUS_KM = 160;

  // Collect every plottable point (trip start + end + day start).
  const rawPts = [];
  if (dayStart) rawPts.push(dayStart);
  for (const t of trips) {
    if (t.startCoords) rawPts.push(t.startCoords);
    if (t.endCoords) rawPts.push(t.endCoords);
    else if (t.site_lat != null) rawPts.push([t.site_lat, t.site_lng]);
  }
  if (rawPts.length === 0) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
        No GPS coordinates recorded for this day.
      </div>
    );
  }

  // km-space conversion (equirectangular, cos-corrected at the mid-latitude
  // so horizontal and vertical kilometres render at the same length).
  const midLat = rawPts.reduce((s, p) => s + p[0], 0) / rawPts.length;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.320 * Math.cos((midLat * Math.PI) / 180);
  const originLat = Math.max(...rawPts.map(p => p[0]));
  const originLng = Math.min(...rawPts.map(p => p[1]));
  const toKm = ([lat, lng]) => [
    (lng - originLng) * kmPerDegLng,
    (originLat - lat) * kmPerDegLat,
  ];
  const kmPts = rawPts.map(toKm);
  const spanX = Math.max(1, ...kmPts.map(p => p[0]));
  const spanY = Math.max(1, ...kmPts.map(p => p[1]));
  const pad = Math.max(1.5, Math.max(spanX, spanY) * 0.18);
  // Uniform px-per-km so distances are true in every direction.
  const scale = Math.min(W / (spanX + pad * 2), H / (spanY + pad * 2));
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  const proj = (coords) => {
    const [kx, ky] = toKm(coords);
    return [offX + kx * scale, offY + ky * scale];
  };

  const anchor = dayStart ? proj(dayStart) : null;
  const ringPx = RADIUS_KM * scale;

  // Scale bar: pick a round km value that renders 80-220 px wide.
  const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200];
  const scaleKm = niceSteps.find(k => k * scale >= 80 && k * scale <= 220) ||
    niceSteps[niceSteps.length - 1];
  const scalePx = scaleKm * scale;

  const segs = trips.filter(t => t.startCoords && (t.endCoords || t.site_lat != null));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: "100%", height: "100%", background: "#F1F3F5", display: "block" }}>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E5E9" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />

      {/* TRUE 160 km exemption ring around the day-start anchor. On local
          days it sits far outside the viewport (SVG clips it silently);
          when a day pushes toward the limit it enters the frame exactly
          where the regulation says it is. */}
      {anchor && (
        <circle cx={anchor[0]} cy={anchor[1]} r={ringPx} fill="none"
          stroke="var(--accent-600)" strokeWidth="1.5" strokeDasharray="6 5" opacity="0.5" />
      )}

      {/* Route segments in chronological order. Each leg is offset a few
          pixels perpendicular to its OWN direction of travel — an
          out-and-back pair (A→B then B→A) offsets to opposite sides, so
          the two movements render as two parallel lines instead of one
          invisible overlap. Mid-line arrowheads show direction. */}
      {segs.map((t, i) => {
        const [sx, sy] = proj(t.startCoords);
        const [ex, ey] = proj(t.endCoords || [t.site_lat, t.site_lng]);
        const dx = ex - sx, dy = ey - sy;
        const len = Math.hypot(dx, dy);
        if (len < 2) return null; // zero-length yard move: marker only
        const off = 3, ux = -dy / len, uy = dx / len;
        const x1 = sx + ux * off, y1 = sy + uy * off;
        const x2 = ex + ux * off, y2 = ey + uy * off;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const color = t.flagged ? "var(--accent-600)" : "var(--navy-700)";
        return (
          <g key={`p-${i}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={color} strokeWidth={t.flagged ? 2 : 1.5} opacity="0.85" />
            <g transform={`translate(${mx}, ${my}) rotate(${ang})`}>
              <path d="M -5 -4 L 6 0 L -5 4 Z" fill={color} opacity="0.9" />
            </g>
          </g>
        );
      })}

      {/* Stop markers, numbered in timeline order. Stops at the SAME
          location (return-to-yard days produce several) are clustered
          into one marker listing every stop number, instead of stacking
          markers invisibly on top of each other. */}
      {(() => {
        const clusters = new Map();
        trips.forEach((t, i) => {
          const end = t.endCoords || (t.site_lat != null ? [t.site_lat, t.site_lng] : null);
          if (!end) return;
          const [ex, ey] = proj(end);
          const key = `${Math.round(ex / 16)}:${Math.round(ey / 16)}`;
          if (!clusters.has(key)) clusters.set(key, { x: ex, y: ey, nums: [], flagged: false });
          const c = clusters.get(key);
          c.nums.push(i + 1);
          c.flagged = c.flagged || t.flagged;
        });
        return Array.from(clusters.values()).map((c, ci) => (
          <g key={`m-${ci}`}>
            <circle cx={c.x} cy={c.y} r={10} fill="var(--white)"
              stroke={c.flagged ? "var(--accent-600)" : "var(--navy-900)"} strokeWidth="1.5" />
            <text x={c.x} y={c.y + 3.5} textAnchor="middle"
              style={{ font: "600 10px var(--font-sans)", fill: "var(--navy-900)" }}>
              {c.nums.length > 1 ? c.nums[0] : c.nums[0]}
            </text>
            {c.nums.length > 1 && (
              <text x={c.x + 15} y={c.y - 8}
                style={{ font: "600 10px var(--font-sans)", fill: "var(--fg-muted)" }}>
                Stops {c.nums.join(" · ")}
              </text>
            )}
          </g>
        ));
      })()}

      {/* Day-start anchor marker */}
      {anchor && (
        <g>
          <rect x={anchor[0] - 8} y={anchor[1] - 8} width={16} height={16} fill="var(--navy-900)" />
          <rect x={anchor[0] - 5} y={anchor[1] - 5} width={10} height={10} fill="var(--accent-600)" />
          <text x={anchor[0] + 14} y={anchor[1] + 4} style={{ font: "600 11px var(--font-sans)", fill: "var(--navy-900)" }}>Day start</text>
        </g>
      )}

      {/* Radius readout: the compliance fact this map exists to show */}
      <g transform="translate(24, 20)">
        <rect width="252" height="40" fill="var(--white)" stroke="var(--border)" />
        <text x="12" y="17" style={{ font: "600 10px var(--font-sans)", fill: "var(--fg-muted)", letterSpacing: "0.12em" }}>FURTHEST POINT FROM DAY START</text>
        <text x="12" y="33" style={{ font: "600 13px var(--font-sans)", fill: (maxRadiusKm > RADIUS_KM) ? "var(--accent-600)" : "var(--navy-900)" }}>
          {maxRadiusKm.toFixed(1)} km of {RADIUS_KM} km limit
        </text>
      </g>

      {/* True scale bar */}
      <g transform={`translate(24, ${H - 30})`}>
        <rect width={scalePx} height="4" fill="var(--navy-900)" />
        <text x="0" y="20" style={{ font: "10px var(--font-sans)", fill: "var(--fg-muted)" }}>{scaleKm} km</text>
      </g>

      {/* Schematic disclaimer */}
      <text x={W - 16} y={H - 14} textAnchor="end" style={{ font: "10px var(--font-sans)", fill: "var(--fg-muted)" }}>
        Schematic view · straight-line paths, not road routes
      </text>

      {/* Legend */}
      <g transform={`translate(${W - 220}, 20)`}>
        <rect width="200" height="92" fill="var(--white)" stroke="var(--border)" />
        <text x="12" y="18" style={{ font: "600 10px var(--font-sans)", fill: "var(--fg-muted)", letterSpacing: "0.12em" }}>LEGEND</text>
        <line x1="12" y1="34" x2="32" y2="34" stroke="var(--navy-700)" strokeWidth="1.5" />
        <text x="40" y="38" style={{ font: "11px var(--font-sans)", fill: "var(--navy-900)" }}>Compliant leg</text>
        <line x1="12" y1="52" x2="32" y2="52" stroke="var(--accent-600)" strokeWidth="2" />
        <text x="40" y="56" style={{ font: "11px var(--font-sans)", fill: "var(--navy-900)" }}>Flagged leg</text>
        <line x1="12" y1="70" x2="32" y2="70" stroke="var(--accent-600)" strokeWidth="1.5" strokeDasharray="6 5" opacity="0.6" />
        <text x="40" y="74" style={{ font: "11px var(--font-sans)", fill: "var(--navy-900)" }}>160 km exemption ring</text>
      </g>
    </svg>
  );
}

// ---------- Timeline ----------
function Timeline({ trips }) {
  const D = window.NORFAB_DATA;
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", left: 14, top: 8, bottom: 8, width: 1, background: "var(--border)" }} />
      {trips.map((t, i) => (
        <div key={`t-${i}`} style={{ position: "relative", paddingLeft: 36, paddingBottom: 20 }}>
          <div style={{
            position: "absolute", left: 7, top: 4,
            width: 16, height: 16, borderRadius: 999,
            background: t.flagged ? "var(--accent-600)" : "var(--navy-900)",
            color: "#fff", font: "600 10px/16px var(--font-sans)",
            textAlign: "center",
          }}>{i + 1}</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <div style={{ font: "600 13.5px/1.3 var(--font-sans)", color: "var(--navy-900)" }}>{t.site}</div>
            <div style={{ font: "600 11px/1 var(--font-mono)", color: "var(--fg-muted)" }}>#{t.id}</div>
          </div>
          <div style={{ font: "12.5px/1.5 var(--font-sans)", color: "var(--fg-subtle)", marginTop: 2 }}>
            {D.minToHHMM(t.start_min)} → {D.minToHHMM(t.end_min)} · {t.km.toFixed(1)} km
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {/* Per-trip "returned" pill removed, under AB 160 km rule only
                the day's FINAL trip's return matters, which is evaluated at
                the day level via dayCompliance.allReturned. Showing it on
                every mid-day trip was misleading (showed "no return" on
                trips that ended at job sites, which is normal). */}
            {t.outside_radius && <Pill tone="flag">Outside 160 km</Pill>}
            {t.endingOdometer != null && (
              <Pill tone="info">Odo {t.endingOdometer.toLocaleString()}</Pill>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

window.TripDetail = TripDetail;
