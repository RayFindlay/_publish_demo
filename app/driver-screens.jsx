// Zone 2, Driver deep-dive (month calendar with compliance + DVIR cells)
// Zone 3, Single day detail (banner + duty chart + trips + inspections)

const { useState: useStateDS, useMemo: useMemoDS } = React;

const DriverDetail = ({ driverId, onClose, onOpenDay, onCopyLink }) => {
  const D = window.NORFAB_DATA;
  const drv = D.DRIVERS.find(x => x.id === driverId);
  const unit = D.UNITS.find(x => x.id === drv.unit);
  const [ym, setYm] = useStateDS(() => {
    // Default to the CURRENT month in Mountain time, not a hardcoded snapshot.
    const [y, m] = window.NORFAB_DATA.localTodayISO().split("-").map(Number);
    return { y, m: m - 1 };
  });
  const [cycle, setCycle] = useStateDS("cycle1");

  const first = new Date(Date.UTC(ym.y, ym.m, 1));
  const startDow = first.getUTCDay();
  const dim = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length < 42) cells.push(null);

  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Totals for the side panel
  const monthDays = [];
  for (let d = 1; d <= dim; d++) {
    const iso = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    monthDays.push({ iso, c: D.dayCompliance(drv.id, iso) });
  }
  const tExempt = monthDays.filter(d => d.c.state === "exempt").length;
  const tFull = monthDays.filter(d => d.c.state === "full-log").length;
  const tNone = monthDays.filter(d => d.c.state === "none").length;
  const tTrips = monthDays.reduce((s, d) => s + d.c.trips, 0);
  const tKm = monthDays.reduce((s, d) => s + d.c.km, 0);
  const tDrive = monthDays.reduce((s, d) => s + d.c.drive_hrs, 0);

  return (
    <div style={{ padding: "20px 24px 32px", maxWidth: 1480, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Btn kind="ghost" size="sm" style={{ marginLeft: -8 }} onClick={onClose}>← Fleet overview</Btn>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, marginTop: 6 }}>
          <div>
            <Eyebrow>Driver record · {unit.klass === "heavy" ? "Time-record required" : "Light vehicle"}</Eyebrow>
            <div style={{ font: "700 32px/1.05 var(--font-display)", color: "var(--navy-900)", letterSpacing: "-0.012em", marginTop: 6 }}>{drv.name}</div>
            <div style={{ font: "14px/1.4 var(--font-sans)", color: "var(--fg-subtle)", marginTop: 4 }}>
              {drv.unit} · {unit.year} {unit.make} {unit.model} · GVW {unit.gvw_kg.toLocaleString()} kg
              {(drv.email || drv.phone) && (
                <span style={{ color: "var(--fg-muted)" }}>
                  {drv.email ? ` · ${drv.email}` : ""}{drv.phone ? ` · ${drv.phone}` : ""}
                </span>
              )}
            </div>
          </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <VerifiedStamp driverId={drv.id} year={ym.y} month={ym.m} onChanged={() => setYm(s => ({...s}))} />
              <Segmented value={cycle} onChange={setCycle} options={[{ v: "cycle1", label: "Cycle 1" }, { v: "cycle2", label: "Cycle 2" }]} />
              <Btn kind="secondary" size="sm" icon={<Icon name="printer" size={13} />} onClick={() => window.print()}>Print binder</Btn>
            </div>
        </div>
      </div>

      {/* Month + side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        {/* Calendar */}
        <Card padding={0}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Btn kind="icon" size="sm" onClick={() => setYm(s => { const d = new Date(s.y, s.m - 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })}><Icon name="chevron-left" size={14} /></Btn>
              <div style={{ font: "600 17px var(--font-sans)", color: "var(--navy-900)", minWidth: 150, textAlign: "center" }}>{monthLabel}</div>
              <Btn kind="icon" size="sm" onClick={() => setYm(s => { const d = new Date(s.y, s.m + 1, 1); return { y: d.getFullYear(), m: d.getMonth() }; })}><Icon name="chevron-right" size={14} /></Btn>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <Lgnd swatch="var(--ok)" label="Exempt" />
              <Lgnd swatch="var(--accent-600)" label="Full log" />
              <Lgnd swatch="var(--steel-300)" label="No activity" />
            </div>
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
            padding: "8px 12px 0", gap: 0,
            borderBottom: "1px solid var(--rule)",
          }}>
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
              <div key={d} style={{ padding: "4px 6px", font: "600 10.5px var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: i === 0 || i === 6 ? "var(--steel-500)" : "var(--fg-muted)" }}>{d}</div>
            ))}
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
            gap: 6, padding: 12,
          }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} style={{ minHeight: 86, background: "var(--steel-50)", border: "1px solid var(--rule)", borderRadius: 2, opacity: 0.35 }} />;
              const iso = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
              const c = D.dayCompliance(drv.id, iso);
              return <DayCellV2 key={iso} d={d} iso={iso} c={c} driverId={drv.id} delay={i * 8} onClick={() => onOpenDay(drv.id, iso)} />;
            })}
          </div>
        </Card>

        {/* Side panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card padding={0}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}>
              <Eyebrow>{monthLabel} totals</Eyebrow>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
              <SideStat label="Exempt days" value={tExempt} tone="ok" />
              <SideStat label="Full log" value={tFull} tone={tFull ? "flag" : "neutral"} divider />
              <SideStat label="No activity" value={tNone} tone="neutral" topBorder />
              <SideStat label="Trips" value={tTrips} divider topBorder />
              <SideStat label="Distance" value={`${tKm.toFixed(0)} km`} topBorder />
              <SideStat label="Driving" value={`${tDrive.toFixed(1)} h`} divider topBorder />
            </div>
          </Card>

          <Card>
            <Eyebrow style={{ marginBottom: 8 }}>Cycle limits</Eyebrow>
            <CycleBar label="On-duty rolling 7-day" used={(window.CASCADE FREIGHT_LOCAL && window.CASCADE FREIGHT_LOCAL.cycleUsage) ? window.CASCADE FREIGHT_LOCAL.cycleUsage(drv.id, D.TODAY, 7) : 0} limit={70} />
            <div style={{ height: 10 }} />
            <CycleBar label="On-duty rolling 14-day" used={(window.CASCADE FREIGHT_LOCAL && window.CASCADE FREIGHT_LOCAL.cycleUsage) ? window.CASCADE FREIGHT_LOCAL.cycleUsage(drv.id, D.TODAY, 14) : 0} limit={120} />
            <div style={{ marginTop: 10, font: "11.5px/1.45 var(--font-sans)", color: "var(--fg-muted)" }}>
              {cycle === "cycle1" ? "Cycle 1: 7-day / 70-hour on-duty limit, 24-hour reset after 36+ hrs off." : "Cycle 2: 14-day / 120-hour on-duty limit, with 24+ hr reset."}
            </div>
          </Card>

          <Card>
            <Eyebrow style={{ marginBottom: 8 }}>Roadside link</Eyebrow>
            <div style={{
              font: "12px/1.4 var(--font-mono)", color: "var(--navy-800)",
              padding: "8px 10px", background: "var(--steel-50)",
              border: "1px solid var(--rule)", borderRadius: 2,
              wordBreak: "break-all",
            }}>{D.roadsideUrl(drv.id)}</div>
            <Btn kind="primary" size="sm" style={{ width: "100%", marginTop: 8, justifyContent: "center" }} icon={<Icon name="copy" size={13} />} onClick={() => onCopyLink(drv)}>Copy link</Btn>
            <div style={{ font: "11px var(--font-sans)", color: "var(--fg-muted)", marginTop: 6 }}>
              Driver opens this for roadside inspection. SharePoint-authenticated, last published from latest.json.
            </div>
          </Card>

          {/* Token revocation. Styled muted and red so it doesn't invite
              casual clicks; gated behind a confirmation modal that
              explains exactly what will happen. */}
          <TokenRevocation drv={drv} />
        </div>
      </div>
    </div>
  );
};

// Token revocation UI. Two stages: a quiet collapsed strip, and a
// confirmation modal that the operator has to explicitly continue from.
// The actual regeneration happens via the GitHub Actions workflow
// (regenerate-driver-token.yml); this UI hands off to it.
function TokenRevocation({ drv }) {
  const [open, setOpen] = React.useState(false);
  const workflowUrl = "https://github.com/RayFindlay/SFC-Automation-Project/actions/workflows/regenerate-driver-token.yml";

  const handleProceed = async () => {
    // Copy the driver name to clipboard so Ray can just paste into the
    // GitHub workflow form when the new tab opens.
    try { await navigator.clipboard.writeText(drv.name); } catch (e) { /* not critical */ }
    window.open(workflowUrl, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  return (
    <>
      <div style={{
        marginTop: 4,
        padding: "10px 14px",
        background: "var(--white)",
        border: "1px solid #E9C9BD",
        borderLeft: "3px solid #B23A0E",
        borderRadius: 2,
        opacity: 0.92,
      }}>
        <div style={{ font: "600 10px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A3315" }}>
          Token revocation
        </div>
        <div style={{ font: "11.5px/1.45 var(--font-sans)", color: "var(--fg-subtle)", marginTop: 4 }}>
          Regenerating this driver's token invalidates their current roadside URL. Use only when a link has leaked, a phone is lost, or the driver leaves the carrier.
        </div>
        <button onClick={() => setOpen(true)} style={{
          marginTop: 8,
          background: "transparent",
          color: "#8A3315",
          border: "1px solid #C7837A",
          borderRadius: 2,
          padding: "5px 10px",
          font: "500 11.5px var(--font-sans)",
          cursor: "pointer",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "#FBEFEB"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          Regenerate token...
        </button>
      </div>

      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(11,26,42,0.55)", zIndex: 600,
          display: "grid", placeItems: "center",
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--white)",
            width: "min(520px, calc(100vw - 32px))",
            border: "1px solid var(--border)",
            borderTop: "3px solid #B23A0E",
            borderRadius: 4,
            padding: "20px 22px",
            boxShadow: "0 24px 60px rgba(11,26,42,0.30)",
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div>
              <div style={{ font: "600 10px var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: "#8A3315" }}>
                Confirm token regeneration
              </div>
              <div style={{ font: "700 18px/1.25 var(--font-display)", color: "var(--navy-900)", marginTop: 6 }}>
                Replace {drv.name}'s roadside token
              </div>
            </div>

            <div style={{ font: "13px/1.5 var(--font-sans)", color: "var(--navy-800)" }}>
              This will:
              <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                <li>Generate a new random token for {drv.name}</li>
                <li>Update <code style={{ background: "var(--steel-50)", padding: "1px 5px", borderRadius: 2, font: "12px var(--font-mono)" }}>data/registry/drivers.json</code> in the repo</li>
                <li>Trigger the pipeline to republish, removing the old token's folder as an orphan</li>
                <li>Make the current roadside URL return 404 within ~5 minutes</li>
                <li>Require you to send {drv.name} their new URL once the pipeline finishes</li>
              </ul>
            </div>

            <div style={{ background: "var(--steel-50)", border: "1px solid var(--rule)", borderRadius: 2, padding: "10px 12px" }}>
              <div style={{ font: "10.5px var(--font-sans)", color: "var(--fg-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>
                Current token (will be invalidated)
              </div>
              <div style={{ font: "12px var(--font-mono)", color: "var(--navy-900)", wordBreak: "break-all" }}>
                {drv.token || "(none on file)"}
              </div>
            </div>

            <div style={{ font: "11.5px/1.5 var(--font-sans)", color: "var(--fg-muted)" }}>
              Clicking continue opens the GitHub Actions workflow in a new tab. {drv.name}'s name is copied to your clipboard - paste it into the form's <em>Driver</em> field, optionally add a reason, then click Run.
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setOpen(false)} style={{
                background: "transparent", border: "1px solid var(--border-strong)",
                color: "var(--navy-800)", padding: "8px 14px", borderRadius: 2,
                font: "500 13px var(--font-sans)", cursor: "pointer",
              }}>Cancel</button>
              <button onClick={handleProceed} style={{
                background: "#B23A0E", color: "#fff", border: "1px solid #8A3315",
                padding: "8px 14px", borderRadius: 2,
                font: "600 13px var(--font-sans)", cursor: "pointer",
              }}>Continue to workflow</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DayCellV2({ d, iso, c, driverId, onClick, delay = 0 }) {
  const stateColor = c.state === "exempt" ? "var(--ok)" : c.state === "full-log" ? "var(--accent-600)" : "var(--steel-300)";
  const has = c.state !== "none";
  const bg     = c.state === "exempt" ? "#F1F7F3" : c.state === "full-log" ? "#FFF7F1" : "var(--white)";
  const bgHov  = c.state === "exempt" ? "#E4EFE8" : c.state === "full-log" ? "#FFEFE3" : "var(--steel-50)";
  const border = c.state === "exempt" ? "#CFE3D6" : c.state === "full-log" ? "#F3D3BC" : "var(--border)";
  const cellRef = React.useRef(null);
  const [editing, setEditing] = React.useState(false);
  const [, force] = React.useReducer(x => x + 1, 0);
  const onContext = (e) => { e.preventDefault(); setEditing(true); };
  // Units driven that day (unique, preserves the order they first appear)
  const D = window.NORFAB_DATA;
  const unitsDriven = (() => {
    if (!has || !driverId) return [];
    const seen = new Set();
    const out = [];
    for (const t of (D && D.TRIPS) || []) {
      if (t.driver === driverId && t.date === iso && t.unit && !seen.has(t.unit)) {
        seen.add(t.unit);
        out.push(t.unit);
      }
    }
    return out;
  })();
  return (
    <>
    <button ref={cellRef} onClick={onClick} onContextMenu={onContext} className="nf-day-cell nf-cell" style={{
      position: "relative",
      animationDelay: `${delay}ms`,
      cursor: "pointer", background: bg,
      border: `1px solid ${border}`, borderLeft: `3px solid ${stateColor}`,
      borderRadius: 2, padding: "6px 8px", minHeight: 86,
      display: "flex", flexDirection: "column", gap: 4, textAlign: "left",
      font: "inherit", color: "inherit",
    }}
      onMouseEnter={e => e.currentTarget.style.background = bgHov}
      onMouseLeave={e => e.currentTarget.style.background = bg}>
      {driverId && <window.AnnotationTab driverId={driverId} dayISO={iso} onOpen={() => setEditing(true)} />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ font: `${has ? 700 : 500} 13px var(--font-sans)`, color: has ? "var(--navy-900)" : "var(--steel-500)" }}>{d}</span>
        {has && (
          <span style={{
            font: "700 9.5px/1 var(--font-sans)", letterSpacing: "0.1em",
            color: "#fff", background: stateColor,
            padding: "2px 5px", borderRadius: 2, textTransform: "uppercase",
          }}>
            {c.state === "exempt" ? "EX" : "FL"}
          </span>
        )}
      </div>
      {has && (
        <>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            <DvirDot ok={!!c.pre} label="S" title={c.pre ? `Pre-trip ${c.pre.time_local}` : "Pre-trip missing"} />
            <DvirDot ok={!!c.post} label="E" optional title={c.post ? `Post-trip ${c.post.time_local}` : "Post-trip not on file (informational, not legally required)"} />
            <span style={{ font: "600 11px/1 var(--font-mono)", color: c.state === "full-log" ? "var(--accent-700)" : "var(--navy-900)", marginLeft: "auto" }}>{c.drive_hrs.toFixed(1)}h</span>
          </div>
          {unitsDriven.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 2 }}>
              {unitsDriven.map(uid => (
                <span key={uid} title={`Drove ${uid} this day`} style={{
                  font: "600 9.5px/1 var(--font-mono)",
                  background: "var(--steel-100)",
                  color: "var(--navy-800)",
                  padding: "2px 5px",
                  borderRadius: 2,
                  letterSpacing: "0.02em",
                }}>{uid}</span>
              ))}
            </div>
          )}
          <div style={{ font: "11px var(--font-sans)", color: c.state === "exempt" ? "#3A6B4F" : c.state === "full-log" ? "#9A4818" : "var(--fg-muted)", marginTop: "auto" }}>
            {c.trips} trip{c.trips === 1 ? "" : "s"} · {c.km.toFixed(0)} km
          </div>
        </>
      )}
    </button>
    {editing && (
      <window.AnnotationEditor driverId={driverId} dayISO={iso} anchorRef={cellRef}
        onClose={() => setEditing(false)} onSaved={() => force()} />
    )}
    </>
  );
}

function DvirDot({ ok, label, title, optional }) {
  // For `optional` dots (post-trip, which is NOT legally required), use a
  // neutral grey for the "missing" state instead of warning-orange.
  const missBg = optional ? "var(--steel-100)" : "var(--accent-100)";
  const missFg = optional ? "var(--fg-muted)" : "var(--accent-700)";
  const missBorder = optional ? "var(--border)" : "#F0BFA0";
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 16, height: 14, borderRadius: 2,
      font: "600 9px/1 var(--font-sans)",
      background: ok ? "#EAF3EE" : missBg,
      color: ok ? "var(--ok)" : missFg,
      border: `1px solid ${ok ? "#BFDDC9" : missBorder}`,
    }}>{label}</span>
  );
}

function SideStat({ label, value, tone = "neutral", divider, topBorder }) {
  const colors = { neutral: "var(--navy-900)", ok: "var(--ok)", flag: "var(--accent-700)" };
  return (
    <div style={{
      padding: "10px 14px",
      borderLeft: divider ? "1px solid var(--rule)" : "none",
      borderTop: topBorder ? "1px solid var(--rule)" : "none",
    }}>
      <div style={{ font: "600 10px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{label}</div>
      <div style={{ font: "600 18px/1.1 var(--font-display)", color: colors[tone], marginTop: 4 }}>{value}</div>
    </div>
  );
}

function CycleBar({ label, used, limit }) {
  const pct = Math.min(100, (used / limit) * 100);
  const warn = pct > 80;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", font: "12px var(--font-sans)", color: "var(--navy-900)", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", color: warn ? "var(--accent-700)" : "var(--navy-900)" }}>
          {used.toFixed(1)} / {limit}h
        </span>
      </div>
      <div style={{ height: 6, background: "var(--steel-100)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: warn ? "var(--accent-600)" : "var(--navy-700)" }} />
      </div>
    </div>
  );
}

// Renders a trip location as a Google Maps link. Falls back from named
// location (e.g., "Head Office") to raw GPS coordinates when no name is on
// file (Titan emits these for un-geofenced stops like a delivery in a
// residential neighbourhood). Either way, clicking opens Google Maps to
// the precise coordinates if we have them, or to the name's geocoded
// match if we only have a name.
function LocationCell({ name, coords }) {
  const hasCoords = Array.isArray(coords) && coords.length >= 2 && coords[0] != null && coords[1] != null;
  if (!name && !hasCoords) {
    return <span style={{ color: "var(--fg-muted)" }}></span>;
  }
  const display = name || (hasCoords ? `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}` : "");
  // When we have coords, use the ?q=loc:LAT,LNG form. The 'loc:' prefix
  // tells Google Maps "treat this as a literal coordinate, not a search
  // query" — so it drops a pin at the EXACT lat/lng without doing the
  // business-name fuzzy match. Without 'loc:', a bare ?q=LAT,LNG would
  // search Google's public business directory and hit whatever's closest
  // (e.g. Nelson Lumber when the truck was at the NFB Cascade Freight geofence).
  // Note: the older /@LAT,LNG,Zz form centers the map but doesn't drop a
  // pin, which made it hard to see exactly where the truck was.
  // When no coords, fall back to a name search (least bad option).
  const href = hasCoords
    ? `https://www.google.com/maps?q=loc:${coords[0]},${coords[1]}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}`;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      title={hasCoords ? `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)} - opens Google Maps at this exact spot` : "Opens Google Maps search"}
      style={{ color: "var(--navy-700)", textDecoration: "underline", textDecorationThickness: "1px", textUnderlineOffset: "2px" }}>
      {display}
    </a>
  );
}

function Lgnd({ swatch, label }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, font: "11px var(--font-sans)", color: "var(--fg-muted)" }}>
      <span style={{ width: 10, height: 10, background: swatch, borderRadius: 2 }} />
      {label}
    </span>
  );
}

// ============ Zone 3, Day Detail ============
const DayDetail = ({ driverId, dayISO, onClose }) => {
  const D = window.NORFAB_DATA;
  const drv = D.DRIVERS.find(x => x.id === driverId);
  const unit = D.UNITS.find(x => x.id === drv.unit);
  const c = D.dayCompliance(drv.id, dayISO);
  const dateLabel = new Date(dayISO + "T12:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const banner = c.state === "exempt"
    ? { tone: "ok", title: "160 km exempt", text: "Operated within 160 km of home terminal, returned within 1.5 km, pre-trip on file. No full daily log required." }
    : c.state === "full-log"
      ? { tone: "flag", title: "Full daily log required", text: c.reasons.join(" · ") }
      : { tone: "neutral", title: "No activity", text: "No trips logged for this day." };

  return (
    <div style={{ padding: "20px 24px 32px", maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Btn kind="ghost" size="sm" style={{ marginLeft: -8 }} onClick={onClose}>← {drv.name}</Btn>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, marginTop: 6 }}>
          <div>
            <Eyebrow>Day detail · {drv.name}</Eyebrow>
            <div style={{ font: "700 28px/1.1 var(--font-display)", color: "var(--navy-900)", letterSpacing: "-0.01em", marginTop: 6 }}>{dateLabel}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="secondary" size="sm" icon={<Icon name="printer" size={13} />}>Print</Btn>
          </div>
        </div>
      </div>

      {/* Compliance banner */}
      <BannerStrip tone={banner.tone} title={banner.title} text={banner.text} />

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)" }}>
        <Stat label="Trips" value={c.trips} style={{ borderLeft: "none", padding: "12px 14px" }} />
        <Stat label="Distance" numeric={c.km} unit=" km" decimals={1} style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} />
        <Stat label="Driving" tone="accent" numeric={c.drive_hrs} unit=" h" decimals={2} style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} />
        <Stat label="On-duty (est)" numeric={c.onduty_hrs} unit=" h" decimals={2} style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} />
        <Stat label="Status" value={c.state === "exempt" ? "Exempt" : c.state === "full-log" ? "Full log" : "-"}
          accent={c.state === "full-log" ? "var(--accent-600)" : c.state === "exempt" ? "var(--ok)" : undefined}
          style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} />
      </div>

      {/* Driver's Daily Log, SFC duty-status graph */}
      {c.state !== "none" && (
        <Card padding={0}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <Eyebrow>Driver's daily log {c.state === "exempt" && <span style={{ color: "var(--fg-muted)", textTransform: "none", letterSpacing: 0, fontSize: 11, marginLeft: 8 }}>(reference, not required under 160 km exemption)</span>}</Eyebrow>
              <div style={{ font: "14px var(--font-sans)", color: "var(--navy-900)", marginTop: 2 }}>{drv.name} · {unit.id} {unit.year} {unit.make} {unit.model}</div>
            </div>
            <div style={{ display: "flex", gap: 16, font: "11px var(--font-sans)", color: "var(--fg-muted)" }}>
              <span>Carrier: {D.SFC.carrier}</span>
              <span>NSC: {D.SFC.nsc}</span>
            </div>
          </div>
          <DutyChart day={dayISO} trips={c.dayTrips} pre={c.pre} post={c.post} />
        </Card>
      )}

      {/* Inspections */}
      <Card padding={0}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}><Eyebrow>Vehicle inspections (DVIR)</Eyebrow></div>
        <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
          <thead><tr style={{ background: "var(--steel-50)", borderBottom: "1px solid var(--rule)" }}>
            {["Type", "Signed", "Unit", "Odometer", "Source PDF"].map(h => (
              <th key={h} style={{ textAlign: "left", padding: "8px 14px", font: "600 10.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {[["Pre", c.pre, false], ["Post", c.post, true]].map(([k, r, optional]) => {
              // Source PDF lives at the same per-day support path the phone
              // view links to. The publisher writes the original SiteDocs PDF
              // to <pages>/drivers/<token>/support/<date>/inspection-source.pdf
              // on every run; same URL whether viewed from the dashboard or
              // a worker's roadside link.
              const pdfHref = (r && drv.token)
                ? `${D.PUBLISH_BASE}/drivers/${drv.token}/support/${dayISO}/inspection-source.pdf`
                : null;
              return (
                <tr key={k} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>
                    {k}-trip
                    {optional && <span style={{ marginLeft: 6, font: "500 10px var(--font-sans)", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>· optional</span>}
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>
                    {r ? r.time_local : <span style={{ color: optional ? "var(--fg-muted)" : "var(--accent-700)" }}>{optional ? "Not on file" : "Not filed"}</span>}
                  </td>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>{r ? r.unit : "-"}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>{r ? r.odometer_km.toLocaleString() : "-"}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {pdfHref ? (
                      <a href={pdfHref} target="_blank" rel="noopener noreferrer"
                        style={{ color: "var(--navy-700)", textDecoration: "underline", textDecorationThickness: "1px", textUnderlineOffset: "2px" }}
                        title="Open the original SiteDocs PDF in a new tab">
                        {r.source_pdf}
                      </a>
                    ) : (r ? r.source_pdf : "-")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Trips */}
      {c.dayTrips && c.dayTrips.length > 0 && (
        <Card padding={0}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--rule)" }}><Eyebrow>Trip records</Eyebrow></div>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
            <thead><tr style={{ background: "var(--steel-50)", borderBottom: "1px solid var(--rule)" }}>
              {["#", "Start", "End", "Start location", "End location", "Km", "Status"].map(h => (
                <th key={h} style={{ textAlign: h === "Km" ? "right" : "left", padding: "8px 14px", font: "600 10.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {c.dayTrips.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{i + 1}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>{D.minToHHMM(t.start_min)}</td>
                  <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>{D.minToHHMM(t.end_min)}</td>
                  <td style={{ padding: "10px 14px" }}><LocationCell name={t.start_site} coords={t.startCoords} /></td>
                  <td style={{ padding: "10px 14px" }}><LocationCell name={t.end_site} coords={t.endCoords} /></td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{(t.km || 0).toFixed(1)}</td>
                  <td style={{ padding: "10px 14px" }}>{t.outside_radius ? <Pill tone="flag">Outside 160 km</Pill> : <span style={{ color: "var(--fg-muted)", fontSize: 12 }}>-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
};

function BannerStrip({ tone, title, text }) {
  const tones = {
    ok:   { bg: "#EAF3EE", bd: "#BFDDC9", fg: "#1F5C39" },
    warn: { bg: "#FBF1DB", bd: "#E9CD8B", fg: "#7A5306" },
    flag: { bg: "var(--accent-100)", bd: "#F0BFA0", fg: "var(--accent-700)" },
    neutral: { bg: "var(--steel-50)", bd: "var(--border)", fg: "var(--navy-800)" },
  };
  const t = tones[tone];
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 4, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
      <Dot tone={tone === "ok" ? "ok" : tone === "flag" ? "flag" : "info"} size={10} style={{ marginTop: 5 }} />
      <div>
        <div style={{ font: "600 14px var(--font-sans)", color: t.fg }}>{title}</div>
        <div style={{ font: "13px/1.5 var(--font-sans)", color: t.fg, opacity: 0.85, marginTop: 2 }}>{text}</div>
      </div>
    </div>
  );
}

// ============ Duty-Status Graph (SFC daily log) ============
// 4-row 24-hour graph: Off Duty / Sleeper Berth / Driving / On Duty (not driving)
//
// Each Titan trip is exactly one DRIVING segment (truck moving from A to B).
// The TIME BETWEEN consecutive trips is ON-DUTY (truck stopped, driver still
// working: on-site work, paperwork, breaks shorter than the work-shift edge).
// Pre-trip DVIR adds a 15-min ON-DUTY preamble before the first trip; post-trip
// DVIR (when filed) adds a 10-min ON-DUTY tail after the last trip. Everything
// outside the work shift is OFF-DUTY.
//
// Returns a list of {start, end, row} with row: 0=Off, 1=Sleeper, 2=Driving,
// 3=OnDuty. Segments are guaranteed:
//   - sorted by start
//   - non-overlapping
//   - cover the full 24h day (sums to 1440 minutes)
//   - times clamped to [0, 1440]
//   - row in {0, 1, 2, 3}
function buildSegments(trips, pre, post) {
  const DAY = 24 * 60;
  const clamp = (v) => Math.max(0, Math.min(DAY, v));
  // Sanitise input: drop NaN times, end < start, etc.
  const rawTrips = (Array.isArray(trips) ? trips : [])
    .filter(t => t && Number.isFinite(t.start_min) && Number.isFinite(t.end_min) && t.end_min >= t.start_min)
    .map(t => ({ start: clamp(t.start_min), end: clamp(t.end_min) }))
    .sort((a, b) => a.start - b.start);
  if (rawTrips.length === 0) return [];

  // MERGE overlapping or duplicate trip intervals so each driving block in
  // the chart corresponds to one contiguous "truck was moving" window.
  // Titan can emit duplicates (same start/end on different unit cells) and
  // partially-overlapping trips when GPS is noisy, without merging, the
  // segments sum to more than 24 hours.
  const cleanTrips = [];
  for (const t of rawTrips) {
    const prev = cleanTrips[cleanTrips.length - 1];
    if (prev && t.start <= prev.end) {
      // overlap or touching, extend the previous interval
      if (t.end > prev.end) prev.end = t.end;
    } else {
      cleanTrips.push({ start: t.start, end: t.end });
    }
  }

  // Build the workday timeline as raw {start, end, row} segments. We'll merge
  // adjacent same-row segments at the end so the path is clean.
  const raw = [];
  const firstStart = cleanTrips[0].start;
  const lastEnd = cleanTrips[cleanTrips.length - 1].end;
  // Pre-trip bookend uses the ACTUAL DVIR signed time (in minutes from
  // midnight). Only draw a preamble if the pre-trip was signed strictly
  // BEFORE the first trip started. Hardcoding "15 min before first trip"
  // invented on-duty time that wasn't in the data, wrong.
  const preTimeMin = (pre && Number.isFinite(pre.time_min)) ? clamp(pre.time_min) : null;
  const postTimeMin = (post && Number.isFinite(post.time_min)) ? clamp(post.time_min) : null;
  const workStart = (preTimeMin != null && preTimeMin < firstStart) ? preTimeMin : firstStart;
  const workEnd = (postTimeMin != null && postTimeMin > lastEnd) ? postTimeMin : lastEnd;

  // 1. Off-duty before the work day starts.
  if (workStart > 0) raw.push({ start: 0, end: workStart, row: 0 });

  // 2. Pre-trip on-duty bookend (only when DVIR was filed BEFORE first trip).
  if (workStart < firstStart) raw.push({ start: workStart, end: firstStart, row: 3 });

  // 3. Walk through trips chronologically.
  //    Each trip is one DRIVING segment. The gap to the next trip is ON-DUTY.
  for (let i = 0; i < cleanTrips.length; i++) {
    const t = cleanTrips[i];
    if (t.end > t.start) raw.push({ start: t.start, end: t.end, row: 2 });
    if (i < cleanTrips.length - 1) {
      const nextStart = cleanTrips[i + 1].start;
      if (nextStart > t.end) raw.push({ start: t.end, end: nextStart, row: 3 });
    }
  }

  // 4. Post-trip on-duty bookend uses the ACTUAL DVIR signed time. Only
  //    draw a tail if post-trip was signed AFTER the last trip ended.
  //    Post-trip is NOT legally required (NSC Std 13), so absence just
  //    means the work day ends at the last trip end.
  if (workEnd > lastEnd) raw.push({ start: lastEnd, end: workEnd, row: 3 });

  // 5. Off-duty after the work day ends.
  if (workEnd < DAY) raw.push({ start: workEnd, end: DAY, row: 0 });

  // Final cleanup: drop degenerate, clamp row range, and merge consecutive
  // same-row segments so the stepped path doesn't have redundant junctions.
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

function DutyChart({ day, trips, pre, post }) {
  const W = 1180, H = 200;
  const padL = 110, padR = 140, padT = 16, padB = 32;
  const clipId = "dutyClip-" + (day || "x");
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const rowH = plotH / 4;
  const xAt = (m) => padL + (m / 1440) * plotW;
  const yAt = (row) => padT + row * rowH + rowH / 2;

  const segs = buildSegments(trips, pre, post);
  const rows = ["Off Duty", "Sleeper Berth", "Driving", "On Duty"];
  const rowColors = ["#3C5E7E", "#3C5E7E", "#D9501F", "#3C5E7E"];
  const totals = [0, 0, 0, 0];
  segs.forEach(s => totals[s.row] += (s.end - s.start));
  // Guardrail: cap each row total at 24h. With clean segments this can't be
  // exceeded, but defends against any future feeder that double-counts.
  for (let i = 0; i < totals.length; i++) totals[i] = Math.min(totals[i], 24 * 60);
  const isEmpty = segs.length === 0;

  // Format mins as H:MM and span as e.g. "08:15 – 11:30 · 3h 15m"
  const fmtClock = (m) => {
    const h = Math.floor(m / 60), mm = Math.floor(m % 60);
    return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
  };
  const fmtDur = (m) => {
    const h = Math.floor(m / 60), mm = Math.round(m % 60);
    return h > 0 ? (mm > 0 ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`;
  };

  // Build the stepped path
  let path = "";
  segs.forEach((s, i) => {
    if (i === 0) path += `M ${xAt(s.start)} ${yAt(s.row)} `;
    else path += `L ${xAt(s.start)} ${yAt(s.row)} `;
    path += `L ${xAt(s.end)} ${yAt(s.row)} `;
  });

  return (
    <div style={{ padding: 16, background: "var(--white)" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", fontFamily: "var(--font-sans)" }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={padL} y={padT} width={W - padL - padR} height={H - padT - padB} />
          </clipPath>
        </defs>
        {/* Row backgrounds */}
        {rows.map((label, i) => (
          <g key={i}>
            <rect x={padL} y={padT + i * rowH} width={plotW} height={rowH}
              fill={i % 2 === 0 ? "#FAFBFC" : "#FFFFFF"} stroke="#E7EAEE" strokeWidth={1} />
            {/* Row color swatch, orange for Driving, navy for the rest */}
            <rect x={padL - 18} y={padT + i * rowH + rowH / 2 - 5}
              width={i === 2 ? 10 : 6} height={i === 2 ? 10 : 6}
              fill={rowColors[i]} rx={1} />
            <text x={padL - (i === 2 ? 24 : 22)} y={padT + i * rowH + rowH / 2 + 4} textAnchor="end"
              fontSize="11" fontWeight={i === 2 ? 700 : 600}
              fill={i === 2 ? "#B23A0E" : "#3A434D"}>{label}</text>
            {/* Total label on right */}
            <text x={padL + plotW + 10} y={padT + i * rowH + rowH / 2 + 4}
              fontSize="12" fontFamily="ui-monospace, monospace"
              fill={i === 2 ? "#B23A0E" : "#112436"} fontWeight={i === 2 ? 700 : 600}>
              {(totals[i] / 60).toFixed(2)}h
            </text>
          </g>
        ))}

        {/* Hour grid */}
        {Array.from({ length: 25 }).map((_, h) => {
          const x = xAt(h * 60);
          const isNoon = h === 12;
          const isMid = h === 0 || h === 24;
          return (
            <g key={h}>
              <line x1={x} y1={padT} x2={x} y2={padT + plotH}
                stroke={isNoon || isMid ? "#3C5E7E" : "#D4D9DE"}
                strokeWidth={isNoon || isMid ? 1 : 0.5}
                strokeDasharray={isNoon || isMid ? "" : "2,2"} />
              <text x={x} y={H - padB + 14} textAnchor="middle" fontSize="10" fill="#6B7682">
                {h === 0 ? "Mid" : h === 12 ? "Noon" : h === 24 ? "Mid" : (h % 12 || 12)}
              </text>
              {/* Quarter ticks */}
              {h < 24 && [15, 30, 45].map(q => (
                <line key={q} x1={xAt(h * 60 + q)} y1={padT + plotH - 4} x2={xAt(h * 60 + q)} y2={padT + plotH}
                  stroke="#B7BEC6" strokeWidth={0.5} />
              ))}
            </g>
          );
        })}

        {/* Empty-state message when no valid timeline data exists (guardrail) */}
        {isEmpty && (
          <text x={padL + plotW / 2} y={padT + plotH / 2 + 4} textAnchor="middle"
            fontSize="13" fontStyle="italic" fill="#6B7682">No duty timeline data for this day</text>
        )}

        {/* Duty trace, clipped to plot rect so it can't bleed into totals column */}
        <g clipPath={`url(#${clipId})`}>
          <path d={path} fill="none" stroke="#112436" strokeWidth={2} strokeLinejoin="miter" />
          {/* Invisible hover targets for every segment so you can hover the trace, not just driving */}
          {segs.map((s, i) => (
            <line key={`hit${i}`} className={`nf-duty-seg ${s.row === 2 ? "driving" : "other"}`}
              x1={xAt(s.start)} y1={yAt(s.row)} x2={xAt(s.end)} y2={yAt(s.row)}
              stroke="transparent" strokeWidth={14} style={{ cursor: "help", animationDelay: `${i * 18}ms` }}>
              <title>{`${rows[s.row]}  ·  ${fmtClock(s.start)}–${fmtClock(s.end)}  ·  ${fmtDur(s.end - s.start)}`}</title>
            </line>
          ))}
          {/* Visible orange driving overlay */}
          {segs.filter(s => s.row === 2).map((s, i) => (
            <line key={`d${i}`} className="nf-duty-seg driving"
              x1={xAt(s.start)} y1={yAt(2)} x2={xAt(s.end)} y2={yAt(2)}
              stroke="#D9501F" strokeWidth={3}
              style={{ cursor: "help", animationDelay: `${120 + i * 60}ms` }}>
              <title>{`Driving  ·  ${fmtClock(s.start)}–${fmtClock(s.end)}  ·  ${fmtDur(s.end - s.start)}`}</title>
            </line>
          ))}
        </g>

        {/* Totals header */}
        <text x={padL + plotW + 10} y={padT - 4} fontSize="9.5" fontWeight="600"
          letterSpacing="1.5" fill="#6B7682">TOTAL</text>
      </svg>
      <div style={{ marginTop: 8, display: "flex", gap: 16, font: "11px var(--font-sans)", color: "var(--fg-muted)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, background: "#D9501F", borderRadius: 1 }} />
          <span style={{ color: "#B23A0E", fontWeight: 600 }}>Driving</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, background: "#3C5E7E", borderRadius: 1 }} /> Other duty status
        </span>
        <span style={{ color: "var(--fg-muted)" }}>Hover any segment for time + duration</span>
        <span style={{ marginLeft: "auto" }}>Synthesized from trip + DVIR data · 24-hour local time (MDT)</span>
      </div>
    </div>
  );
}

Object.assign(window, { DriverDetail, DayDetail, DutyChart, LocationCell });
