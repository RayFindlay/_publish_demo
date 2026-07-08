// Zone 1, Fleet Overview, v2
// Driver-centric, today-first. Uses the Heritage palette structurally
// (navy hero, accent-tinted action cards) and groups drivers by status.

const { useState: useStateFO, useMemo: useMemoFO } = React;

const FleetOverview = ({ onOpenDriver, onOpenDay, onOpenAudit, onOpenVehicles, onOpenExpiries, onCopyLink }) => {
  const D = window.NORFAB_DATA;
  const [search, setSearch] = useStateFO("");
  const [weightFilter, setWeightFilter] = useStateFO("all");

  const todays = useMemoFO(() => D.DRIVERS.map(drv => {
    const c = D.dayCompliance(drv.id, D.TODAY);
    const u = D.UNITS.find(x => x.id === drv.unit);
    const last = D.TRIPS.filter(t => t.driver === drv.id).sort((a, b) => b.date.localeCompare(a.date) || b.end_min - a.end_min)[0];
    // Build last-7-days sparkline
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(D.TODAY + "T12:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      week.push({ iso, c: D.dayCompliance(drv.id, iso) });
    }
    return { drv, unit: u, c, last, week };
  }), []);

  // Compliance counters. Post-trip DVIR is NOT a regulatory requirement
  // (NSC Standard 13 only mandates the pre-trip / daily trip inspection),
  // so post-trip absence never counts toward "items need attention".
  //
  // "Active today" and "Not driving" form a partition of D.DRIVERS: every
  // driver lands in exactly one bucket. A driver who filed a pre-trip but
  // hasn't actually driven yet is still "active" (they're on-shift), not
  // "not driving".
  const cActive = todays.filter(x => x.c.state !== "none" || !!x.c.pre).length;
  const cExempt = todays.filter(x => x.c.state === "exempt").length;
  const cFull   = todays.filter(x => x.c.state === "full-log").length;
  const cNoAct  = todays.filter(x => x.c.state === "none" && !x.c.pre).length;
  const cNoPre  = todays.filter(x => x.c.state !== "none" && !x.c.pre).length;

  const rows = todays.filter(({ drv, unit }) => {
    if (search && !drv.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (weightFilter === "heavy" && unit.klass !== "heavy") return false;
    if (weightFilter === "light" && unit.klass !== "light") return false;
    return true;
  });

  // Action = needs a full daily log, OR is missing the legally-required pre-trip.
  // Post-trip absence does not put a driver in the action queue.
  const action  = rows.filter(r => r.c.state === "full-log" || (r.c.state !== "none" && !r.c.pre));
  const exempt  = rows.filter(r => r.c.state === "exempt" && r.c.pre);
  const idle    = rows.filter(r => r.c.state === "none");

  // Sort each section by name
  [action, exempt, idle].forEach(arr => arr.sort((a, b) => a.drv.name.localeCompare(b.drv.name)));

  const todayLabel = new Date(D.TODAY + "T12:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const allCompliant = cFull === 0 && cNoPre === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--bg)" }}>

      {/* ============ HERO STRIP (navy, full-bleed) ============ */}
      {/* Padding moved from outer to inner divs so hero content edges align
          with body content edges at viewports > 1480 (was misaligned by 24px
          in the source design, the dual padding stack offset hero vs body). */}
      <div style={{ background: "var(--navy-900)", color: "#fff", padding: "22px 0", borderBottom: "1px solid var(--navy-950)" }}>
        <div style={{ maxWidth: 1480, margin: "0 auto", padding: "0 24px", boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 32, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
            <div>
              <div style={{ font: "600 10.5px/1 var(--font-sans)", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
                Fleet status · {todayLabel}
              </div>
              <div style={{ font: "700 34px/1.05 var(--font-display)", color: "#fff", letterSpacing: "-0.015em", marginTop: 8 }}>
                {allCompliant
                  ? <>All <span style={{ color: "var(--accent-500)" }}>{D.DRIVERS.length}</span> drivers compliant today.</>
                  : <><span style={{ color: "var(--accent-500)" }}>{cFull + cNoPre}</span> {(cFull + cNoPre) === 1 ? "item needs" : "items need"} attention.</>}
              </div>
              <div style={{ font: "13px/1.4 var(--font-sans)", color: "rgba(255,255,255,0.7)", marginTop: 8 }}>
                Pipeline updates hourly, ~7 min after each Titan delivery.
              </div>
              {D.LATEST_DATA_DAY && D.LATEST_DATA_DAY !== D.CALENDAR_TODAY && (
                <div style={{ font: "12px/1.4 var(--font-sans)", color: "rgba(255,176,137,0.9)", marginTop: 6 }}>
                  No fleet activity yet today, showing latest from{" "}
                  {new Date(D.LATEST_DATA_DAY + "T12:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Inline counter strip inside hero, outer wrapper matches body's
            padding/maxWidth so the visible strip card aligns edge-to-edge
            with the driver cards below at every viewport. */}
        <div style={{ maxWidth: 1480, margin: "20px auto 0", padding: "0 24px", boxSizing: "border-box" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4 }}>
            <HeroCounter label="Active today" value={cActive} sub={`of ${D.DRIVERS.length} on roster`} />
            <HeroCounter label="160 km exempt" value={cExempt} sub="No log required" tone="ok" divider />
            <HeroCounter label="Full log required" value={cFull} sub={cFull ? "Outside scope" : "None"} tone={cFull ? "accent" : "muted"} divider />
            <HeroCounter label="Missing pre-trip" value={cNoPre} sub={cNoPre ? "Action needed" : "All filed"} tone={cNoPre ? "accent" : "ok"} divider />
            <HeroCounter label="Not driving" value={cNoAct} sub="Idle today" tone="muted" divider />
          </div>
        </div>
      </div>

      {/* ============ BODY ============ */}
      <div style={{ padding: "20px 24px 32px", maxWidth: 1480, margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 18 }}>

        {/* Filter bar */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: "0 0 280px" }}>
            <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--fg-muted)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search driver..."
              style={{
                width: "100%", padding: "8px 10px 8px 32px", boxSizing: "border-box",
                border: "1px solid var(--border-strong)", borderRadius: 3,
                font: "13px var(--font-sans)", color: "var(--navy-900)", background: "var(--white)", outline: "none",
              }} />
          </div>
          <Segmented value={weightFilter} onChange={setWeightFilter} options={[
            { v: "all", label: "All weights" },
            { v: "heavy", label: "≥ 11,794 kg" },
            { v: "light", label: "< 11,794 kg" },
          ]} />
          <div style={{ marginLeft: "auto", font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
            {rows.length} of {D.DRIVERS.length} drivers · {action.length} need attention
          </div>
        </div>

        {/* ============ SECTION 1, NEEDS ATTENTION ============ */}
        {action.length > 0 && (
          <Section title="Needs attention today" count={action.length} accent="accent" sub="Full daily log required, or pre-trip inspection missing.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {action.map(({ drv, unit, c, last, week }) => (
                <DriverCard key={drv.id} variant="action" drv={drv} unit={unit} c={c} last={last} week={week}
                  onOpen={() => onOpenDriver(drv.id)} onOpenDay={(iso) => onOpenDay(drv.id, iso)} onCopy={() => onCopyLink(drv)} />
              ))}
            </div>
          </Section>
        )}

        {/* ============ SECTION 2, EXEMPT ============ */}
        {exempt.length > 0 && (
          <Section title="160 km exempt · compliant" count={exempt.length} accent="ok" sub="Operated within home-terminal radius and returned. No full daily log required.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {exempt.map(({ drv, unit, c, last, week }) => (
                <DriverCard key={drv.id} variant="ok" drv={drv} unit={unit} c={c} last={last} week={week}
                  onOpen={() => onOpenDriver(drv.id)} onOpenDay={(iso) => onOpenDay(drv.id, iso)} onCopy={() => onCopyLink(drv)} />
              ))}
            </div>
          </Section>
        )}

        {/* ============ SECTION 3, IDLE ============ */}
        {idle.length > 0 && (
          <Section title="No activity today" count={idle.length} accent="neutral" sub="No trips logged. Driver may be off, or hasn't departed yet.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {idle.map(({ drv, unit, c, last, week }) => (
                <DriverCard key={drv.id} variant="idle" drv={drv} unit={unit} c={c} last={last} week={week}
                  onOpen={() => onOpenDriver(drv.id)} onOpenDay={(iso) => onOpenDay(drv.id, iso)} onCopy={() => onCopyLink(drv)} />
              ))}
            </div>
          </Section>
        )}

        {rows.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--fg-muted)", border: "1px dashed var(--border)", borderRadius: 4 }}>
            No drivers match the current filter.
          </div>
        )}

        {/* Recent activity widget - last 24h of fleet activity */}
        <RecentActivity onOpenDriver={onOpenDriver} />
      </div>
    </div>
  );
};

// Last-24h activity feed (trips + DVIs filed). Mixed timeline, most recent first.
function RecentActivity({ onOpenDriver }) {
  const D = window.NORFAB_DATA;
  // Build a unified event list. Use the day calendar's "today" as the anchor
  // and look back ~36h to handle late-evening filings rolling into next day.
  const events = React.useMemo(() => {
    const out = [];
    const tripDayCutoff = (() => {
      const d = new Date(D.TODAY + "T00:00:00");
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    for (const t of D.TRIPS) {
      if (!t.date || t.date < tripDayCutoff) continue;
      out.push({
        kind: "trip",
        date: t.date,
        timeMin: t.end_min != null ? t.end_min : (t.start_min || 0),
        driver: t.driver,
        driver_name: t.driver_name,
        unit: t.unit,
        text: `${t.unit ? t.unit + " " : ""}${(t.km || 0).toFixed(1)} km · ${t.start_site || ""}${t.end_site ? " to " + t.end_site : ""}`,
      });
    }
    for (const v of D.DVIR) {
      if (!v.date_local || v.date_local < tripDayCutoff) continue;
      out.push({
        kind: v.trip_type === "Post" ? "post" : "pre",
        date: v.date_local,
        timeMin: v.time_min || 0,
        driver: v.driver,
        driver_name: v.driver_name,
        unit: v.unit,
        text: `${v.unit}${v.odometer_km ? " · " + v.odometer_km.toLocaleString() + " km" : ""}`,
      });
    }
    out.sort((a, b) => b.date.localeCompare(a.date) || b.timeMin - a.timeMin);
    return out.slice(0, 12);
  }, []);

  if (events.length === 0) return null;

  return (
    <div style={{ marginTop: 8, padding: 16, background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div style={{ font: "600 10px var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-muted)" }}>
          Recent activity
        </div>
        <div style={{ font: "11px var(--font-sans)", color: "var(--fg-muted)" }}>
          Last 24 hours (most recent first)
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {events.map((e, i) => (
          <div key={i} onClick={() => onOpenDriver(e.driver)}
            style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 8px", borderRadius: 3, cursor: "pointer",
              borderBottom: i < events.length - 1 ? "1px solid var(--rule)" : "none" }}>
            <span style={{
              font: "600 9.5px var(--font-sans)", letterSpacing: "0.06em", textTransform: "uppercase",
              padding: "2px 6px", borderRadius: 2, minWidth: 56, textAlign: "center",
              background: e.kind === "pre" ? "#EAF3EE" : e.kind === "post" ? "#F4E4CE" : "#E8EEF6",
              color: e.kind === "pre" ? "var(--ok)" : e.kind === "post" ? "#8A5723" : "var(--navy-800)",
            }}>{e.kind === "pre" ? "Pre-Trip" : e.kind === "post" ? "Post-Trip" : "Trip"}</span>
            <span style={{ font: "12px var(--font-mono)", color: "var(--fg-muted)", minWidth: 96 }}>
              {e.date} {D.minToHHMM ? D.minToHHMM(e.timeMin) : ""}
            </span>
            <span style={{ font: "13px var(--font-sans)", color: "var(--navy-900)", fontWeight: 500, minWidth: 140 }}>
              {e.driver_name || e.driver}
            </span>
            <span style={{ font: "12.5px var(--font-sans)", color: "var(--fg-subtle)", flex: 1 }}>
              {e.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Hero counter (dark) ----------
function HeroCounter({ label, value, sub, tone = "muted", divider }) {
  const tones = {
    muted:  "#fff",
    ok:     "#7DD3A8",
    accent: "var(--accent-500)",
  };
  return (
    <div style={{
      padding: "14px 18px",
      borderLeft: divider ? "1px solid rgba(255,255,255,0.1)" : "none",
    }}>
      <div style={{ font: "600 10px/1 var(--font-sans)", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{label}</div>
      <div style={{ font: "700 30px/1.05 var(--font-display)", color: tones[tone], marginTop: 8, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ font: "11.5px/1.3 var(--font-sans)", color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ---------- Section wrapper ----------
function Section({ title, count, sub, accent, children }) {
  const colors = {
    accent:  { bar: "var(--accent-600)", chipBg: "var(--accent-100)", chipFg: "var(--accent-700)" },
    ok:      { bar: "var(--ok)",          chipBg: "#EAF3EE",            chipFg: "#236B43" },
    neutral: { bar: "var(--steel-300)",   chipBg: "var(--steel-100)",   chipFg: "var(--steel-700)" },
  }[accent];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, paddingLeft: 12, borderLeft: `3px solid ${colors.bar}` }}>
        <div style={{ font: "600 16px/1.1 var(--font-sans)", color: "var(--navy-900)" }}>{title}</div>
        <span style={{
          font: "600 11px/1 var(--font-sans)", letterSpacing: "0.04em",
          background: colors.chipBg, color: colors.chipFg,
          padding: "3px 8px", borderRadius: 3,
        }}>{count}</span>
        <div style={{ font: "12.5px/1.4 var(--font-sans)", color: "var(--fg-muted)", marginLeft: "auto", textAlign: "right", maxWidth: 480 }}>{sub}</div>
      </div>
      {children}
    </div>
  );
}

// ---------- Driver card (variant-aware) ----------
function DriverCard({ variant, drv, unit, c, last, week, onOpen, onOpenDay, onCopy }) {
  // Animation class injected via root div className below

  const skins = {
    action: {
      bg: "#FFF8F3",
      bd: "#F0BFA0",
      leftBar: "var(--accent-600)",
      nameColor: "var(--navy-900)",
    },
    ok: {
      bg: "var(--white)",
      bd: "var(--border)",
      leftBar: "var(--ok)",
      nameColor: "var(--navy-900)",
    },
    idle: {
      bg: "var(--steel-50)",
      bd: "var(--border)",
      leftBar: "var(--steel-300)",
      nameColor: "var(--steel-700)",
    },
  };
  const s = skins[variant];

  // Status pill is shown only on action cards (Needs attention today). The
  // ok and idle variants live inside sections whose own headers already
  // state what they are ("160 km exempt", "No activity today"), so an
  // extra "Exempt" / "Idle" pill on each card just repeats the heading.
  const stateLabel = c.state === "full-log" ? "Full log"
                   : (c.state !== "none" && !c.pre) ? "Missing pre-trip"
                   : c.state === "exempt" ? "Exempt"
                   : "Idle";
  const pillTone   = c.state === "full-log" ? "flag"
                   : (c.state !== "none" && !c.pre) ? "flag"
                   : c.state === "none" ? "neutral" : "ok";
  const showPill   = variant === "action";

  return (
    <div className="nf-card" style={{
      background: s.bg,
      border: `1px solid ${s.bd}`,
      borderLeft: `3px solid ${s.leftBar}`,
      borderRadius: 3,
      padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <button onClick={onOpen} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", flex: 1, minWidth: 0, display: "flex", gap: 10, alignItems: "center" }}>
          <UnitThumb unit={unit} size={48} />
          <div style={{ minWidth: 0 }}>
            <div style={{ font: "600 16px/1.2 var(--font-sans)", color: s.nameColor }}>{drv.name}</div>
            <div style={{ font: "12px/1.3 var(--font-sans)", color: "var(--fg-muted)", marginTop: 3 }}>
              {drv.unit} · {unit.year} {unit.make} {unit.model}
              <span style={{
                marginLeft: 6, padding: "1px 5px", borderRadius: 2,
                background: unit.klass === "heavy" ? "var(--navy-100, #E8EEF6)" : "transparent",
                color: unit.klass === "heavy" ? "var(--navy-800)" : "var(--fg-muted)",
                font: "600 10px/1 var(--font-sans)", letterSpacing: "0.08em", textTransform: "uppercase",
                border: unit.klass === "heavy" ? "1px solid #C9D5E5" : "none",
              }}>
                {unit.klass === "heavy" ? "Heavy" : "Light"}
              </span>
            </div>
          </div>
        </button>
        {showPill && (
          <Pill tone={pillTone}>
            {c.state !== "none" && <Dot tone={pillTone} size={6} />}
            {stateLabel}
          </Pill>
        )}
      </div>

      {window.ProximityChip && <div><window.ProximityChip driverId={drv.id} /></div>}

      {/* Today's activity strip */}
      {c.state !== "none" ? (
        <div style={{
          display: "grid", gridTemplateColumns: "auto auto auto auto",
          gap: 0, padding: "8px 0", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)",
        }}>
          <MiniStat label="Trips" value={c.trips} />
          <MiniStat label="Km" value={c.km.toFixed(0)} divider />
          <MiniStat label="Drive" value={`${c.drive_hrs.toFixed(1)}h`} divider />
          <MiniStat label="Pre / Post" value={
            <span style={{ display: "inline-flex", gap: 4 }}>
              <DvirDot ok={!!c.pre} label="S" /*required*/ />
              <DvirDot ok={!!c.post} label="E" optional />
            </span>
          } divider />
        </div>
      ) : (
        <div style={{ font: "12px/1.5 var(--font-sans)", color: "var(--fg-muted)", padding: "4px 0", borderTop: "1px solid var(--rule)", borderBottom: "1px solid var(--rule)" }}>
          {last ? `Last drove ${relativeDay(last.date)} · ${last.site}` : "No history on record"}
        </div>
      )}

      {/* 7-day strip */}
      <div>
        <div style={{ font: "600 9.5px/1 var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-muted)", marginBottom: 6 }}>
          Last 7 days
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
          {week.map((w, i) => {
            const fill = w.c.state === "full-log" ? "var(--accent-600)" : w.c.state === "exempt" ? "var(--ok)" : "var(--steel-200)";
            const isToday = i === 6;
            const dayLabel = new Date(w.iso + "T12:00").toLocaleDateString("en-US", { weekday: "narrow" });
            return (
              <button
                key={w.iso}
                title={`${w.iso} · ${w.c.state}, click to open`}
                onClick={(e) => { e.stopPropagation(); onOpenDay && onOpenDay(w.iso); }}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  background: "transparent", border: "none", padding: 0, cursor: "pointer",
                }}
              >
                <div className="day-strip-cell" style={{
                  height: 18, width: "100%",
                  background: fill,
                  borderRadius: 2,
                  outline: isToday ? "1.5px solid var(--navy-900)" : "none",
                  outlineOffset: 1,
                  transition: "transform 120ms var(--ease-out), box-shadow 120ms var(--ease-out)",
                }} />
                <span style={{ font: "10px var(--font-sans)", color: "var(--fg-muted)" }}>{dayLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Reasons (action only) */}
      {variant === "action" && c.reasons && c.reasons.length > 0 && (
        <div style={{
          font: "11.5px/1.4 var(--font-sans)", color: "var(--accent-700)",
          background: "var(--accent-100)", border: "1px solid #F0BFA0",
          padding: "6px 10px", borderRadius: 2,
        }}>
          <strong style={{ fontWeight: 600 }}>{c.reasons[0]}</strong>{c.reasons.length > 1 ? ` · +${c.reasons.length - 1} more` : ""}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
        <Btn kind="secondary" size="sm" style={{ flex: 1, justifyContent: "center" }} icon={<Icon name="link" size={13} />} onClick={onCopy}>
          Copy roadside link
        </Btn>
        <Btn kind={variant === "action" ? "accent" : "primary"} size="sm" onClick={onOpen} iconRight={<Icon name="arrow-right" size={13} />}>Open</Btn>
      </div>
    </div>
  );
}

function UnitThumb({ unit, size = 48 }) {
  const sty = {
    width: size, height: size, flex: `0 0 ${size}px`,
    borderRadius: 3, overflow: "hidden",
    border: "1px solid var(--border)",
    background: "var(--steel-100)",
    display: "flex", alignItems: "center", justifyContent: "center",
    font: "600 10px/1 var(--font-sans)", color: "var(--fg-muted)", letterSpacing: "0.04em",
  };
  if (unit && unit.photo) {
    return (
      <div style={sty}>
        <img src={unit.photo} alt={`${unit.id}, ${unit.make} ${unit.model}`}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  return <div style={sty}>{unit ? unit.id : "-"}</div>;
}
window.UnitThumb = UnitThumb;

function MiniStat({ label, value, divider }) {
  return (
    <div style={{ padding: "0 10px", borderLeft: divider ? "1px solid var(--rule)" : "none", minWidth: 0 }}>
      <div style={{ font: "600 9.5px/1 var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{label}</div>
      <div style={{ font: "600 14px/1.1 var(--font-mono)", color: "var(--navy-900)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

function DvirDot({ ok, label, optional }) {
  // For `optional` dots (post-trip, which is NOT legally required), use a
  // neutral grey for the "missing" state instead of warning-orange, so
  // post-trip absence doesn't read as a compliance violation.
  const missBg = optional ? "var(--steel-100)" : "var(--accent-100)";
  const missFg = optional ? "var(--fg-muted)" : "var(--accent-700)";
  const missBorder = optional ? "var(--border)" : "#F0BFA0";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 16, height: 14, borderRadius: 2,
      font: "600 9px/1 var(--font-sans)",
      background: ok ? "#EAF3EE" : missBg,
      color: ok ? "var(--ok)" : missFg,
      border: `1px solid ${ok ? "#BFDDC9" : missBorder}`,
    }}>{label}</span>
  );
}

function relativeDay(iso) {
  const today = new Date("2026-05-07T00:00Z");
  const d = new Date(iso + "T00:00Z");
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff} days ago`;
  return iso;
}

window.FleetOverview = FleetOverview;
