// Per-vehicle maintenance deep view.
//
// Renders one vehicle's full maintenance picture: identity header, KPI
// row, upcoming items (schedule + compliance expiries combined), open
// defects, and service history with a time-scope filter. Reachable from
// the Maintenance section's "By vehicle" tab (Chunk 4) and from the
// "See all" link on the vehicle profile (Chunk 5).

const { useState: useStateVM, useMemo: useMemoVM } = React;

const VehicleMaintenanceDetail = ({ unitId, onBack, onOpenUnit }) => {
  const D = window.NORFAB_DATA;
  const unit = D.UNITS.find(u => u.id === unitId);

  // History scope filter, defaults to "all" so the page is audit-ready
  // on first load. Same options as the global Maintenance log filter.
  const [historyFilter, setHistoryFilter] = useStateVM("all");

  if (!unit) {
    return (
      <div style={{ padding: "32px 24px", maxWidth: 1480, margin: "0 auto" }}>
        <button onClick={onBack}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
            font: "13px var(--font-sans)", color: "var(--navy-700)",
            textDecoration: "underline", textUnderlineOffset: 3 }}>
          ← Back to maintenance
        </button>
        <div style={{ marginTop: 18, padding: 32, textAlign: "center", color: "var(--fg-muted)",
          background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
          Unknown unit "{unitId}". The dashboard doesn't have this vehicle on file.
        </div>
      </div>
    );
  }

  // Upcoming items: schedule rules expanded for this unit, plus this
  // vehicle's three compliance expiries (CVIP / registration / insurance).
  const dueItems = useMemoVM(() => {
    const items = [];
    const maint = (typeof D.maintenanceDueList === "function") ? D.maintenanceDueList() : [];
    for (const m of maint) {
      if (m.unit !== unitId) continue;
      const days = m.due_date ? D.daysUntil(m.due_date) : null;
      items.push({
        kind: "maintenance",
        item: m.item,
        priority: m.priority || "routine",
        interval: m.interval_type === "date" ? `every ${m.interval_days} days`
                : m.interval_type === "km"   ? `every ${(m.interval_km || 0).toLocaleString()} km`
                : "",
        date: m.due_date || "",
        days,
        statusRaw: m.status,
        lastDate: m.last_log ? m.last_log.date : "",
        lastOdometer: m.last_log ? m.last_log.odometer_km : null,
      });
    }
    const vm = D.vehicleMeta ? D.vehicleMeta(unitId) : {};
    const expiryFields = [
      { kind: "CVIP",         date: vm.cvip_expires },
      { kind: "Registration", date: vm.registration_expires },
      { kind: "Insurance",    date: vm.insurance_expires },
    ];
    for (const f of expiryFields) {
      if (!f.date) continue;
      const days = D.daysUntil(f.date);
      items.push({
        kind: "expiry",
        item: f.kind,
        priority: f.kind === "CVIP" ? "critical" : "routine",
        interval: "annual",
        date: f.date,
        days,
        statusRaw: days == null ? "unknown" : days < 0 ? "overdue" : days <= 30 ? "due-soon" : "ok",
      });
    }
    items.sort((a, b) => {
      if (a.days == null && b.days == null) return 0;
      if (a.days == null) return 1;
      if (b.days == null) return -1;
      return a.days - b.days;
    });
    return items;
  }, [unitId]);

  // Open defects, filtered to this unit.
  const defects = useMemoVM(() => {
    const all = (typeof D.openDefects === "function") ? D.openDefects() : [];
    return all.filter(d => d.unit === unitId);
  }, [unitId]);

  // Full service history for this unit (no filter yet, newest first).
  const fullLog = useMemoVM(() => {
    return ((D.MAINTENANCE && D.MAINTENANCE.log) || [])
      .filter(e => e.unit === unitId)
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [unitId]);

  // History scope cutoff.
  const filteredLog = useMemoVM(() => {
    if (historyFilter === "all") return fullLog;
    const d = new Date();
    if (historyFilter === "12m") d.setFullYear(d.getFullYear() - 1);
    else if (historyFilter === "5y") d.setFullYear(d.getFullYear() - 5);
    const cutoff = d.toISOString().slice(0, 10);
    return fullLog.filter(e => (e.date || "") >= cutoff);
  }, [fullLog, historyFilter]);

  // KPI counters.
  const cOverdue = dueItems.filter(i => i.days != null && i.days < 0).length;
  const cDue30   = dueItems.filter(i => i.days != null && i.days >= 0 && i.days <= 30).length;
  const cDefects = defects.length;
  const cLog     = fullLog.length;

  // Latest known odometer from Titan trips for this unit. Falls back to
  // a placeholder so the header doesn't look broken on units without GPS.
  const lastTitan = useMemoVM(() => {
    const tt = (D.TRIPS || []).filter(t => t.unit === unitId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.start_min - a.start_min);
    return tt[0] || null;
  }, [unitId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--bg)" }}>

      {/* Hero: identity + KPI row */}
      <div style={{ background: "var(--navy-900)", color: "#fff", padding: "22px 0", borderBottom: "1px solid var(--navy-950)" }}>
        <div style={{ maxWidth: 1480, margin: "0 auto", padding: "0 24px", boxSizing: "border-box" }}>

          {/* Top nav row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <button onClick={onBack}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer",
                font: "13px var(--font-sans)", color: "rgba(255,255,255,0.85)",
                textDecoration: "underline", textUnderlineOffset: 3 }}>
              ← Back to maintenance
            </button>
            {typeof onOpenUnit === "function" && (
              <button onClick={() => onOpenUnit(unitId)}
                style={{ background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.18)", borderRadius: 4,
                  padding: "6px 12px", cursor: "pointer",
                  font: "12px var(--font-sans)", color: "#fff" }}>
                Open vehicle profile →
              </button>
            )}
          </div>

          {/* Identity */}
          <div style={{ font: "600 10.5px/1 var(--font-sans)", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
            Vehicle maintenance · {unit.klass === "heavy" ? "NSC time-record" : "Light vehicle"}
          </div>
          <div style={{ font: "700 34px/1.05 var(--font-display)", color: "#fff", letterSpacing: "-0.015em", marginTop: 8 }}>
            {unit.id}
          </div>
          <div style={{ font: "13px/1.4 var(--font-sans)", color: "rgba(255,255,255,0.75)", marginTop: 6 }}>
            {unit.year} {unit.make} {unit.model}
            {unit.gvw_kg ? ` · GVW ${unit.gvw_kg.toLocaleString()} kg` : ""}
            {unit.driver ? ` · Driver: ${unit.driver}` : ""}
            {lastTitan && lastTitan.date ? ` · Last seen ${lastTitan.date}` : ""}
          </div>

          {/* KPI row */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4 }}>
              <HeroCounterVM label="Overdue"        value={cOverdue} sub="Past expiry / due date"   tone={cOverdue ? "accent" : "muted"} />
              <HeroCounterVM label="Due in 30 days" value={cDue30}   sub="Action this month"        tone={cDue30   ? "accent" : "ok"} divider />
              <HeroCounterVM label="Open defects"   value={cDefects} sub="Reported on pre-trip"     tone={cDefects ? "accent" : "muted"} divider />
              <HeroCounterVM label="Service log"    value={cLog}     sub="Lifetime entries on file" tone="muted" divider />
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px 32px", maxWidth: 1480, margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 22 }}>

        {/* Upcoming maintenance & compliance */}
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%",
              background: cOverdue ? "var(--accent-500)" : "var(--navy-600)", display: "inline-block" }} />
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--navy-900)" }}>Upcoming maintenance &amp; compliance</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
              Compliance expiries + scheduled service, sorted by urgency
            </div>
            <div style={{ marginLeft: "auto", font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
              {dueItems.length} item{dueItems.length === 1 ? "" : "s"}
            </div>
          </div>
          <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
            {dueItems.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
                No upcoming items on file for {unit.id}.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
                <thead>
                  <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                    {["Type", "Item", "Interval", "Due", "Days", "Status"].map(h => (
                      <th key={h} style={vmThStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dueItems.map((r, i) => {
                    const tone = r.statusRaw === "overdue"   ? "accent"
                               : r.statusRaw === "due-soon"  ? "warn"
                               : r.statusRaw === "ok"        ? "ok"
                               : "neutral";
                    const label = r.days == null ? ""
                                : r.days < 0  ? `Overdue by ${Math.abs(r.days)} days`
                                : r.days === 0 ? "Due today"
                                : `${r.days} day${r.days === 1 ? "" : "s"} remaining`;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{
                            font: "600 10px var(--font-sans)", letterSpacing: "0.1em", textTransform: "uppercase",
                            padding: "2px 6px", borderRadius: 2,
                            background: r.kind === "maintenance" ? "#E8EEF6" : "#EAF3EE",
                            color: r.kind === "maintenance" ? "var(--navy-800)" : "var(--ok)",
                          }}>{r.kind === "maintenance" ? "Maint" : "Expiry"}</span>
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 500, color: "var(--navy-900)" }}>{r.item}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", color: "var(--fg-subtle)" }}>{r.interval}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>{r.date}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontWeight: 600,
                          color: tone === "accent" || tone === "warn" ? "var(--accent-700)" : "var(--navy-900)" }}>
                          {r.days != null ? (r.days < 0 ? `${r.days}` : `+${r.days}`) : ""}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <Pill tone={tone}>{label}</Pill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Open defects */}
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%",
              background: cDefects ? "var(--accent-500)" : "var(--navy-600)", display: "inline-block" }} />
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--navy-900)" }}>Open defects</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
              Issues flagged on this unit's pre-trips that haven't been closed
            </div>
            <div style={{ marginLeft: "auto", font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
              {defects.length} item{defects.length === 1 ? "" : "s"}
            </div>
          </div>
          <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
            {defects.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
                No open defects on {unit.id}.
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
                <thead>
                  <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                    {["Defect", "First reported", "Last seen", "Open", "Reports", "Drivers"].map(h => (
                      <th key={h} style={vmThStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {defects.map((d, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                      <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.5, color: "var(--navy-900)" }}>
                        {d.text}
                      </td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", verticalAlign: "top" }}>{d.first_reported || ""}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", verticalAlign: "top" }}>{d.last_seen || ""}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", verticalAlign: "top", fontWeight: 600,
                        color: d.days_open != null && d.days_open >= 14 ? "var(--accent-700)" : "var(--navy-900)" }}>
                        {d.days_open != null ? `${d.days_open}d` : ""}
                      </td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", verticalAlign: "top" }}>{d.occurrences}</td>
                      <td style={{ padding: "10px 14px", color: "var(--fg-subtle)", verticalAlign: "top", whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.5 }}>
                        {(d.drivers || []).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
            Manage defect closures from the main Maintenance section's Open defects tab.
          </div>
        </section>

        {/* Service history */}
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--navy-600)", display: "inline-block" }} />
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--navy-900)" }}>Service history</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
              Maintenance log entries logged against {unit.id}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
              <Segmented value={historyFilter} onChange={setHistoryFilter} options={[
                { v: "12m", label: "Last 12 months" },
                { v: "5y",  label: "Last 5 years" },
                { v: "all", label: "All time" },
              ]} />
              <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
                {filteredLog.length} of {fullLog.length}
              </div>
            </div>
          </div>
          <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
            {fullLog.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
                No service history on file for {unit.id} yet. Add entries to <code style={{ background: "var(--steel-50)", padding: "2px 6px", borderRadius: 2, font: "12px var(--font-mono)" }}>maintenance.json</code> as work is performed.
              </div>
            ) : filteredLog.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
                No entries in this window. <button onClick={() => setHistoryFilter("all")}
                  style={{ background: "none", border: "none", color: "var(--navy-700)", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0 }}>
                  Show all time
                </button>
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)", tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 110 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 180 }} />
                  <col />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                    {["Date", "Item", "Odometer", "Performed by", "Notes"].map(h => (
                      <th key={h} style={vmThStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLog.map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", verticalAlign: "top" }}>{e.date || ""}</td>
                      <td style={{ padding: "10px 14px", verticalAlign: "top", color: "var(--navy-900)", fontWeight: 500 }}>{e.item || ""}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", verticalAlign: "top" }}>{e.odometer_km != null ? e.odometer_km.toLocaleString() : ""}</td>
                      <td style={{ padding: "10px 14px", verticalAlign: "top" }}>{e.performer || ""}</td>
                      <td style={{ padding: "10px 14px", color: "var(--fg-subtle)", verticalAlign: "top", whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.5 }}>{e.notes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

      </div>
    </div>
  );
};

const vmThStyle = {
  textAlign: "left",
  padding: "10px 14px",
  font: "600 10px var(--font-sans)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--fg-muted)",
};

function HeroCounterVM({ label, value, sub, tone = "muted", divider }) {
  const tones = { muted: "#fff", ok: "#7DD3A8", accent: "var(--accent-500)" };
  return (
    <div style={{ padding: "14px 18px", borderLeft: divider ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
      <div style={{ font: "600 10px/1 var(--font-sans)", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{label}</div>
      <div style={{ font: "700 30px/1.05 var(--font-display)", color: tones[tone], marginTop: 8, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ font: "11.5px/1.3 var(--font-sans)", color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

window.VehicleMaintenanceDetail = VehicleMaintenanceDetail;
