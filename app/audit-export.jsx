// Audit Export - NSC inspection-ready single-page report.
// Designed to print to letter PDF, fit-to-page.

const AuditExport = ({ unitId, year, month, weightFilter, onClose }) => {
  const D = window.NORFAB_DATA;
  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const fromISO = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getUTCDate();
  const toISO = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  // tripsForRange in data.js has signature (driverId, fromISO, toISO) - the
  // 4-arg call previously here silently filtered nothing (positional shift).
  // Inline filter to actually honor unitId + weightFilter.
  const trips = (D.TRIPS || []).filter(t => {
    if (!t.date || t.date < fromISO || t.date > toISO) return false;
    if (unitId && unitId !== "ALL" && t.unit !== unitId) return false;
    if (weightFilter && weightFilter !== "all") {
      const u = (D.UNITS || []).find(x => x.id === t.unit);
      if (!u) return false;
      if (weightFilter === "heavy" && u.klass !== "heavy") return false;
      if (weightFilter === "light" && u.klass !== "light") return false;
    }
    return true;
  });

  const totalKm = trips.reduce((s, t) => s + t.km, 0);
  const flagged = trips.filter(t => t.flagged);
  const days = new Set(trips.map(t => t.date)).size;
  const unitsActive = new Set(trips.map(t => t.unit));
  const generated = new Date(Date.UTC(2026, 4, 7, 16, 22)).toLocaleString("en-CA", { timeZone: "America/Edmonton" });

  // Group by unit, then by date
  const byUnit = {};
  for (const t of trips) {
    if (!byUnit[t.unit]) byUnit[t.unit] = {};
    if (!byUnit[t.unit][t.date]) byUnit[t.unit][t.date] = { trips: [], km: 0, flags: 0 };
    byUnit[t.unit][t.date].trips.push(t);
    byUnit[t.unit][t.date].km += t.km;
    if (t.flagged) byUnit[t.unit][t.date].flags++;
  }

  // ---------- Section 1 data: driver roster for the period ----------
  // Union of drivers who appear in trips OR DVIs for the period.
  const dvirsInPeriod = (D.DVIR || []).filter(d => d.date_local >= fromISO && d.date_local <= toISO);
  const rosterNames = new Set();
  for (const t of trips) if (t.driver_name) rosterNames.add(t.driver_name);
  for (const d of dvirsInPeriod) if (d.driver_name) rosterNames.add(d.driver_name);
  const roster = [...rosterNames].sort().map(name => {
    const myTrips = trips.filter(t => t.driver_name === name);
    const myDvirs = dvirsInPeriod.filter(d => d.driver_name === name);
    const unitCounts = myTrips.reduce((acc, t) => { acc[t.unit] = (acc[t.unit] || 0) + 1; return acc; }, {});
    const primaryUnit = Object.entries(unitCounts).sort((a, b) => b[1] - a[1])[0];
    return {
      name,
      primaryUnit: primaryUnit ? primaryUnit[0] : "",
      daysActive: new Set(myTrips.map(t => t.date)).size,
      trips: myTrips.length,
      dvirs: myDvirs.length,
      km: myTrips.reduce((s, t) => s + t.km, 0),
    };
  });

  // ---------- Section 2 data: daily compliance grid (Day x Unit x Driver) ----------
  // One row per unique (date, unit, driver_name) where the unit operated.
  const gridMap = new Map();
  for (const t of trips) {
    const key = `${t.date}|${t.unit}|${t.driver_name || "(unknown)"}`;
    if (!gridMap.has(key)) {
      gridMap.set(key, {
        date: t.date, unit: t.unit, driver_id: t.driver, driver_name: t.driver_name || "(unknown)",
        trips: 0, km: 0,
      });
    }
    const row = gridMap.get(key);
    row.trips++;
    row.km += t.km;
  }
  const dailyGrid = [...gridMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.unit.localeCompare(b.unit) || a.driver_name.localeCompare(b.driver_name)
  ).map(row => {
    const preDvi = (D.DVIR || []).some(d => d.date_local === row.date && d.unit === row.unit && d.trip_type === "Pre");
    const postDvi = (D.DVIR || []).some(d => d.date_local === row.date && d.unit === row.unit && d.trip_type === "Post");
    let hosState = "", hosHours = null;
    if (typeof D.dayCompliance === "function") {
      try {
        const c = D.dayCompliance(row.driver_id, row.date);
        if (c && c.state) hosState = c.state;
        if (c && c.totalHours != null) hosHours = c.totalHours;
        else if (c && c.hours != null) hosHours = c.hours;
      } catch (e) { /* leave defaults */ }
    }
    return { ...row, preDvi, postDvi, hosState, hosHours };
  });

  // ---------- Section 3 data: DVI completion log ----------
  const dvirLog = [...dvirsInPeriod].sort((a, b) =>
    a.date_local.localeCompare(b.date_local) || ((a.time_min || 0) - (b.time_min || 0))
  );

  // ---------- Section 4 data: HOS / 160 km exemption per-driver summary ----------
  const hosSummary = roster.map(r => {
    const myDays = [...new Set(trips.filter(t => t.driver_name === r.name).map(t => t.date))];
    let exempt = 0, outOfRadius = 0, overHours = 0, unknown = 0;
    const driverId = (trips.find(t => t.driver_name === r.name) || {}).driver;
    if (driverId && typeof D.dayCompliance === "function") {
      for (const day of myDays) {
        try {
          const c = D.dayCompliance(driverId, day);
          const state = (c && c.state) || "";
          if (/exempt|ok|compliant/i.test(state)) exempt++;
          else if (/radius|160/i.test(state)) outOfRadius++;
          else if (/hour|15h|shift/i.test(state)) overHours++;
          else unknown++;
        } catch (e) { unknown++; }
      }
    } else {
      unknown = myDays.length;
    }
    return { name: r.name, daysWorked: myDays.length, exempt, outOfRadius, overHours, unknown };
  });

  // ---------- Section 5 data: exception details ----------
  const exceptionRows = [];
  for (const row of dailyGrid) {
    if (!row.preDvi) {
      exceptionRows.push({ kind: "Missing pre-trip DVI", date: row.date, unit: row.unit, driver: row.driver_name, detail: `${row.trips} trip(s), ${row.km.toFixed(1)} km logged with no pre-trip inspection on file` });
    }
  }
  for (const t of trips) {
    if (t.outside_radius) {
      exceptionRows.push({ kind: "Outside 160 km exemption radius", date: t.date, unit: t.unit, driver: t.driver_name || "(unknown)", detail: `Max radius ~${(t.site_dist || 0).toFixed(1)} km from day-start (limit 160 km)` });
    }
  }
  // Sort exceptions by date, then kind
  exceptionRows.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  return (
    <div style={{ background: "var(--steel-100)", minHeight: "100%", padding: "32px 0" }}>
      {/* Toolbar (hidden on print) */}
      <div className="no-print" style={{
        position: "sticky", top: 0, zIndex: 5,
        background: "var(--white)", borderBottom: "1px solid var(--border)",
        padding: "10px 24px", display: "flex", gap: 10, alignItems: "center",
        marginTop: -32, marginBottom: 24,
      }}>
        <div style={{ flex: 1, font: "600 13px var(--font-sans)", color: "var(--navy-900)" }}>
          NSC compliance report · {monthLabel}
        </div>
        {/* One button: the browser print dialog is also the PDF exporter
            (destination "Save as PDF"). A separate Download PDF button was
            an unwired stub — removed rather than duplicating Print. */}
        <Btn kind="primary" size="sm" icon={<Icon name="printer" size={14} />} onClick={() => window.print()}>Print / Save PDF</Btn>
      </div>

      {/* Page */}
      <div className="audit-page" style={{
        width: 816, // ~ letter at 96dpi
        minHeight: 1056,
        margin: "0 auto",
        background: "var(--white)",
        boxShadow: "var(--shadow-2)",
        padding: "48px 56px",
        fontFamily: "var(--font-sans)",
        color: "var(--navy-900)",
        position: "relative",
      }}>
        {/* Letterhead */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid var(--navy-900)", paddingBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src="assets/logo-nfm-clean.png" style={{ height: 40 }} alt="Cascade Freight" />
            <div>
              <div style={{ font: "700 16px/1.1 var(--font-display)", letterSpacing: "-0.005em" }}>Cascade Freight Inc.</div>
              <div style={{ font: "11px/1.4 var(--font-sans)", color: "var(--fg-subtle)", marginTop: 2 }}>
                {D.PPB.name}<br/>(555) 010-0100 · cascadefreight.example
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <Eyebrow>NSC Compliance Report</Eyebrow>
            <div style={{ font: "600 22px/1.1 var(--font-display)", marginTop: 6, letterSpacing: "-0.01em" }}>{monthLabel}</div>
            <div style={{ font: "11px/1.5 var(--font-sans)", color: "var(--fg-muted)", marginTop: 4 }}>
              Generated {generated} MDT<br/>
              Document ID: NF-{year}{String(month + 1).padStart(2, "0")}-{unitId === "ALL" ? "FLEET" : unitId}
            </div>
          </div>
        </div>

        {/* SFC + carrier identification */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 20 }}>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>Carrier identification</Eyebrow>
            <table style={{ width: "100%", font: "11.5px/1.5 var(--font-sans)" }}>
              <tbody>
                {[
                  ["Legal name", D.SFC.carrier],
                  ["NSC number", D.SFC.nsc],
                  ["Classification", D.SFC.classification],
                  ["Principal place", D.PPB.name],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: "var(--fg-muted)", padding: "2px 12px 2px 0", verticalAlign: "top", width: 110 }}>{k}</td>
                    <td style={{ color: "var(--navy-900)", padding: "2px 0", fontWeight: 500 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <Eyebrow style={{ marginBottom: 8 }}>Reporting scope</Eyebrow>
            <table style={{ width: "100%", font: "11.5px/1.5 var(--font-sans)" }}>
              <tbody>
                {[
                  ["Period", `${fromISO} to ${toISO}`],
                  ["Unit filter", unitId === "ALL" ? "All fleet units" : unitId],
                  ["Weight class", weightFilter === "heavy" ? "≥ 11,794 kg (NSC time-record)" : weightFilter === "light" ? "< 11,794 kg" : "All weights"],
                  ["Trip threshold", "≥ 0.60 km logged"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: "var(--fg-muted)", padding: "2px 12px 2px 0", verticalAlign: "top", width: 110 }}>{k}</td>
                    <td style={{ color: "var(--navy-900)", padding: "2px 0", fontWeight: 500 }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Summary */}
        <div style={{ marginTop: 24, border: "1px solid var(--border)", display: "grid", gridTemplateColumns: "repeat(5, 1fr)" }}>
          {[
            ["Active units", unitsActive.size],
            ["Days with data", days],
            ["Trips logged", trips.length],
            ["Distance (km)", totalKm.toFixed(1)],
            ["Flags", flagged.length],
          ].map(([k, v], i) => (
            <div key={k} style={{
              padding: "10px 14px",
              borderRight: i < 4 ? "1px solid var(--border)" : "none",
            }}>
              <div style={{ font: "600 9.5px/1 var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{k}</div>
              <div style={{ font: "600 20px/1.1 var(--font-display)", color: "var(--navy-900)", marginTop: 6, letterSpacing: "-0.01em" }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Statement */}
        <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--steel-50)", borderLeft: "3px solid var(--navy-900)", font: "11.5px/1.55 var(--font-sans)", color: "var(--fg-subtle)" }}>
          <strong style={{ color: "var(--navy-900)" }}>Compliance statement.</strong> All trips logged via fixed GPS telematics on
          carrier-owned units, delivered hourly by the upstream provider and persisted to immutable storage. Flags indicate trips that
          either ended outside the 1.5 km return-to-origin radius or operated beyond the 160 km Alberta exemption
          radius for time-record–required units (≥ 11,794 kg GVW). This document is generated automatically from
          the source telemetry; raw evidence is retained for the period required by NSC Standard 9.
        </div>

        {/* Per-unit breakdown */}
        <div style={{ marginTop: 24 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Per-unit summary</Eyebrow>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "11.5px var(--font-sans)" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                {[
                  ["Unit", "left"], ["Class", "left"], ["Driver", "left"],
                  ["Days", "right"], ["Trips", "right"], ["Distance (km)", "right"], ["Flags", "right"], ["Status", "left"],
                ].map(([h, a]) => (
                  <th key={h} style={{ textAlign: a, padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(byUnit).sort().map(uid => {
                const u = D.UNITS.find(x => x.id === uid);
                const utrips = trips.filter(t => t.unit === uid);
                const ukm = utrips.reduce((s, t) => s + t.km, 0);
                const uflags = utrips.filter(t => t.flagged).length;
                const udays = new Set(utrips.map(t => t.date)).size;
                return (
                  <tr key={uid} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "8px 8px", font: "600 12px var(--font-mono)", color: "var(--navy-900)" }}>{uid}</td>
                    <td style={{ padding: "8px 8px", color: "var(--fg-subtle)" }}>{u.klass === "heavy" ? "Heavy" : "Light"}</td>
                    <td style={{ padding: "8px 8px" }}>{u.driver}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{udays}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{utrips.length}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{ukm.toFixed(1)}</td>
                    <td style={{ padding: "8px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: uflags ? "var(--accent-700)" : "var(--fg-subtle)", fontWeight: uflags ? 600 : 400 }}>{uflags}</td>
                    <td style={{ padding: "8px 8px" }}>
                      {uflags === 0
                        ? <span style={{ color: "var(--ok)", font: "600 11px var(--font-sans)" }}>● Compliant</span>
                        : <span style={{ color: "var(--accent-700)", font: "600 11px var(--font-sans)" }}>● Review ({uflags})</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Flag detail */}
        {flagged.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <Eyebrow style={{ marginBottom: 10 }}>Flagged trips · detail</Eyebrow>
            <table style={{ width: "100%", borderCollapse: "collapse", font: "11px var(--font-sans)" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                  {["Date", "Unit", "Driver", "Time", "Site", "Km", "Reason"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flagged.slice(0, 18).map(t => (
                  <tr key={t.id} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "var(--font-mono)" }}>{t.date}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{t.unit}</td>
                    <td style={{ padding: "6px 8px" }}>{t.driver}</td>
                    <td style={{ padding: "6px 8px", color: "var(--fg-muted)" }}>{D.minToHHMM(t.start_min)}</td>
                    <td style={{ padding: "6px 8px" }}>{t.site}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{t.km.toFixed(1)}</td>
                    <td style={{ padding: "6px 8px", color: "var(--accent-700)", fontWeight: 600 }}>
                      {t.outside_radius ? "Outside 160 km exemption radius (from day-start)" : ((t.flags && t.flags[0]) || "Flagged in source data")}
                    </td>
                  </tr>
                ))}
                {flagged.length > 18 && (
                  <tr><td colSpan={7} style={{ padding: 8, color: "var(--fg-muted)", textAlign: "center", fontStyle: "italic" }}>+ {flagged.length - 18} additional flagged trips. See full ledger.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Section 1: Driver roster for the audit period */}
        {roster.length > 0 && (
          <div style={{ marginTop: 28, pageBreakBefore: "always" }}>
            <Eyebrow style={{ marginBottom: 10 }}>Driver roster · {monthLabel}</Eyebrow>
            <table style={{ width: "100%", borderCollapse: "collapse", font: "11.5px var(--font-sans)" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                  {[["Driver", "left"], ["Primary unit", "left"], ["Days active", "right"], ["Trips", "right"], ["DVIs filed", "right"], ["Distance (km)", "right"]].map(([h, a]) => (
                    <th key={h} style={{ textAlign: a, padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map(r => (
                  <tr key={r.name} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "7px 8px", fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: "7px 8px", fontFamily: "var(--font-mono)" }}>{r.primaryUnit}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.daysActive}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.trips}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: r.dvirs === 0 ? "var(--accent-700)" : "var(--navy-900)", fontWeight: r.dvirs === 0 ? 600 : 400 }}>{r.dvirs}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.km.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Section 2: Daily compliance grid */}
        {dailyGrid.length > 0 && (
          <div style={{ marginTop: 28, pageBreakBefore: "always" }}>
            <Eyebrow style={{ marginBottom: 10 }}>Daily compliance grid · Day × Unit × Driver</Eyebrow>
            <div style={{ font: "10.5px var(--font-sans)", color: "var(--fg-muted)", marginBottom: 8 }}>
              One row per operating day, per unit, per driver. Pre = pre-trip DVI on file; Post = post-trip DVI on file; HOS = 160 km exemption status for that driver's day.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", font: "11px var(--font-sans)" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                  {[["Date", "left"], ["Unit", "left"], ["Driver", "left"], ["Trips", "right"], ["Km", "right"], ["Pre DVI", "center"], ["Post DVI", "center"], ["HOS state", "left"]].map(([h, a]) => (
                    <th key={h} style={{ textAlign: a, padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyGrid.slice(0, 60).map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{row.date}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{row.unit}</td>
                    <td style={{ padding: "5px 8px" }}>{row.driver_name}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{row.trips}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{row.km.toFixed(1)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "center", color: row.preDvi ? "var(--ok)" : "var(--accent-700)", fontWeight: 600 }}>{row.preDvi ? "Yes" : "No"}</td>
                    <td style={{ padding: "5px 8px", textAlign: "center", color: row.postDvi ? "var(--ok)" : "var(--fg-muted)", fontWeight: row.postDvi ? 600 : 400 }}>{row.postDvi ? "Yes" : "No"}</td>
                    <td style={{ padding: "5px 8px", font: "11px var(--font-sans)", color: "var(--fg-subtle)" }}>{row.hosState}{row.hosHours != null && <span style={{ color: "var(--fg-muted)" }}> · {row.hosHours.toFixed(2)}h</span>}</td>
                  </tr>
                ))}
                {dailyGrid.length > 60 && (
                  <tr><td colSpan={8} style={{ padding: 8, color: "var(--fg-muted)", textAlign: "center", fontStyle: "italic" }}>+ {dailyGrid.length - 60} additional rows. See full digital record.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Section 3: DVI completion log */}
        {dvirLog.length > 0 && (
          <div style={{ marginTop: 28, pageBreakBefore: "always" }}>
            <Eyebrow style={{ marginBottom: 10 }}>DVI completion log · {monthLabel}</Eyebrow>
            <div style={{ font: "10.5px var(--font-sans)", color: "var(--fg-muted)", marginBottom: 8 }}>
              Every pre-trip and post-trip inspection filed during the period. Defect details and signatures are in the source PDFs, retained for the full audit retention period.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", font: "11px var(--font-sans)" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                  {[["Date", "left"], ["Time", "left"], ["Unit", "left"], ["Driver", "left"], ["Type", "left"], ["Odometer", "right"]].map(([h, a]) => (
                    <th key={h} style={{ textAlign: a, padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dvirLog.slice(0, 60).map((d, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{d.date_local}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{d.time_local || ""}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{d.unit}</td>
                    <td style={{ padding: "5px 8px" }}>{d.driver_name}</td>
                    <td style={{ padding: "5px 8px" }}>{d.trip_type}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{d.odometer_km != null ? d.odometer_km.toLocaleString() : ""}</td>
                  </tr>
                ))}
                {dvirLog.length > 60 && (
                  <tr><td colSpan={6} style={{ padding: 8, color: "var(--fg-muted)", textAlign: "center", fontStyle: "italic" }}>+ {dvirLog.length - 60} additional inspections. See source PDFs.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Section 4: HOS / 160 km exemption per-driver summary */}
        {hosSummary.length > 0 && (
          <div style={{ marginTop: 28, pageBreakBefore: "always" }}>
            <Eyebrow style={{ marginBottom: 10 }}>HOS &amp; 160 km exemption summary · per driver</Eyebrow>
            <div style={{ font: "10.5px var(--font-sans)", color: "var(--fg-muted)", marginBottom: 8 }}>
              Each driver's day-by-day status under AB Reg 317/2002 §78. "Exempt" = met all three conditions (within 160 km of day-start, returned to day-start, released within 15h). Other columns flag specific exception types.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", font: "11.5px var(--font-sans)" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                  {[["Driver", "left"], ["Days worked", "right"], ["Exempt", "right"], ["Outside 160 km", "right"], ["Over 15 h shift", "right"], ["Unclassified", "right"]].map(([h, a]) => (
                    <th key={h} style={{ textAlign: a, padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hosSummary.map(h => (
                  <tr key={h.name} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "7px 8px", fontWeight: 500 }}>{h.name}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{h.daysWorked}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--ok)", fontWeight: 600 }}>{h.exempt}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: h.outOfRadius ? "var(--accent-700)" : "var(--fg-muted)", fontWeight: h.outOfRadius ? 600 : 400 }}>{h.outOfRadius}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: h.overHours ? "var(--accent-700)" : "var(--fg-muted)", fontWeight: h.overHours ? 600 : 400 }}>{h.overHours}</td>
                    <td style={{ padding: "7px 8px", textAlign: "right", fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{h.unknown}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Section 5: Exception detail */}
        {exceptionRows.length > 0 && (
          <div style={{ marginTop: 28, pageBreakBefore: "always" }}>
            <Eyebrow style={{ marginBottom: 10 }}>Exception detail · items flagged for review</Eyebrow>
            <table style={{ width: "100%", borderCollapse: "collapse", font: "11px var(--font-sans)" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                  {["Date", "Type", "Unit", "Driver", "Detail"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exceptionRows.slice(0, 40).map((x, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--rule)" }}>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)" }}>{x.date}</td>
                    <td style={{ padding: "5px 8px", color: "var(--accent-700)", fontWeight: 600 }}>{x.kind}</td>
                    <td style={{ padding: "5px 8px", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{x.unit}</td>
                    <td style={{ padding: "5px 8px" }}>{x.driver}</td>
                    <td style={{ padding: "5px 8px", color: "var(--fg-subtle)" }}>{x.detail}</td>
                  </tr>
                ))}
                {exceptionRows.length > 40 && (
                  <tr><td colSpan={5} style={{ padding: 8, color: "var(--fg-muted)", textAlign: "center", fontStyle: "italic" }}>+ {exceptionRows.length - 40} additional exceptions. See full ledger.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Section 6: External records pointer (always shown) */}
        <div style={{ marginTop: 28, pageBreakInside: "avoid" }}>
          <Eyebrow style={{ marginBottom: 10 }}>External records (not in this packet)</Eyebrow>
          <div style={{ font: "10.5px var(--font-sans)", color: "var(--fg-muted)", marginBottom: 8 }}>
            The records below are required for a complete NSC audit but are maintained outside this fleet-telemetry pipeline. They are produced on request from their respective custodians.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "11.5px var(--font-sans)" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                <th style={{ textAlign: "left", padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>Record type</th>
                <th style={{ textAlign: "left", padding: "6px 8px", font: "600 9.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>Where to obtain</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Driver commercial licences (Class 1/3), validity, endorsements", "HR file"],
                ["Driver medical certificates", "HR file"],
                ["Driver abstracts (current and on-hire)", "HR file"],
                ["CVIP annual vehicle inspection certificates", "Maintenance file"],
                ["Insurance / pink slip per vehicle", "Admin file"],
                ["Incident, collision, and at-fault reports", "Safety file"],
                ["Drug & alcohol policy and testing records", "HR file"],
                ["TDG / dangerous goods training, if applicable", "HR file"],
                ["Driver hire-on records (interview, references, training sign-off)", "HR file"],
                ["DVI source PDFs with full defect text and signatures", "SiteDocs archive (2-yr retention)"],
              ].map(([record, where]) => (
                <tr key={record} style={{ borderBottom: "1px solid var(--rule)" }}>
                  <td style={{ padding: "6px 8px" }}>{record}</td>
                  <td style={{ padding: "6px 8px", color: "var(--fg-subtle)", fontStyle: "italic" }}>{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Sign-off */}
        <div style={{ marginTop: 36, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 36, pageBreakInside: "avoid" }}>
          {["Prepared by (Compliance Officer)", "Inspector / Auditor"].map(label => (
            <div key={label}>
              <div style={{ borderBottom: "1px solid var(--navy-900)", height: 36 }} />
              <div style={{ font: "10.5px var(--font-sans)", color: "var(--fg-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 6 }}>{label}</div>
              <div style={{ font: "10.5px var(--font-sans)", color: "var(--fg-muted)", marginTop: 2 }}>Name · Signature · Date</div>
            </div>
          ))}
        </div>

        <div style={{ position: "absolute", left: 56, right: 56, bottom: 24, display: "flex", justifyContent: "space-between", font: "10px var(--font-sans)", color: "var(--fg-muted)" }}>
          <span>Cascade Freight Inc. · Internal compliance document</span>
          <span>Page 1 of 1</span>
        </div>
      </div>
    </div>
  );
};

window.AuditExport = AuditExport;
