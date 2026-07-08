// Main Dashboard view, fleet overview, weight filter as primary lens.

const Dashboard = ({ state, setState, onNavigate }) => {
  const D = window.NORFAB_DATA;
  const { unitId, weightFilter, year, month, includeMinor } = state;

  const fromISO = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getUTCDate();
  const toISO = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const trips = D.tripsForRange(unitId, weightFilter, fromISO, toISO, includeMinor);
  const byDay = D.summarize(trips);

  // KPIs for the strip
  const totalKm = trips.reduce((s, t) => s + t.km, 0);
  const flagCount = trips.filter(t => t.flagged).length;
  const daysWithData = Object.keys(byDay).length;
  const unitsActive = new Set(trips.map(t => t.unit));
  const outsideRadius = trips.filter(t => t.outside_radius).length;

  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const todayMDT = "Thu, May 07, 2026, 10:20 a.m. MDT";

  const goPrev = () => {
    const d = new Date(year, month - 1, 1);
    setState(s => ({ ...s, year: d.getFullYear(), month: d.getMonth() }));
  };
  const goNext = () => {
    const d = new Date(year, month + 1, 1);
    setState(s => ({ ...s, year: d.getFullYear(), month: d.getMonth() }));
  };

  // Compliance rollup banner status
  const complianceTone = flagCount === 0 ? "ok" : flagCount < 5 ? "warn" : "flag";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 0, height: "100%", minHeight: 0 }}>
      {/* Left rail */}
      <aside style={{
        background: "var(--white)",
        borderRight: "1px solid var(--border)",
        padding: "20px 18px",
        display: "flex", flexDirection: "column", gap: 18,
        overflowY: "auto",
      }}>
        {/* Weight filter, the primary NSC compliance lens */}
        <div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <Eyebrow>NSC weight lens</Eyebrow>
            <span style={{ font: "10.5px var(--font-sans)", color: "var(--accent-700)" }}>Primary filter</span>
          </div>
          <WeightSegmented value={weightFilter} onChange={v => setState(s => ({ ...s, weightFilter: v }))} />
          <div style={{ font: "11.5px/1.45 var(--font-sans)", color: "var(--fg-muted)", marginTop: 8 }}>
            Alberta treats units at/above <strong style={{ color: "var(--navy-800)" }}>11,794 kg GVW</strong> as time-record required, with a <strong style={{ color: "var(--navy-800)" }}>160 km</strong> radius exemption.
          </div>
        </div>

        {/* Unit selector */}
        <div>
          <FieldLabel>Unit</FieldLabel>
          <Select value={unitId} onChange={v => setState(s => ({ ...s, unitId: v }))}
            options={[{ value: "ALL", label: "All units" }, ...D.UNITS.map(u => ({ value: u.id, label: `${u.id} · ${u.year} ${u.make} ${u.model}` }))]} />
          {unitId !== "ALL" && (() => {
            const u = D.UNITS.find(x => x.id === unitId);
            return (
              <div style={{ marginTop: 10, padding: 12, background: "var(--steel-50)", border: "1px solid var(--rule)", borderRadius: 3 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ font: "600 13px var(--font-sans)", color: "var(--navy-900)" }}>{u.id}</span>
                  <Pill tone={u.klass === "heavy" ? "warn" : "neutral"}>{u.klass === "heavy" ? "Heavy" : "Light"}</Pill>
                </div>
                <div style={{ font: "11.5px/1.4 var(--font-sans)", color: "var(--fg-subtle)", marginTop: 4 }}>
                  {u.driver} · GVW {u.gvw_kg.toLocaleString()} kg
                </div>
                <Btn kind="ghost" size="sm" style={{ marginLeft: -8, marginTop: 6 }} onClick={() => onNavigate("unit", { unitId })}>
                  Open unit detail →
                </Btn>
              </div>
            );
          })()}
        </div>

        {/* Minor trips toggle */}
        <Toggle label="Include minor trips" sub="Trips under 0.60 km"
          checked={includeMinor} onChange={v => setState(s => ({ ...s, includeMinor: v }))} />

        <div style={{ flex: 1 }} />

        {/* Status / pipeline indicators (cleaned up) */}
        <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Pipeline</Eyebrow>
          <PipelineRow tone="ok" label="Live JSON" detail="Synced 14:32 MDT" />
          <PipelineRow tone="ok" label="Evidence folder" detail="Attached · 8 units" />
          <PipelineRow tone="warn" label="Audit chain" detail="Verify pending" />
          <PipelineRow tone="ok" label="Watcher" detail="Running · 5 min poll" />
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <Btn kind="secondary" size="sm" style={{ flex: 1 }} icon={<Icon name="refresh-cw" size={13} />}>Sync now</Btn>
          <Btn kind="icon" size="sm" title="Settings"><Icon name="settings-2" size={14} /></Btn>
        </div>
      </aside>

      {/* Main */}
      <main style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16, minHeight: 0, overflowY: "auto" }}>
        {/* Compliance banner */}
        <ComplianceBanner tone={complianceTone} flagCount={flagCount} outsideRadius={outsideRadius}
          unitsActive={unitsActive.size} weightFilter={weightFilter} />

        {/* KPI strip */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          background: "var(--white)",
          border: "1px solid var(--border)",
          borderRadius: 4,
        }}>
          <Stat label="Window" value={monthLabel} sub={`${fromISO} – ${toISO}`} style={{ borderLeft: "none", padding: "12px 14px" }} />
          <Stat label="Units active" value={unitsActive.size} sub={`of ${D.UNITS.length} fleet`} style={{ borderLeft: "1px solid var(--border)", borderRight: "none", padding: "12px 14px" }} />
          <Stat label="Days w/ data" value={daysWithData} style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} />
          <Stat label="Trips" value={trips.length} style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} />
          <Stat label="Distance" value={`${totalKm.toFixed(1)} km`} style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} />
          <Stat label="Outside radius" value={outsideRadius} style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} accent={outsideRadius ? "var(--accent-600)" : undefined} />
          <Stat label="Flagged trips" value={flagCount} style={{ borderLeft: "1px solid var(--border)", padding: "12px 14px" }} accent={flagCount ? "var(--accent-600)" : undefined} />
        </div>

        {/* Calendar header */}
        <Card padding={0} style={{ flex: 1, minHeight: 520, display: "flex", flexDirection: "column" }}>
          <div style={{
            padding: "14px 18px", borderBottom: "1px solid var(--rule)",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Btn kind="icon" size="sm" onClick={goPrev}><Icon name="chevron-left" size={14} /></Btn>
              <div style={{ font: "600 18px/1 var(--font-sans)", color: "var(--navy-900)", minWidth: 150, textAlign: "center" }}>{monthLabel}</div>
              <Btn kind="icon" size="sm" onClick={goNext}><Icon name="chevron-right" size={14} /></Btn>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <LegendItem swatch="var(--rule)" label="No activity" />
              <LegendItem swatchBorder="2px solid var(--navy-700)" label="Compliant day" />
              <LegendItem swatchBorder="2px solid var(--accent-600)" label="Flagged day" dot />
              <span style={{ width: 1, height: 18, background: "var(--rule)", margin: "0 4px" }} />
              <Btn kind="secondary" size="sm" icon={<Icon name="book-open" size={14} />} onClick={() => onNavigate("daily-log-list")}>
                Driver logs
              </Btn>
              <Btn kind="primary" size="sm" icon={<Icon name="file-text" size={14} />} onClick={() => onNavigate("audit")}>
                Audit export
              </Btn>
            </div>
          </div>
          <div style={{ flex: 1, padding: 16, minHeight: 0 }}>
            <MonthCalendar year={year} month={month} byDay={byDay} weightCritical
              onDay={(iso) => {
                if (!byDay[iso]) return;
                if (unitId === "ALL") {
                  // jump to log list filtered to that day
                  onNavigate("daily-log-list", { dayISO: iso });
                } else {
                  onNavigate("trip-detail", { unitId, dayISO: iso });
                }
              }} />
          </div>
        </Card>

        {/* Fleet summary (only when ALL) */}
        {unitId === "ALL" && (
          <FleetSummary trips={trips} onUnitClick={(uid) => setState(s => ({ ...s, unitId: uid }))} />
        )}
      </main>
    </div>
  );
};

// ---------- Compliance banner ----------
function ComplianceBanner({ tone, flagCount, outsideRadius, unitsActive, weightFilter }) {
  const tones = {
    ok:   { bg: "#EAF3EE", bd: "#BFDDC9", fg: "#1F5C39", dot: "var(--ok)" },
    warn: { bg: "#FBF1DB", bd: "#E9CD8B", fg: "#7A5306", dot: "var(--warn)" },
    flag: { bg: "var(--accent-100)", bd: "#F0BFA0", fg: "var(--accent-700)", dot: "var(--accent-600)" },
  };
  const t = tones[tone];
  const text = tone === "ok"
    ? "All trips this period meet NSC return-to-origin and radius rules."
    : tone === "warn"
      ? `${flagCount} trip${flagCount === 1 ? "" : "s"} need review, within tolerance, no immediate action.`
      : `${flagCount} flagged trips this period, ${outsideRadius} outside the 160 km radius.`;
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.bd}`, borderRadius: 4,
      padding: "10px 14px", display: "flex", alignItems: "center", gap: 12,
    }}>
      <Dot tone={tone === "ok" ? "ok" : tone === "warn" ? "warn" : "flag"} size={10} />
      <div style={{ flex: 1, font: "500 13.5px/1.4 var(--font-sans)", color: t.fg }}>
        <strong style={{ fontWeight: 600 }}>{tone === "ok" ? "Compliant" : tone === "warn" ? "Minor variance" : "Review needed"}.</strong>{" "}
        {text}{" "}
        <span style={{ color: "var(--fg-muted)", fontWeight: 400 }}>
          · {unitsActive} unit{unitsActive === 1 ? "" : "s"} active · weight lens: {weightFilter === "heavy" ? "Heavy ≥ 11,794 kg" : weightFilter === "light" ? "Light < 11,794 kg" : "All"}
        </span>
      </div>
      <Btn kind="ghost" size="sm">View flag queue →</Btn>
    </div>
  );
}

// ---------- Weight segmented control ----------
function WeightSegmented({ value, onChange }) {
  const opts = [
    { v: "all", label: "All" },
    { v: "heavy", label: "≥ 11,794 kg" },
    { v: "light", label: "< 11,794 kg" },
  ];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
      border: "1px solid var(--border-strong)", borderRadius: 3,
      overflow: "hidden", background: "var(--white)",
    }}>
      {opts.map((o, i) => {
        const sel = value === o.v;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{
            font: `${sel ? 600 : 500} 12px/1 var(--font-sans)`,
            padding: "8px 6px", textAlign: "center",
            background: sel ? "var(--navy-900)" : "var(--white)",
            color: sel ? "#fff" : "var(--navy-800)",
            border: "none",
            borderLeft: i > 0 ? "1px solid var(--border-strong)" : "none",
            cursor: "pointer", whiteSpace: "nowrap",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

// ---------- Toggle ----------
function Toggle({ label, sub, checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      background: "transparent", border: "none", padding: 0, cursor: "pointer",
      display: "flex", alignItems: "center", gap: 10, textAlign: "left",
    }}>
      <div style={{
        width: 32, height: 18, borderRadius: 999,
        background: checked ? "var(--navy-800)" : "var(--steel-200)",
        position: "relative", flex: "0 0 auto",
        transition: "background 160ms ease",
      }}>
        <div style={{
          position: "absolute", top: 2, left: checked ? 16 : 2,
          width: 14, height: 14, borderRadius: 999, background: "#fff",
          transition: "left 160ms ease",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        }} />
      </div>
      <div>
        <div style={{ font: "500 13px/1.2 var(--font-sans)", color: "var(--navy-900)" }}>{label}</div>
        <div style={{ font: "11.5px/1.3 var(--font-sans)", color: "var(--fg-muted)", marginTop: 1 }}>{sub}</div>
      </div>
    </button>
  );
}

// ---------- Pipeline row ----------
function PipelineRow({ tone, label, detail }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--rule)" }}>
      <Dot tone={tone} size={8} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "500 12.5px/1.2 var(--font-sans)", color: "var(--navy-900)" }}>{label}</div>
        <div style={{ font: "11px/1.3 var(--font-sans)", color: "var(--fg-muted)", marginTop: 1 }}>{detail}</div>
      </div>
    </div>
  );
}

// ---------- Legend item ----------
function LegendItem({ swatch, swatchBorder, label, dot }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "11.5px var(--font-sans)", color: "var(--fg-muted)" }}>
      <span style={{
        width: 14, height: 14, display: "inline-block",
        background: swatch || "var(--white)",
        border: swatchBorder || "1px solid var(--rule)",
        borderRadius: 2, position: "relative",
      }}>
        {dot && <span style={{ position: "absolute", top: 2, right: 2, width: 4, height: 4, background: "var(--accent-600)", borderRadius: 999 }} />}
      </span>
      {label}
    </div>
  );
}

// ---------- Fleet summary (when ALL) ----------
function FleetSummary({ trips, onUnitClick }) {
  const D = window.NORFAB_DATA;
  const byUnit = {};
  for (const u of D.UNITS) byUnit[u.id] = { unit: u, trips: 0, km: 0, flags: 0, days: new Set() };
  for (const t of trips) {
    if (!byUnit[t.unit]) continue;
    byUnit[t.unit].trips++;
    byUnit[t.unit].km += t.km;
    if (t.flagged) byUnit[t.unit].flags++;
    byUnit[t.unit].days.add(t.date);
  }
  return (
    <Card padding={0}>
      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow>Fleet at a glance</Eyebrow>
        <span style={{ font: "11.5px var(--font-sans)", color: "var(--fg-muted)" }}>{D.UNITS.length} units</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {D.UNITS.map((u, i) => {
          const r = byUnit[u.id];
          const flagged = r.flags > 0;
          return (
            <button key={u.id} onClick={() => onUnitClick(u.id)} style={{
              cursor: "pointer", textAlign: "left", background: "transparent",
              border: "none",
              borderRight: (i % 4 < 3) ? "1px solid var(--rule)" : "none",
              borderBottom: i < D.UNITS.length - 4 ? "1px solid var(--rule)" : "none",
              borderLeft: flagged ? "2px solid var(--accent-600)" : "2px solid transparent",
              padding: "12px 14px",
              transition: "background 120ms ease",
              font: "inherit", color: "inherit",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--steel-50)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ font: "600 13px/1 var(--font-mono)", color: "var(--navy-900)" }}>{u.id}</span>
                <Pill tone={u.klass === "heavy" ? "warn" : "neutral"} style={{ padding: "2px 6px" }}>
                  {u.klass === "heavy" ? "Heavy" : "Light"}
                </Pill>
              </div>
              <div style={{ font: "11.5px/1.3 var(--font-sans)", color: "var(--fg-muted)", marginTop: 3 }}>
                {u.year} {u.make} {u.model}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 14, font: "11.5px var(--font-sans)" }}>
                <span><span style={{ color: "var(--fg-muted)" }}>Trips </span><strong style={{ font: "500 13px var(--font-mono)", color: "var(--navy-900)" }}>{r.trips}</strong></span>
                <span><span style={{ color: "var(--fg-muted)" }}>Km </span><strong style={{ font: "500 13px var(--font-mono)", color: "var(--navy-900)" }}>{r.km.toFixed(0)}</strong></span>
                <span style={{ marginLeft: "auto", color: r.flags ? "var(--accent-700)" : "var(--ok)", fontWeight: 600 }}>
                  {r.flags ? `${r.flags} flag${r.flags === 1 ? "" : "s"}` : "Clean"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

window.Dashboard = Dashboard;
