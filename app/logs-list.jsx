// Logs List, table of driver daily logs for the period; click to open modal.
const LogsList = ({ state, onOpenLog, onClose, dayFilter }) => {
  const D = window.NORFAB_DATA;
  const { unitId, weightFilter, year, month } = state;
  const fromISO = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getUTCDate();
  const toISO = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const trips = D.tripsForRange(unitId, weightFilter, fromISO, toISO);

  // group by (unit, date)
  const groups = {};
  for (const t of trips) {
    if (dayFilter && t.date !== dayFilter) continue;
    const k = `${t.unit}__${t.date}`;
    if (!groups[k]) groups[k] = { unit: t.unit, date: t.date, driver: t.driver, trips: 0, km: 0, flags: 0, start: 1440, end: 0 };
    const g = groups[k];
    g.trips++; g.km += t.km;
    if (t.flagged) g.flags++;
    if (t.start_min < g.start) g.start = t.start_min;
    if (t.end_min > g.end) g.end = t.end_min;
  }
  const rows = Object.values(groups).sort((a, b) => b.date.localeCompare(a.date) || a.unit.localeCompare(b.unit));

  return (
    <div style={{ padding: 24, maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, height: "100%", overflowY: "auto" }}>
      <div>
        <Btn kind="ghost" size="sm" style={{ marginLeft: -8, marginBottom: 6 }} onClick={onClose}>← Back to dashboard</Btn>
        <Eyebrow>Driver daily logs</Eyebrow>
        <div style={{ font: "700 28px/1.1 var(--font-display)", color: "var(--navy-900)", letterSpacing: "-0.01em", marginTop: 6 }}>
          {dayFilter
            ? new Date(dayFilter + "T12:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
            : new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </div>
        <div style={{ font: "13px var(--font-sans)", color: "var(--fg-muted)", marginTop: 2 }}>
          {rows.length} log{rows.length === 1 ? "" : "s"} · {trips.length} trip{trips.length === 1 ? "" : "s"} ·{" "}
          {weightFilter === "heavy" ? "Heavy units only" : weightFilter === "light" ? "Light units only" : "All weights"}
        </div>
      </div>

      <Card padding={0}>
        <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
          <thead>
            <tr style={{ background: "var(--steel-50)", borderBottom: "1px solid var(--rule)" }}>
              {["Date", "Unit", "Driver", "First out", "Last in", "Trips", "Km", "Status"].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "10px 14px", font: "600 10.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const u = D.UNITS.find(x => x.id === r.unit);
              return (
                <tr key={i} style={{ borderBottom: "1px solid var(--rule)", cursor: "pointer" }}
                  onClick={() => onOpenLog(r.unit, r.date)}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--steel-50)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "10px 14px", font: "500 13px var(--font-mono)" }}>{r.date}</td>
                  <td style={{ padding: "10px 14px", font: "600 13px var(--font-mono)", color: "var(--navy-900)" }}>{r.unit}</td>
                  <td style={{ padding: "10px 14px" }}>
                    {r.driver}
                    <span style={{ color: "var(--fg-muted)", marginLeft: 6, fontSize: 11.5 }}>· {u.klass === "heavy" ? "Heavy" : "Light"}</span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--fg-subtle)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{D.minToHHMM(r.start)}</td>
                  <td style={{ padding: "10px 14px", color: "var(--fg-subtle)", fontFamily: "var(--font-mono)", fontSize: 12 }}>{D.minToHHMM(r.end)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.trips}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{r.km.toFixed(1)}</td>
                  <td style={{ padding: "10px 14px" }}>
                    {r.flags ? <Pill tone="flag">{r.flags} flag{r.flags === 1 ? "" : "s"}</Pill> : <Pill tone="ok"><Dot tone="ok" size={6} />Compliant</Pill>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)" }}>No logs in this period.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

window.LogsList = LogsList;
