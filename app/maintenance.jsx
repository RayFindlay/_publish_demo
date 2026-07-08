// Maintenance screen - unified view of schedule + log + compliance
// expiries (CVIP, registration, insurance, licence, medical, abstract).
// All "what's due" type information rolls up here.

const { useState: useStateM, useMemo: useMemoM } = React;

// `unitId` (optional) selects the per-vehicle deep view. Provided by
// app.jsx route state ({name:"maintenance", unitId:"FDT12"}). When set,
// the tab body is replaced by <VehicleMaintenanceDetail>. `onExitDeepView`
// returns to the plain maintenance section.
const Maintenance = ({ onOpenUnit, onOpenDriver, unitId, onExitDeepView, onOpenDeepView }) => {
  const D = window.NORFAB_DATA;
  const [tab, setTab] = useStateM("vehicles"); // vehicles | due | defects | log
  const [showSchedule, setShowSchedule] = useStateM(false);
  const [scope, setScope] = useStateM("60"); // 30 | 60 | 90 | all
  const [logSort, setLogSort] = useStateM({ key: "date", dir: "desc" });
  const [logUnit, setLogUnit] = useStateM("all");
  const [logItem, setLogItem] = useStateM("all");
  const [logTime, setLogTime] = useStateM("12m"); // 12m | 5y | all
  const [detailDefect, setDetailDefect] = useStateM(null); // defect object being viewed
  const [detailReportIdx, setDetailReportIdx] = useStateM(0); // which DVI's PDF to show
  const [closeDefect, setCloseDefect] = useStateM(null); // defect object being closed
  const [closeForm, setCloseForm] = useStateM({ text_match: "", resolved_date: "", notes: "" });
  const [closeFeedback, setCloseFeedback] = useStateM(""); // copy-to-clipboard confirmation

  // ---- Due items: schedule + expiries, unified ----
  const dueItems = useMemoM(() => {
    const items = [];

    // Maintenance schedule items
    const maint = (typeof D.maintenanceDueList === "function") ? D.maintenanceDueList() : [];
    for (const m of maint) {
      const days = m.due_date ? D.daysUntil(m.due_date) : null;
      items.push({
        kind: "maintenance",
        subjectKind: "vehicle",
        subjectId: m.unit,
        subjectLabel: m.unit,
        recordType: m.item,
        priority: m.priority || "routine",
        interval: m.interval_type === "date" ? `every ${m.interval_days}d`
                : m.interval_type === "km"   ? `every ${(m.interval_km || 0).toLocaleString()} km`
                : "",
        date: m.due_date || "",
        days,
        lastDate: m.last_log ? m.last_log.date : "",
        lastOdometer: m.last_log ? m.last_log.odometer_km : null,
        statusRaw: m.status,
      });
    }

    // Vehicle expiries from fleet-meta
    for (const u of D.UNITS) {
      const vm = D.vehicleMeta ? D.vehicleMeta(u.id) : {};
      const fields = [
        { kind: "CVIP",          date: vm.cvip_expires },
        { kind: "Registration",  date: vm.registration_expires },
        { kind: "Insurance",     date: vm.insurance_expires },
      ];
      for (const f of fields) {
        if (!f.date) continue;
        const days = D.daysUntil(f.date);
        items.push({
          kind: "expiry",
          subjectKind: "vehicle",
          subjectId: u.id,
          subjectLabel: u.id,
          recordType: f.kind,
          priority: f.kind === "CVIP" ? "critical" : "routine",
          interval: "annual",
          date: f.date,
          days,
          statusRaw: days == null ? "unknown" : days < 0 ? "overdue" : days <= 30 ? "due-soon" : "ok",
        });
      }
    }

    // Driver licence / medical / abstract expiries intentionally NOT
    // computed here. Those are managed by admin downstairs (the docs
    // themselves are private). The dashboard's Maintenance section
    // stays vehicle-only; driver expiries surface elsewhere (Expiries
    // section) when we need to track renewal cadence.

    return items;
  }, []);

  // Bucket items: Overdue / Vehicles upcoming / Drivers upcoming
  const isOverdue = (i) => i.date && i.days != null && i.days < 0 && !i.isObtainedDate;
  const passesScope = (i) => {
    if (isOverdue(i)) return false; // overdue handled in its own section
    if (i.statusRaw === "no-history") return scope === "all";
    if (!i.date) return scope === "all";
    if (i.isObtainedDate) return scope === "all"; // abstracts are obtained-dates, not expiries
    if (scope === "all") return true;
    const n = parseInt(scope, 10);
    return i.days != null && i.days >= 0 && i.days <= n;
  };
  const byDays = (a, b) => {
    if (a.days == null && b.days == null) return 0;
    if (a.days == null) return 1;
    if (b.days == null) return -1;
    return a.days - b.days;
  };

  const overdueItems    = dueItems.filter(isOverdue).sort(byDays);
  const vehicleUpcoming = dueItems.filter(i => i.subjectKind === "vehicle" && passesScope(i)).sort(byDays);

  // KPI counts (unfiltered, scopeless)
  const cOverdue = dueItems.filter(i => i.date && i.days != null && i.days < 0 && !i.isObtainedDate).length;
  const c30 = dueItems.filter(i => i.date && i.days != null && i.days >= 0 && i.days <= 30 && !i.isObtainedDate).length;
  const c60 = dueItems.filter(i => i.date && i.days != null && i.days >= 0 && i.days <= 60 && !i.isObtainedDate).length;

  // Missing-date breakdown straight from fleet-meta. Counts the vehicles
  // that have no CVIP / registration / insurance expiry on file. We do
  // not derive these from the maintenance log here — that's a separate
  // signal in "Coming up". A blank field in fleet-meta means we don't
  // know when the document expires, which is the gap worth flagging.
  const missingByField = useMemoM(() => {
    const out = { cvip: [], registration: [], insurance: [] };
    for (const u of (D.UNITS || [])) {
      const vm = D.vehicleMeta ? D.vehicleMeta(u.id) : {};
      if (!vm.cvip_expires)         out.cvip.push(u.id);
      if (!vm.registration_expires) out.registration.push(u.id);
      if (!vm.insurance_expires)    out.insurance.push(u.id);
    }
    return out;
  }, []);
  const cMissingTotal = missingByField.cvip.length + missingByField.registration.length + missingByField.insurance.length;

  // Log, sorted by current column header selection (default date desc)
  const log = useMemoM(() => {
    const entries = ((D.MAINTENANCE && D.MAINTENANCE.log) || []).slice();
    const k = logSort.key;
    const dir = logSort.dir === "asc" ? 1 : -1;
    entries.sort((a, b) => {
      const av = a[k];
      const bv = b[k];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;  // nulls always sort last regardless of dir
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return entries;
  }, [logSort.key, logSort.dir]);

  const toggleLogSort = (key) => {
    setLogSort(prev => prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "date" ? "desc" : "asc" });
  };

  // Log filters
  const itemBucket = (item) => {
    if (!item) return "other";
    const i = String(item).toLowerCase();
    if (i.includes("cvip")) return "cvip";
    if (i.includes("oil change")) return "oil";
    if (i.includes("tire rotation") || i.includes("brake inspection")
        || i.includes("air brake") || i.includes("transmission service")) return "service";
    return "repair";
  };
  const logCutoff = (() => {
    if (logTime === "all") return null;
    const d = new Date();
    if (logTime === "12m") d.setFullYear(d.getFullYear() - 1);
    else if (logTime === "5y") d.setFullYear(d.getFullYear() - 5);
    return d.toISOString().slice(0, 10);
  })();
  const filteredLog = log.filter(e => {
    if (logUnit !== "all" && e.unit !== logUnit) return false;
    if (logItem !== "all" && itemBucket(e.item) !== logItem) return false;
    if (logCutoff && (e.date || "") < logCutoff) return false;
    return true;
  });
  const logUnitOptions = (() => {
    const set = new Set();
    for (const e of ((D.MAINTENANCE && D.MAINTENANCE.log) || [])) {
      if (e.unit) set.add(e.unit);
    }
    return Array.from(set).sort();
  })();
  const logFiltersActive = logUnit !== "all" || logItem !== "all" || logTime !== "12m";
  const resetLogFilters = () => { setLogUnit("all"); setLogItem("all"); setLogTime("12m"); };

  // Schedule rules (raw, for the Schedule tab)
  const schedule = (D.MAINTENANCE && D.MAINTENANCE.schedule) || [];

  // Open driver-reported defects (computed; takes manual closures into account)
  const defects = (typeof D.openDefects === "function") ? D.openDefects() : [];

  // Per-vehicle summary cards for the By vehicle tab. One row per unit
  // in D.UNITS with counts + the next-up item, sorted so the vehicles
  // that need attention bubble to the top.
  const vehicleSummaries = useMemoM(() => {
    const maint = (typeof D.maintenanceDueList === "function") ? D.maintenanceDueList() : [];
    const log = (D.MAINTENANCE && D.MAINTENANCE.log) || [];
    return (D.UNITS || []).map(u => {
      const vm = D.vehicleMeta ? D.vehicleMeta(u.id) : {};

      // Combine schedule items + compliance expiries for this unit.
      const scheduleItems = maint
        .filter(m => m.unit === u.id && m.due_date)
        .map(m => ({ label: m.item, date: m.due_date, days: D.daysUntil(m.due_date), kind: "maintenance" }));
      const expiryItems = [
        { kind: "CVIP",         date: vm.cvip_expires },
        { kind: "Registration", date: vm.registration_expires },
        { kind: "Insurance",    date: vm.insurance_expires },
      ].filter(e => e.date).map(e => ({ label: e.kind, date: e.date, days: D.daysUntil(e.date), kind: "expiry" }));
      const allDue = [...scheduleItems, ...expiryItems];

      const overdue = allDue.filter(d => d.days != null && d.days < 0);
      const due30   = allDue.filter(d => d.days != null && d.days >= 0 && d.days <= 30);
      const defectCount = (typeof D.defectCountForUnit === "function") ? D.defectCountForUnit(u.id) : 0;

      const unitLog = log.filter(e => e.unit === u.id);
      const lastService = unitLog.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || null;

      const nextUp = allDue.slice().sort((a, b) => {
        if (a.days == null && b.days == null) return 0;
        if (a.days == null) return 1;
        if (b.days == null) return -1;
        return a.days - b.days;
      })[0] || null;

      // Sort key: lower = higher in list. Overdue dominates, then due-soon,
      // then any open defect lifts the card above clean ones.
      let sortKey = 0;
      if (overdue.length > 0) {
        const mostOverdue = Math.min(...overdue.map(o => o.days));
        sortKey = -1000000 - overdue.length * 1000 + mostOverdue;  // mostOverdue is negative
      } else if (due30.length > 0) {
        sortKey = -10000 + (nextUp && nextUp.days != null ? nextUp.days : 0);
      } else if (defectCount > 0) {
        sortKey = -100 - defectCount;
      } else {
        sortKey = nextUp && nextUp.days != null ? nextUp.days : 99999;
      }

      const tone = overdue.length > 0 ? "accent"
                 : due30.length   > 0 ? "warn"
                 : defectCount    > 0 ? "warn"
                 : "ok";

      return {
        unit: u,
        overdueCount: overdue.length,
        due30Count: due30.length,
        defectCount,
        logCount: unitLog.length,
        lastService,
        nextUp,
        tone,
        sortKey,
      };
    }).sort((a, b) => a.sortKey - b.sortKey);
  }, []);

  // Deep view takes over the whole Maintenance section when a unit is
  // selected via "See all" or the future By-vehicle landing tab.
  if (unitId && window.VehicleMaintenanceDetail) {
    return (
      <window.VehicleMaintenanceDetail
        unitId={unitId}
        onBack={onExitDeepView}
        onOpenUnit={onOpenUnit}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Hero */}
      <div style={{ background: "var(--navy-900)", color: "#fff", padding: "22px 0", borderBottom: "1px solid var(--navy-950)" }}>
        <div style={{ maxWidth: 1480, margin: "0 auto", padding: "0 24px", boxSizing: "border-box" }}>
          <div style={{ font: "600 10.5px/1 var(--font-sans)", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
            Maintenance &amp; compliance
          </div>
          <div style={{ font: "700 34px/1.05 var(--font-display)", color: "#fff", letterSpacing: "-0.015em", marginTop: 8 }}>
            {cOverdue > 0
              ? <><span style={{ color: "var(--accent-500)" }}>{cOverdue}</span> overdue. <span style={{ color: "rgba(255,255,255,0.6)" }}>{c30} due in 30 days.</span></>
              : <>{c30} compliance item{c30 === 1 ? "" : "s"} due in 30 days.</>}
          </div>
          <div style={{ font: "13px/1.4 var(--font-sans)", color: "rgba(255,255,255,0.7)", marginTop: 8 }}>
            Per-vehicle history, what's due, open defects, and the service log. Edit maintenance.json and fleet-meta.json to update.
          </div>

          <div style={{ marginTop: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4 }}>
              <HeroCounterM label="Overdue" value={cOverdue} sub="Past expiry / due date" tone={cOverdue ? "accent" : "muted"} />
              <HeroCounterM label="Due in 30 days" value={c30} sub="Action this month" tone={c30 ? "accent" : "ok"} divider />
              <HeroCounterM label="Due in 60 days" value={c60} sub="Plan ahead" tone="muted" divider />
              <HeroCounterM label="Recently serviced" value={log.length} sub="Log entries on file" tone="muted" divider />
            </div>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ background: "var(--white)", borderBottom: "1px solid var(--border)", padding: "0 24px", display: "flex", gap: 4 }}>
        {[
          { id: "vehicles", label: "By vehicle" },
          { id: "due", label: "Timeline" },
          { id: "defects", label: `Open defects${defects.length ? ` (${defects.length})` : ""}` },
        ].map(t => {
          const isActive = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: "transparent", border: "none",
              padding: "12px 16px 10px",
              borderBottom: isActive ? "2px solid var(--accent-500)" : "2px solid transparent",
              color: isActive ? "var(--navy-900)" : "var(--fg-muted)",
              font: isActive ? "600 13px var(--font-sans)" : "500 13px var(--font-sans)",
              cursor: "pointer",
            }}>{t.label}</button>
          );
        })}
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px 32px", maxWidth: 1480, margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 18 }}>

        {tab === "vehicles" && (
          <>
            <div style={{ font: "13px/1.5 var(--font-sans)", color: "var(--fg-muted)" }}>
              One card per vehicle, ordered by what needs attention first. Click a card to open that vehicle's full maintenance history.
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 14,
            }}>
              {vehicleSummaries.map(v => (
                <VehicleSummaryCard
                  key={v.unit.id}
                  summary={v}
                  onClick={() => {
                    if (typeof onOpenDeepView === "function") onOpenDeepView(v.unit.id);
                  }}
                />
              ))}
            </div>
          </>
        )}

        {tab === "due" && (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)", marginRight: 6 }}>Upcoming window:</span>
              <Segmented value={scope} onChange={setScope} options={[
                { v: "30", label: "Next 30 days" },
                { v: "60", label: "Next 60 days" },
                { v: "90", label: "Next 90 days" },
                { v: "all", label: "All with dates" },
              ]} />
              <div style={{ marginLeft: "auto", font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
                {overdueItems.length + vehicleUpcoming.length} item{(overdueItems.length + vehicleUpcoming.length) === 1 ? "" : "s"}
              </div>
            </div>

            {/* Critical / overdue - only render when populated (empty is good) */}
            {overdueItems.length > 0 && (
              <DueSection
                title="Critical / overdue"
                subtitle="Past due. Address immediately."
                tone="accent"
                count={overdueItems.length}>
                <DueTable items={overdueItems}
                  columns={["Type", "Subject", "Item", "Due", "Days overdue"]}
                  onOpenUnit={onOpenUnit}
                  onOpenDriver={onOpenDriver}
                  showTypePill={true} />
              </DueSection>
            )}

            {/* Coming up (CVIP, registration, insurance, scheduled maintenance) */}
            <DueSection
              title="Coming up"
              subtitle="CVIP, registration, insurance, scheduled maintenance"
              count={vehicleUpcoming.length}>
              {vehicleUpcoming.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
                  Nothing in this window.
                </div>
              ) : (
                <DueTable items={vehicleUpcoming}
                  columns={["Unit", "Item", "Due", "Days", "Status"]}
                  onOpenUnit={onOpenUnit}
                  onOpenDriver={onOpenDriver}
                  showTypePill={false}
                  subjectColumn="vehicle" />
              )}
            </DueSection>

            {cMissingTotal > 0 && (
              <div style={{ padding: 14, background: "var(--steel-50)", border: "1px solid var(--rule)", borderRadius: 4, font: "12px/1.6 var(--font-sans)", color: "var(--fg-subtle)" }}>
                <div style={{ fontWeight: 600, color: "var(--navy-900)", marginBottom: 4 }}>
                  Compliance dates not yet on file in fleet-meta.json:
                </div>
                {missingByField.cvip.length > 0 && (
                  <div>· CVIP expiry missing for {missingByField.cvip.length} vehicle{missingByField.cvip.length === 1 ? "" : "s"} ({missingByField.cvip.join(", ")})</div>
                )}
                {missingByField.registration.length > 0 && (
                  <div>· Registration expiry missing for {missingByField.registration.length} vehicle{missingByField.registration.length === 1 ? "" : "s"} ({missingByField.registration.join(", ")})</div>
                )}
                {missingByField.insurance.length > 0 && (
                  <div>· Insurance expiry missing for {missingByField.insurance.length} vehicle{missingByField.insurance.length === 1 ? "" : "s"} ({missingByField.insurance.join(", ")})</div>
                )}
                <div style={{ marginTop: 6, color: "var(--fg-muted)" }}>
                  CVIP next-due is also computed from the maintenance log (Coming up section above), so the CVIP gap here is informational. Registration and insurance only surface when a date is filled in.
                </div>
              </div>
            )}

            {/* Recent history (formerly the standalone Maintenance log tab).
                Lives at the bottom of the Timeline so the upcoming view and
                the past view sit on the same page. */}
            <section style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--navy-600)", display: "inline-block" }} />
                <div style={{ font: "600 14px var(--font-sans)", color: "var(--navy-900)" }}>Recent history</div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
                  Logged service, repairs, and CVIP events across the fleet
                </div>
              </div>

              {/* Filter strip */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <select value={logUnit} onChange={(ev) => setLogUnit(ev.target.value)}
                  style={{
                    font: "13px var(--font-sans)", padding: "6px 28px 6px 10px",
                    border: "1px solid var(--rule)", borderRadius: 4, background: "var(--white)",
                    color: "var(--navy-900)", cursor: "pointer",
                  }}>
                  <option value="all">All units</option>
                  {logUnitOptions.map(u => <option key={u} value={u}>{u}</option>)}
                </select>

                <Segmented value={logTime} onChange={setLogTime} options={[
                  { v: "12m", label: "Last 12 months" },
                  { v: "5y", label: "Last 5 years" },
                  { v: "all", label: "All time" },
                ]} />

                <Segmented value={logItem} onChange={setLogItem} options={[
                  { v: "all", label: "All" },
                  { v: "cvip", label: "CVIP" },
                  { v: "service", label: "Service" },
                  { v: "oil", label: "Oil change" },
                  { v: "repair", label: "Repairs" },
                ]} />

                <div style={{ marginLeft: "auto", font: "12px var(--font-sans)", color: "var(--fg-muted)", display: "inline-flex", gap: 10, alignItems: "center" }}>
                  <span>{filteredLog.length} of {log.length} entries</span>
                  {logFiltersActive && (
                    <button onClick={resetLogFilters}
                      style={{ background: "none", border: "none", color: "var(--navy-700)", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0 }}>
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {/* Table */}
              <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
                {log.length === 0 ? (
                  <div style={{ padding: 48, textAlign: "center", color: "var(--fg-muted)" }}>
                    No maintenance log entries on file yet. Add entries to <code style={{ background: "var(--steel-50)", padding: "2px 6px", borderRadius: 2, font: "12px var(--font-mono)" }}>maintenance.json</code> as work is performed.
                  </div>
                ) : filteredLog.length === 0 ? (
                  <div style={{ padding: 48, textAlign: "center", color: "var(--fg-muted)" }}>
                    No entries match these filters. <button onClick={resetLogFilters}
                      style={{ background: "none", border: "none", color: "var(--navy-700)", cursor: "pointer", textDecoration: "underline", font: "inherit", padding: 0 }}>Reset filters</button>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)", tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: 110 }} />
                      <col style={{ width: 80 }} />
                      <col style={{ width: 180 }} />
                      <col style={{ width: 110 }} />
                      <col style={{ width: 180 }} />
                      <col />
                    </colgroup>
                    <thead>
                      <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                        <SortHeader k="date" label="Date" sort={logSort} onToggle={toggleLogSort} />
                        <SortHeader k="unit" label="Unit" sort={logSort} onToggle={toggleLogSort} />
                        <SortHeader k="item" label="Item" sort={logSort} onToggle={toggleLogSort} />
                        <SortHeader k="odometer_km" label="Odometer" sort={logSort} onToggle={toggleLogSort} align="left" />
                        <SortHeader k="performer" label="Performed by" sort={logSort} onToggle={toggleLogSort} />
                        <th style={thStyleStatic}>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLog.map((e, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                          <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", verticalAlign: "top" }}>{e.date || ""}</td>
                          <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontWeight: 600, verticalAlign: "top" }}>
                            <button
                              onClick={() => { if (typeof onOpenDeepView === "function") onOpenDeepView(e.unit); }}
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--navy-700)", textDecoration: "underline", textUnderlineOffset: 2, font: "inherit", fontWeight: 600 }}
                              title={`Open ${e.unit}'s maintenance history`}>
                              {e.unit}
                            </button>
                          </td>
                          <td style={{ padding: "10px 14px", verticalAlign: "top" }}>{e.item}</td>
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
          </>
        )}

        {tab === "defects" && (
          <>
            <div style={{ font: "13px/1.5 var(--font-sans)", color: "var(--fg-muted)" }}>
              Issues drivers flagged in the Remarks field of their pre-trip inspection (SiteDocs DVI). Click a row to view the source pre-trip and any photo the driver attached. Click Close to mark a defect resolved.
            </div>

            <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
              {defects.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--fg-muted)" }}>
                  No open defects. Either no drivers have flagged anything on pre-trip, or all reported defects have a matching closure in <code style={{ background: "var(--steel-50)", padding: "2px 6px", borderRadius: 2, font: "12px var(--font-mono)" }}>defects_resolved</code>.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: 80 }} />
                    <col />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 75 }} />
                    <col style={{ width: 160 }} />
                    <col style={{ width: 90 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                      {["Unit", "Defect", "First reported", "Last seen", "Open", "Reports", "Drivers", ""].map((h, hi) => (
                        <th key={hi} style={thStyleStatic}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {defects.map((d, i) => (
                      <tr key={i}
                          onClick={() => { setDetailDefect(d); setDetailReportIdx(0); }}
                          style={{ borderBottom: "1px solid var(--rule)", cursor: "pointer" }}
                          title="Click to view the source pre-trip">
                        <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontWeight: 600, verticalAlign: "top" }}>
                          <button
                            onClick={(ev) => { ev.stopPropagation(); onOpenUnit(d.unit); }}
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--navy-700)", textDecoration: "underline", textUnderlineOffset: 2, font: "inherit", fontWeight: 600 }}
                            title={`Open ${d.unit} details`}>
                            {d.unit}
                          </button>
                        </td>
                        <td style={{ padding: "10px 14px", verticalAlign: "top", whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.5 }}>
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
                        <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation();
                              const today = (typeof D.localTodayISO === "function") ? D.localTodayISO() : new Date().toISOString().slice(0, 10);
                              setCloseDefect(d);
                              setCloseForm({ text_match: d.text, resolved_date: today, notes: "" });
                              setCloseFeedback("");
                            }}
                            style={{
                              background: "var(--white)", border: "1px solid var(--rule)",
                              padding: "5px 10px", borderRadius: 3, cursor: "pointer",
                              font: "600 11px var(--font-sans)", color: "var(--navy-800)",
                              letterSpacing: "0.04em",
                            }}
                            title="Mark this defect resolved">
                            Close
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* Footer link: schedule rules (collapsed by default) */}
        <div style={{ marginTop: 12, paddingTop: 14, borderTop: "1px solid var(--rule)" }}>
          <button
            onClick={() => setShowSchedule(s => !s)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              font: "13px var(--font-sans)", color: "var(--navy-700)",
              textDecoration: "underline", textUnderlineOffset: 3,
            }}
            title="Show or hide the maintenance schedule rules table">
            {showSchedule ? "Hide schedule rules" : "View / edit schedule rules"}
          </button>
          <span style={{ marginLeft: 10, font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
            {schedule.length} rule{schedule.length === 1 ? "" : "s"} defined
          </span>

          {showSchedule && (
            <div style={{ marginTop: 12, background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
              {schedule.length === 0 ? (
                <div style={{ padding: 48, textAlign: "center", color: "var(--fg-muted)" }}>
                  No schedule rules defined.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
                  <thead>
                    <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                      {["Applies to", "Item", "Interval", "Priority", "Notes"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 14px", font: "600 10px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((r, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                        <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>{r.unit}</td>
                        <td style={{ padding: "10px 14px", fontWeight: 500 }}>{r.item}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>
                          {r.interval_type === "date"
                            ? <>every {r.interval_days}<EditMark /> days</>
                           : r.interval_type === "km"
                            ? <>every {(r.interval_km || 0).toLocaleString()}<EditMark /> km</>
                           : ""}
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          <Pill tone={r.priority === "critical" ? "warn" : "neutral"}>{r.priority || "routine"}</Pill>
                          <EditMark />
                        </td>
                        <td style={{ padding: "10px 14px", color: "var(--fg-subtle)" }}>{r.notes || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ padding: "12px 14px", borderTop: "1px solid var(--rule)", background: "var(--steel-50)", font: "12px/1.5 var(--font-sans)", color: "var(--fg-subtle)" }}>
                <span style={{ color: "var(--accent-700)", fontWeight: 600 }}>*</span> Values marked with an asterisk are configurable thresholds that have not yet been finalized. Final intervals and priorities may change as Cascade Freight calibrates the maintenance program. Edit <code style={{ background: "var(--white)", padding: "1px 5px", borderRadius: 2, font: "12px var(--font-mono)", border: "1px solid var(--rule)" }}>Apps/Cascade Freight_Fleet_Compliance/maintenance.json</code> in the repo to adjust.
              </div>
            </div>
          )}
        </div>
      </div>

      {detailDefect && (
        <DefectDetailModal
          defect={detailDefect}
          reportIdx={detailReportIdx}
          onPickReport={setDetailReportIdx}
          onClose={() => setDetailDefect(null)}
        />
      )}

      {closeDefect && (
        <DefectCloseModal
          defect={closeDefect}
          form={closeForm}
          setForm={setCloseForm}
          feedback={closeFeedback}
          setFeedback={setCloseFeedback}
          onCancel={() => { setCloseDefect(null); setCloseFeedback(""); }}
        />
      )}
    </div>
  );
};

// One vehicle card on the By vehicle landing tab. Click anywhere on
// the card to open that vehicle's full maintenance deep view.
function VehicleSummaryCard({ summary, onClick }) {
  const { unit, overdueCount, due30Count, defectCount, logCount, lastService, nextUp, tone } = summary;
  const borderColor = tone === "accent" ? "var(--accent-500)"
                    : tone === "warn"   ? "#E0A634"
                    : "var(--border)";
  const isClean = overdueCount === 0 && due30Count === 0 && defectCount === 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      style={{
        background: "var(--white)",
        border: "1px solid var(--border)",
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 4,
        padding: "14px 16px",
        cursor: "pointer",
        display: "flex", flexDirection: "column", gap: 10,
        transition: "box-shadow 120ms ease, transform 120ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(17,36,54,0.10)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
      title={`Open ${unit.id}'s maintenance history`}>

      {/* Identity row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "700 18px/1.1 var(--font-display)", color: "var(--navy-900)", letterSpacing: "-0.01em" }}>
            {unit.id}
          </div>
          <div style={{ font: "12px/1.4 var(--font-sans)", color: "var(--fg-muted)", marginTop: 2 }}>
            {unit.year} {unit.make} {unit.model}
            {unit.driver ? ` · ${unit.driver}` : ""}
          </div>
        </div>
        <span style={{
          font: "600 10px var(--font-sans)", letterSpacing: "0.1em", textTransform: "uppercase",
          padding: "2px 6px", borderRadius: 2,
          background: unit.klass === "heavy" ? "#FDECE3" : "#E8EEF6",
          color: unit.klass === "heavy" ? "var(--accent-700)" : "var(--navy-800)",
          whiteSpace: "nowrap",
        }}>
          {unit.klass === "heavy" ? "Heavy NSC" : "Light"}
        </span>
      </div>

      {/* KPI chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {overdueCount > 0 && (
          <SummaryChip tone="accent" label={`${overdueCount} overdue`} />
        )}
        {due30Count > 0 && (
          <SummaryChip tone="warn" label={`${due30Count} due in 30d`} />
        )}
        {defectCount > 0 && (
          <SummaryChip tone="warn" label={`${defectCount} open defect${defectCount === 1 ? "" : "s"}`} />
        )}
        {isClean && (
          <SummaryChip tone="ok" label="Up to date" />
        )}
      </div>

      {/* Next-up line */}
      <div style={{ font: "12px/1.4 var(--font-sans)", color: "var(--fg-subtle)" }}>
        {nextUp ? (
          <>
            <span style={{ color: "var(--fg-muted)" }}>Next: </span>
            <span style={{ color: "var(--navy-900)", fontWeight: 500 }}>{nextUp.label}</span>
            <span style={{ color: "var(--fg-muted)" }}> · {nextUp.date}</span>
            {nextUp.days != null && (
              <span style={{
                marginLeft: 6,
                color: nextUp.days < 0 ? "var(--accent-700)"
                     : nextUp.days <= 30 ? "var(--accent-700)"
                     : "var(--fg-muted)",
                fontWeight: nextUp.days < 30 ? 600 : 400,
              }}>
                ({nextUp.days < 0 ? `overdue ${Math.abs(nextUp.days)}d` : `${nextUp.days}d`})
              </span>
            )}
          </>
        ) : (
          <span>No upcoming items on file.</span>
        )}
      </div>

      {/* Footer: log stats */}
      <div style={{ marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--rule)",
        display: "flex", justifyContent: "space-between", font: "11.5px var(--font-sans)", color: "var(--fg-muted)" }}>
        <span>{logCount} log {logCount === 1 ? "entry" : "entries"}</span>
        <span>
          {lastService && lastService.date
            ? <>Last service <span style={{ fontFamily: "var(--font-mono)" }}>{lastService.date}</span></>
            : <>No service logged</>}
        </span>
      </div>
    </div>
  );
}

function SummaryChip({ tone, label }) {
  const tones = {
    accent: { bg: "#FDECE3", fg: "var(--accent-700)" },
    warn:   { bg: "#FFF4DD", fg: "#7A5210" },
    ok:     { bg: "#E6F4EC", fg: "var(--ok)" },
  };
  const t = tones[tone] || tones.warn;
  return (
    <span style={{
      font: "600 11px var(--font-sans)",
      padding: "3px 8px", borderRadius: 3,
      background: t.bg, color: t.fg,
      letterSpacing: "0.02em",
    }}>
      {label}
    </span>
  );
}

// Small asterisk marker beside user-editable values in the schedule rules
// table. Pairs with the footer legend explaining "values may change".
function EditMark() {
  return (
    <span
      title="Configurable threshold — final value may change"
      style={{ color: "var(--accent-700)", fontWeight: 600, marginLeft: 2 }}>
      *
    </span>
  );
}

function HeroCounterM({ label, value, sub, tone = "muted", divider }) {
  const tones = { muted: "#fff", ok: "#7DD3A8", accent: "var(--accent-500)" };
  return (
    <div style={{ padding: "14px 18px", borderLeft: divider ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
      <div style={{ font: "600 10px/1 var(--font-sans)", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{label}</div>
      <div style={{ font: "700 30px/1.05 var(--font-display)", color: tones[tone], marginTop: 8, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ font: "11.5px/1.3 var(--font-sans)", color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

const thStyleStatic = {
  textAlign: "left",
  padding: "10px 14px",
  font: "600 10px var(--font-sans)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--fg-muted)",
};

function SortHeader({ k, label, sort, onToggle }) {
  const active = sort.key === k;
  const arrow = active ? (sort.dir === "asc" ? "↑" : "↓") : "";
  return (
    <th style={thStyleStatic}>
      <button
        onClick={() => onToggle(k)}
        style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          font: "inherit", color: active ? "var(--navy-900)" : "var(--fg-muted)",
          letterSpacing: "inherit", textTransform: "inherit",
          display: "inline-flex", gap: 4, alignItems: "center",
        }}
        title={`Sort by ${label.toLowerCase()}`}>
        {label}
        <span style={{ font: "10px var(--font-sans)", opacity: active ? 1 : 0.35 }}>{arrow || "↕"}</span>
      </button>
    </th>
  );
}

function DueSection({ title, subtitle, count, tone = "neutral", children }) {
  const dotColor = tone === "accent" ? "var(--accent-500)" : "var(--navy-600)";
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, display: "inline-block" }} />
        <div style={{ font: "600 14px var(--font-sans)", color: "var(--navy-900)" }}>{title}</div>
        <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>{subtitle}</div>
        <div style={{ marginLeft: "auto", font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
          {count} item{count === 1 ? "" : "s"}
        </div>
      </div>
      <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
        {children}
      </div>
    </section>
  );
}

function DueTable({ items, columns, onOpenUnit, onOpenDriver, showTypePill, subjectColumn }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
      <thead>
        <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
          {columns.map(h => (
            <th key={h} style={thStyleStatic}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((r, i) => {
          const tone = r.statusRaw === "overdue" ? "accent"
                     : r.statusRaw === "due-soon" ? "warn"
                     : r.statusRaw === "ok" ? "ok"
                     : "neutral";
          const label = r.isObtainedDate ? "On file"
                      : r.days == null ? ""
                      : r.days < 0 ? `Overdue by ${Math.abs(r.days)} days`
                      : r.days === 0 ? "Due today"
                      : `${r.days} day${r.days === 1 ? "" : "s"} remaining`;
          const subjectColor = (r.subjectKind === "vehicle" ? "var(--navy-700)" : "var(--navy-700)");
          const navigate = r.subjectKind === "vehicle"
            ? () => onOpenUnit(r.subjectId)
            : () => onOpenDriver(r.subjectId);

          return (
            <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
              {showTypePill && (
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    font: "600 10px var(--font-sans)", letterSpacing: "0.1em", textTransform: "uppercase",
                    padding: "2px 6px", borderRadius: 2,
                    background: r.kind === "maintenance" ? "#E8EEF6" : "#EAF3EE",
                    color: r.kind === "maintenance" ? "var(--navy-800)" : "var(--ok)",
                  }}>{r.kind === "maintenance" ? "Maint" : "Expiry"}</span>
                </td>
              )}
              <td style={{ padding: "10px 14px", fontWeight: 500 }}>
                <button
                  onClick={navigate}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: subjectColor, textDecoration: "underline", textUnderlineOffset: 2, font: "inherit", fontWeight: 500 }}
                  title={r.subjectKind === "vehicle" ? `Open ${r.subjectLabel} details` : `Open ${r.subjectLabel}`}>
                  {r.subjectLabel}
                </button>
              </td>
              <td style={{ padding: "10px 14px" }}>{r.recordType}</td>
              <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>{r.date}</td>
              <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)", fontWeight: 600,
                color: tone === "accent" ? "var(--accent-700)" : tone === "warn" ? "var(--accent-700)" : "var(--navy-900)" }}>
                {r.days != null ? (r.days < 0 ? `${r.days}` : `+${r.days}`) : ""}
              </td>
              {/* Overdue section has 5 cols; Coming-up sections have 5 cols incl status pill */}
              {!showTypePill && (
                <td style={{ padding: "10px 14px" }}>
                  <Pill tone={tone}>{label}</Pill>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---- Defect modals ----

function ModalShell({ title, subtitle, onClose, width = 880, children, footer }) {
  // Lock body scroll while the modal is open.
  React.useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  // Esc closes.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "60px 20px",
        overflowY: "auto",
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--white)", borderRadius: 6, maxWidth: width, width: "100%",
          boxShadow: "0 24px 48px rgba(0,0,0,0.25)",
          display: "flex", flexDirection: "column",
          maxHeight: "calc(100vh - 120px)",
        }}>
        <header style={{ padding: "16px 22px", borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ font: "600 16px var(--font-sans)", color: "var(--navy-900)", lineHeight: 1.3 }}>{title}</div>
            {subtitle && <div style={{ font: "12px/1.4 var(--font-sans)", color: "var(--fg-muted)", marginTop: 4 }}>{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none", border: "1px solid var(--rule)", borderRadius: 4,
              padding: "4px 10px", cursor: "pointer", font: "600 13px var(--font-sans)",
              color: "var(--fg-muted)",
            }}
            title="Close (Esc)">
            ✕
          </button>
        </header>
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          {children}
        </div>
        {footer && (
          <footer style={{ padding: "12px 22px", borderTop: "1px solid var(--rule)", background: "var(--steel-50)" }}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

function DefectDetailModal({ defect, reportIdx, onPickReport, onClose }) {
  const reports = defect.reports || [];
  const current = reports[reportIdx] || reports[0] || null;
  const pdfUrl = current && current.pdf_url ? `${current.pdf_url}#page=2` : null;
  return (
    <ModalShell
      title={`${defect.unit} · ${defect.text}`}
      subtitle={`Open ${defect.days_open || 0} days · first reported ${defect.first_reported} · ${defect.occurrences} report${defect.occurrences === 1 ? "" : "s"} · ${(defect.drivers || []).join(", ")}`}
      onClose={onClose}>
      {reports.length > 1 && (
        <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ font: "11px var(--font-sans)", color: "var(--fg-muted)", marginRight: 4, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>Reports:</span>
          {reports.map((r, i) => {
            const active = i === reportIdx;
            return (
              <button key={i}
                onClick={() => onPickReport(i)}
                style={{
                  background: active ? "var(--navy-700)" : "var(--white)",
                  color: active ? "var(--white)" : "var(--navy-800)",
                  border: "1px solid " + (active ? "var(--navy-700)" : "var(--rule)"),
                  padding: "4px 10px", borderRadius: 3, cursor: "pointer",
                  font: "12px var(--font-sans)",
                }}
                title={r.driver_name ? `Reported by ${r.driver_name}` : ""}>
                {r.date}
              </button>
            );
          })}
        </div>
      )}

      {!current && (
        <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>
          No DVI reports linked to this defect.
        </div>
      )}

      {current && !pdfUrl && (
        <div style={{ padding: 16, background: "var(--steel-50)", border: "1px solid var(--rule)", borderRadius: 4, font: "13px var(--font-sans)", color: "var(--fg-subtle)" }}>
          Source pre-trip PDF isn't available for this report. The driver may have been removed from the registry, or the date doesn't have a published passthrough.<br />
          <span style={{ color: "var(--fg-muted)", fontSize: 12 }}>Reported by {current.driver_name || "unknown"} on {current.date}.</span>
        </div>
      )}

      {current && pdfUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
            Reported by <strong style={{ color: "var(--navy-800)" }}>{current.driver_name || "unknown"}</strong> on <span style={{ fontFamily: "var(--font-mono)" }}>{current.date}</span>. The full pre-trip is embedded below; the Remarks field and any attached photo are on page 2.
          </div>
          <iframe
            src={pdfUrl}
            title={`Pre-trip ${current.date}`}
            style={{ width: "100%", height: 640, border: "1px solid var(--rule)", borderRadius: 4, background: "#f4f5f7" }}
          />
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
            style={{ font: "12px var(--font-sans)", color: "var(--navy-700)", alignSelf: "flex-start", textDecoration: "underline" }}>
            Open full PDF in a new tab ↗
          </a>
        </div>
      )}
    </ModalShell>
  );
}

function DefectCloseModal({ defect, form, setForm, feedback, setFeedback, onCancel }) {
  const buildPayload = () => ({
    unit: defect.unit,
    text_match: form.text_match,
    resolved_date: form.resolved_date,
    notes: form.notes,
  });
  const submit = async () => {
    const payload = buildPayload();
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("Copied to clipboard. Paste into the defects_resolved array in maintenance.json and commit.");
    } catch (e) {
      setFeedback("Could not access clipboard. Select the JSON below and copy manually.");
    }
  };
  const previewJson = JSON.stringify(buildPayload(), null, 2);
  return (
    <ModalShell
      title={`Close defect · ${defect.unit}`}
      subtitle={defect.text}
      width={620}
      onClose={onCancel}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{ background: "var(--white)", border: "1px solid var(--rule)", padding: "8px 16px", borderRadius: 4, cursor: "pointer", font: "13px var(--font-sans)", color: "var(--navy-800)" }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!form.resolved_date || !form.text_match}
            style={{
              background: "var(--navy-700)", color: "var(--white)", border: "1px solid var(--navy-700)",
              padding: "8px 16px", borderRadius: 4, cursor: (!form.resolved_date || !form.text_match) ? "not-allowed" : "pointer",
              font: "600 13px var(--font-sans)", opacity: (!form.resolved_date || !form.text_match) ? 0.5 : 1,
            }}>
            Copy closure JSON
          </button>
        </div>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ font: "600 11px var(--font-sans)", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Text match</label>
          <input
            type="text"
            value={form.text_match}
            onChange={(e) => setForm({ ...form, text_match: e.target.value })}
            style={{ padding: "8px 10px", border: "1px solid var(--rule)", borderRadius: 4, font: "13px var(--font-sans)", color: "var(--navy-900)" }} />
          <div style={{ font: "11.5px/1.4 var(--font-sans)", color: "var(--fg-subtle)" }}>
            Case-insensitive substring. Defaults to the full defect text (closes this exact entry). Trim to a shorter phrase like "Block heater" to close multiple worded variants at once.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ font: "600 11px var(--font-sans)", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Resolved date</label>
          <input
            type="date"
            value={form.resolved_date}
            onChange={(e) => setForm({ ...form, resolved_date: e.target.value })}
            style={{ padding: "8px 10px", border: "1px solid var(--rule)", borderRadius: 4, font: "13px var(--font-sans)", color: "var(--navy-900)", maxWidth: 220 }} />
          <div style={{ font: "11.5px/1.4 var(--font-sans)", color: "var(--fg-subtle)" }}>
            Any later DVI re-flagging this defect will re-open it.
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ font: "600 11px var(--font-sans)", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Notes (optional)</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="What was done to fix it"
            rows={3}
            style={{ padding: "8px 10px", border: "1px solid var(--rule)", borderRadius: 4, font: "13px var(--font-sans)", color: "var(--navy-900)", resize: "vertical", fontFamily: "var(--font-sans)" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ font: "600 11px var(--font-sans)", color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Preview</div>
          <pre style={{
            margin: 0, padding: 10, background: "var(--steel-50)", border: "1px solid var(--rule)",
            borderRadius: 4, font: "12px/1.5 var(--font-mono)", color: "var(--navy-900)",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{previewJson}</pre>
        </div>

        {feedback && (
          <div style={{
            padding: "10px 12px", background: "#EAF3EE", border: "1px solid #BFD9C9",
            borderRadius: 4, font: "12.5px var(--font-sans)", color: "var(--navy-900)",
          }}>
            {feedback}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

window.Maintenance = Maintenance;
