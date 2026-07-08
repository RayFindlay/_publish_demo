// Driver's Daily Log modal, single-day NSC-style log with duty graph.

const DailyLog = ({ unitId, dayISO, onClose }) => {
  const D = window.NORFAB_DATA;
  const unit = D.UNITS.find(u => u.id === unitId);
  const trips = D.TRIPS.filter(t => t.unit === unitId && t.date === dayISO).sort((a, b) => a.start_min - b.start_min);
  if (!unit) return null;

  // Build a 24-hour duty status array (per minute, value: off/sleeper/driving/on-duty)
  // Heuristic from trips: drive-out window = driving, on-site = on-duty, gaps = off-duty.
  const status = new Array(24 * 60).fill("off");
  for (const t of trips) {
    const driveOut = Math.round((t.end_min - t.start_min) * 0.35);
    const driveBack = Math.round((t.end_min - t.start_min) * 0.35);
    const onSite = (t.end_min - t.start_min) - driveOut - driveBack;
    let cur = t.start_min;
    for (let m = 0; m < driveOut && cur < 1440; m++, cur++) status[cur] = "driving";
    for (let m = 0; m < onSite && cur < 1440; m++, cur++) status[cur] = "on-duty";
    for (let m = 0; m < driveBack && cur < 1440; m++, cur++) status[cur] = "driving";
  }

  // Totals
  const totals = { off: 0, sleeper: 0, driving: 0, "on-duty": 0 };
  for (const s of status) totals[s] = (totals[s] || 0) + 1;
  const hrs = (n) => (n / 60).toFixed(2);
  const totalKm = trips.reduce((s, t) => s + t.km, 0);

  // Build segment list for path drawing
  const rowFor = (s) => ({ off: 0, sleeper: 1, driving: 2, "on-duty": 3 }[s]);
  const segments = [];
  let curStart = 0, curStatus = status[0];
  for (let i = 1; i <= 1440; i++) {
    if (i === 1440 || status[i] !== curStatus) {
      segments.push({ start: curStart, end: i, status: curStatus });
      curStart = i;
      curStatus = status[i];
    }
  }

  const dateLabel = new Date(dayISO + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric" });

  return (
    <Modal onClose={onClose} width={1080}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "20px 28px", borderBottom: "1px solid var(--rule)" }}>
        <div>
          <div style={{ font: "700 22px/1.1 var(--font-display)", color: "var(--navy-900)", letterSpacing: "-0.005em" }}>Driver's Daily Log</div>
          <div style={{ font: "13px/1.4 var(--font-sans)", color: "var(--fg-muted)", marginTop: 4 }}>{dateLabel} · {unit.driver}</div>
        </div>
        <Btn kind="secondary" size="sm" onClick={onClose}>Close</Btn>
      </div>

      <div style={{ padding: "20px 28px", maxHeight: "calc(90vh - 80px)", overflowY: "auto" }}>
        {/* Top metadata strip */}
        <div style={{ display: "flex", gap: 24, alignItems: "baseline", paddingBottom: 14, borderBottom: "1px solid var(--rule)" }}>
          <Eyebrow>Driver's Daily Log</Eyebrow>
          <Meta k="Date" v={dateLabel} />
          <Meta k="Cycle" v="Cycle 1" />
          <Meta k="Trips" v={trips.length} />
          <Meta k="Km" v={totalKm.toFixed(1)} />
        </div>

        {/* Identification */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginTop: 18 }}>
          <Field label="Driver name" value={unit.driver} />
          <Field label="Unit no." value={`${unit.id}, ${unit.year} ${unit.make} ${unit.model}`} />
          <Field label="Odometer start" value={(unit.odo ? unit.odo - Math.round(totalKm) : 100000).toLocaleString()} />
          <Field label="Odometer end" value={(() => {
            if (!trips.length) return "-";
            const odo = trips[trips.length - 1].endingOdometer;
            return odo != null ? odo.toLocaleString() : "-";
          })()} />
          <Field label="Total distance driven" value={`${totalKm.toFixed(1)} km`} />
          <Field label="Driver signature" value="-" muted />
          <Field label="Motor carrier" value="Cascade Freight Inc." />
          <Field label="Principal place of business" value="16425 130 Ave NW, Edmonton" />
          <Field label="Home terminal address" value="16425 130 Ave NW, Edmonton" />
          <Field label="Co-driver" value="-" muted />
          <Field label="Trailer plate" value="-" muted />
          <Field label="Trailer unit" value="-" muted />
          <Field label="Last known / return location"
            value={trips.length ? (
              trips[trips.length - 1].end_site
              || trips[trips.length - 1].site
              || (trips[trips.length - 1].site_lat != null
                  ? `${trips[trips.length - 1].site_lat.toFixed(4)}, ${trips[trips.length - 1].site_lng.toFixed(4)}`
                  : "-")
            ) : "-"}
            wide />
        </div>

        {/* Inspection */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--rule)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
          <Field label="Supporting inspection" value="Pre-trip" small />
          <Field label="Inspector" value={unit.driver} small />
          <Field label="Inspection signed" value={trips.length ? D.minToHHMM(Math.max(0, trips[0].start_min - 30)) : "-"} small />
        </div>

        {/* Duty graph */}
        <div style={{ marginTop: 22 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Duty status, 24-hour</Eyebrow>
          <DutyGraph segments={segments} totals={totals} />
        </div>

        {/* Block details + chart filter */}
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18 }}>
          <div style={{ font: "12.5px/1.6 var(--font-sans)", color: "var(--fg-subtle)" }}>
            <strong style={{ color: "var(--navy-900)" }}>Duty block details</strong>
            <div style={{ marginTop: 4 }}>Period: {dateLabel}, 00:00 – 23:59</div>
            <div>Trips: {trips.length}</div>
            <div>Driving: {hrs(totals.driving)} hrs</div>
            <div>On-duty (non-driving): {hrs(totals["on-duty"])} hrs</div>
            <div>Off-duty: {hrs(totals.off)} hrs</div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--fg-muted)" }}>
              Cycle 1 working limits: 7-day / 70 hrs on-duty (rolling). Reset assumed after 10+ hrs off duty between
              trips. Stops returning within 1.5 km of PPB or trip origin count as off-duty; unresolved away stops
              count as on-duty for the first 2.0 hrs, then assumed off-duty.
            </div>
          </div>
          <Card padding={14} style={{ background: "var(--steel-50)" }}>
            <Eyebrow>Chart filter</Eyebrow>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginTop: 8, font: "12.5px var(--font-sans)" }}>
              <span style={{ color: "var(--fg-subtle)" }}>Stop threshold</span><span style={{ fontWeight: 600 }}>15 min</span>
              <span style={{ color: "var(--fg-subtle)" }}>Stops excluded</span><span style={{ fontWeight: 600 }}>{Math.max(0, trips.length - 1)}</span>
              <span style={{ color: "var(--fg-subtle)" }}>Source</span><span style={{ fontWeight: 600 }}>GPS · 5 min poll</span>
            </div>
          </Card>
        </div>

        <div style={{ marginTop: 16, fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.5 }}>
          Internal compliance review for operational reference. Verify against retained company records where required.
        </div>
      </div>
    </Modal>
  );
};

function Modal({ onClose, width = 720, children }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(11, 26, 42, 0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width, maxWidth: "100%", maxHeight: "92vh",
        background: "var(--white)", borderRadius: 4,
        boxShadow: "var(--shadow-3)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>{children}</div>
    </div>
  );
}

function Meta({ k, v }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ font: "600 10.5px var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{k}</span>
      <span style={{ font: "500 13px var(--font-sans)", color: "var(--navy-900)" }}>{v}</span>
    </div>
  );
}

function Field({ label, value, muted, wide, small }) {
  return (
    <div style={{ gridColumn: wide ? "1 / -1" : undefined }}>
      <div style={{ font: "600 10px var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ font: `${small ? 500 : 500} ${small ? 13 : 14}px/1.3 var(--font-sans)`, color: muted ? "var(--fg-muted)" : "var(--navy-900)", borderBottom: "1px solid var(--rule)", paddingBottom: 4 }}>{value}</div>
    </div>
  );
}

function DutyGraph({ segments, totals }) {
  const W = 980, ROW_H = 28, PAD = 50, RIGHT = 90;
  const innerW = W - PAD - RIGHT;
  const rows = ["OFF-DUTY", "SLEEPER", "DRIVING", "ON-DUTY"];
  const rowKeys = ["off", "sleeper", "driving", "on-duty"];
  const H = ROW_H * rows.length + 28;

  const xFor = (m) => PAD + (m / 1440) * innerW;
  const rowFor = (s) => rowKeys.indexOf(s);

  // Build stepped polyline points
  const pts = [];
  for (const seg of segments) {
    if (seg.status === "off" && seg.start === seg.end) continue;
    const y = 14 + rowFor(seg.status) * ROW_H + ROW_H / 2;
    pts.push({ x: xFor(seg.start), y });
    pts.push({ x: xFor(seg.end), y });
  }

  return (
    <div style={{ background: "var(--white)", border: "1px solid var(--border)", padding: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
        {/* Hour axis labels */}
        {[0, 4, 8, 12, 16, 20, 24].map(h => (
          <text key={h} x={xFor(h * 60)} y={10} textAnchor="middle"
            style={{ font: "10px var(--font-sans)", fill: "var(--fg-muted)" }}>{h}</text>
        ))}
        <text x={W - RIGHT + 18} y={10} style={{ font: "600 9.5px var(--font-sans)", fill: "var(--fg-muted)", letterSpacing: "0.12em" }}>TOTAL (HRS)</text>

        {/* Row backgrounds + labels */}
        {rows.map((r, i) => (
          <g key={r}>
            <rect x={PAD} y={14 + i * ROW_H} width={innerW} height={ROW_H} fill={i % 2 ? "var(--steel-50)" : "var(--white)"} />
            {/* hour grid */}
            {Array.from({ length: 25 }, (_, h) => h).map(h => (
              <line key={h} x1={xFor(h * 60)} y1={14 + i * ROW_H} x2={xFor(h * 60)} y2={14 + (i + 1) * ROW_H}
                stroke="var(--rule)" strokeWidth={h % 4 === 0 ? 1 : 0.5} />
            ))}
            <line x1={PAD} y1={14 + (i + 1) * ROW_H} x2={W - RIGHT} y2={14 + (i + 1) * ROW_H} stroke="var(--border)" />
            <text x={PAD - 6} y={14 + i * ROW_H + ROW_H / 2 + 3} textAnchor="end"
              style={{ font: "600 9.5px var(--font-sans)", fill: "var(--fg-muted)", letterSpacing: "0.1em" }}>{r}</text>
            <text x={W - RIGHT + 18} y={14 + i * ROW_H + ROW_H / 2 + 3}
              style={{ font: "500 12px var(--font-mono)", fill: "var(--navy-900)" }}>
              {(totals[rowKeys[i]] / 60).toFixed(2)}
            </text>
          </g>
        ))}

        {/* Polyline of duty status */}
        <polyline points={pts.map(p => `${p.x},${p.y}`).join(" ")}
          fill="none" stroke="var(--navy-900)" strokeWidth="1.75" strokeLinejoin="miter" strokeLinecap="square" />
        {/* Vertical jumps between segments */}
        {(() => {
          const jumps = [];
          for (let i = 0; i < segments.length - 1; i++) {
            const a = segments[i], b = segments[i + 1];
            if (a.status !== b.status) {
              const x = xFor(a.end);
              const y1 = 14 + rowFor(a.status) * ROW_H + ROW_H / 2;
              const y2 = 14 + rowFor(b.status) * ROW_H + ROW_H / 2;
              jumps.push(<line key={i} x1={x} y1={y1} x2={x} y2={y2} stroke="var(--navy-900)" strokeWidth="1.75" />);
            }
          }
          return jumps;
        })()}
      </svg>
    </div>
  );
}

window.DailyLog = DailyLog;
