// Trip Detail screen, map + timeline of stops for a single day
// Shows the GPS evidence chain that proves NSC compliance

const TripDetail = ({ unitId, dayISO, onClose, onPrint }) => {
  const D = window.NORFAB_DATA;
  const unit = D.UNITS.find(u => u.id === unitId);
  const trips = D.TRIPS.filter(t => t.unit === unitId && t.date === dayISO).sort((a, b) => a.start_min - b.start_min);
  if (!unit || trips.length === 0) {
    return (
      <div style={{ padding: 32 }}>
        <Btn kind="secondary" onClick={onClose}>← Back</Btn>
        <p style={{ marginTop: 16 }}>No trips logged for {dayISO} on {unitId}.</p>
      </div>
    );
  }

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
            <Btn kind="ghost" onClick={onClose} size="sm" style={{ marginLeft: -8, marginBottom: 8 }}>← Back to dashboard</Btn>
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
            <Btn kind="primary" size="sm" icon={<Icon name="file-down" size={14} />}>Export evidence</Btn>
          </div>
        </div>

        <Card padding={0} style={{ flex: 1, minHeight: 320, position: "relative", overflow: "hidden" }}>
          <TripMap trips={trips} ppb={D.PPB} />
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
function TripMap({ trips, ppb }) {
  // Project lat/lng onto a 1000x600 SVG viewport (Edmonton-area Mercator-ish)
  // Bounding: include PPB and all sites
  const pts = [{ lat: ppb.lat, lng: ppb.lng }, ...trips.map(t => ({ lat: t.site_lat, lng: t.site_lng }))];
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  const padLat = 0.06, padLng = 0.12;
  const minLat = Math.min(...lats) - padLat, maxLat = Math.max(...lats) + padLat;
  const minLng = Math.min(...lngs) - padLng, maxLng = Math.max(...lngs) + padLng;
  const W = 1000, H = 600;
  const proj = (lat, lng) => [
    ((lng - minLng) / (maxLng - minLng)) * W,
    ((maxLat - lat) / (maxLat - minLat)) * H,
  ];
  const [px, py] = proj(ppb.lat, ppb.lng);

  // Subtle grid + river path (decorative, represents N. Saskatchewan)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%", background: "#F1F3F5", display: "block" }}>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E5E9" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      {/* River */}
      <path d="M -20 380 Q 250 320, 480 360 T 1020 300" stroke="#CBD5DC" strokeWidth="14" fill="none" strokeLinecap="round" opacity="0.7" />
      {/* PPB radius rings */}
      <circle cx={px} cy={py} r={Math.min(W, H) * 0.04} fill="none" stroke="var(--navy-700)" strokeWidth="1" strokeDasharray="3 4" opacity="0.35" />
      <circle cx={px} cy={py} r={Math.min(W, H) * 0.18} fill="none" stroke="var(--navy-700)" strokeWidth="1" strokeDasharray="3 4" opacity="0.2" />
      {/* Trip lines */}
      {trips.map((t, i) => {
        const [sx, sy] = proj(t.site_lat, t.site_lng);
        const ctrlX = (px + sx) / 2 + (sy - py) * 0.2;
        const ctrlY = (py + sy) / 2 - (sx - px) * 0.2;
        return (
          <path key={`p-${i}`} d={`M ${px} ${py} Q ${ctrlX} ${ctrlY} ${sx} ${sy}`}
            fill="none" stroke={t.flagged ? "var(--accent-600)" : "var(--navy-700)"}
            strokeWidth={t.flagged ? 2 : 1.5} opacity="0.85" />
        );
      })}
      {/* Site markers */}
      {trips.map((t, i) => {
        const [sx, sy] = proj(t.site_lat, t.site_lng);
        return (
          <g key={`m-${i}`}>
            <circle cx={sx} cy={sy} r={9} fill="var(--white)" stroke={t.flagged ? "var(--accent-600)" : "var(--navy-900)"} strokeWidth="1.5" />
            <text x={sx} y={sy + 3.5} textAnchor="middle" style={{ font: "600 10px var(--font-sans)", fill: "var(--navy-900)" }}>{i + 1}</text>
          </g>
        );
      })}
      {/* PPB marker */}
      <g>
        <rect x={px - 8} y={py - 8} width={16} height={16} fill="var(--navy-900)" />
        <rect x={px - 5} y={py - 5} width={10} height={10} fill="var(--accent-600)" />
      </g>
      <text x={px + 14} y={py + 4} style={{ font: "600 11px var(--font-sans)", fill: "var(--navy-900)" }}>Principal Place of Business</text>
      <text x={px + 14} y={py + 18} style={{ font: "10px var(--font-sans)", fill: "var(--fg-muted)" }}>16425 130 Ave NW, Edmonton</text>
      {/* Scale */}
      <g transform={`translate(24, ${H - 30})`}>
        <rect width="120" height="4" fill="var(--navy-900)" />
        <text x="0" y="20" style={{ font: "10px var(--font-sans)", fill: "var(--fg-muted)" }}>~10 km</text>
      </g>
      {/* Legend */}
      <g transform={`translate(${W - 220}, 20)`}>
        <rect width="200" height="74" fill="var(--white)" stroke="var(--border)" />
        <text x="12" y="18" style={{ font: "600 10px var(--font-sans)", fill: "var(--fg-muted)", letterSpacing: "0.12em" }}>LEGEND</text>
        <line x1="12" y1="34" x2="32" y2="34" stroke="var(--navy-700)" strokeWidth="1.5" />
        <text x="40" y="38" style={{ font: "11px var(--font-sans)", fill: "var(--navy-900)" }}>Compliant trip</text>
        <line x1="12" y1="52" x2="32" y2="52" stroke="var(--accent-600)" strokeWidth="2" />
        <text x="40" y="56" style={{ font: "11px var(--font-sans)", fill: "var(--navy-900)" }}>Flagged trip</text>
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
