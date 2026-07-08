// Unit Detail screen, equipment specs, recent activity, flag history.

const UnitDetail = ({ unitId, onClose, onOpenDay }) => {
  const D = window.NORFAB_DATA;
  const unit = D.UNITS.find(u => u.id === unitId);
  if (!unit) return null;

  // Real trips for this unit (have an assigned driver). Yard moves are
  // tracked separately on D.YARD_MOVES — brief unassigned movements at
  // Head Office, surfaced so 'truck was touched' is visible on days that
  // would otherwise look idle.
  const allTrips = D.TRIPS.filter(t => t.unit === unitId).sort((a, b) => b.date.localeCompare(a.date) || b.start_min - a.start_min);
  const yardMoves = (D.YARD_MOVES || []).filter(t => t.unit === unitId);
  // Merge for the Recent trips table — yard moves are tagged so the row
  // can render a different status pill.
  const allActivity = [
    ...allTrips,
    ...yardMoves.map(t => ({ ...t, _isYardMove: true })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.start_min - a.start_min);
  const last90Cutoff = (() => {
    const d = new Date(Date.UTC(2026, 4, 7)); d.setUTCDate(d.getUTCDate() - 90);
    return d.toISOString().slice(0, 10);
  })();
  const recent = allTrips.filter(t => t.date >= last90Cutoff);
  const yardMoves90 = yardMoves.filter(t => t.date >= last90Cutoff);
  const totalKm90 = recent.reduce((s, t) => s + t.km, 0);
  const flagged90 = recent.filter(t => t.flagged);
  const days90 = new Set(recent.map(t => t.date)).size;

  // Pick the most recent active day for this unit. Find the driver who drove
  // it (most trips that day wins) and grab their Pre/Post DVIs for that day.
  // This becomes the duty-status graph anchor. If the unit hasn't moved
  // recently, the chart shows a single flat Off-Duty line, which is honest.
  const dutyDay = (() => {
    if (!allTrips.length) return null;
    const day = allTrips[0].date;
    const dayTrips = allTrips.filter(t => t.date === day);
    const driverCounts = dayTrips.reduce((acc, t) => {
      const key = t.driver || "(unknown)";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const driver = Object.entries(driverCounts).sort((a, b) => b[1] - a[1])[0][0];
    const driver_name = (dayTrips.find(t => t.driver === driver) || {}).driver_name || driver;
    const driverDayTrips = dayTrips.filter(t => t.driver === driver);
    const pre  = (D.DVIR || []).find(v => v.date_local === day && v.unit === unitId && v.driver === driver && v.trip_type === "Pre")  || null;
    const post = (D.DVIR || []).find(v => v.date_local === day && v.unit === unitId && v.driver === driver && v.trip_type === "Post") || null;
    return { day, driver, driver_name, trips: driverDayTrips, pre, post };
  })();

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20, maxWidth: 1280, margin: "0 auto", height: "100%", overflowY: "auto" }}>
      <div>
        <Btn kind="ghost" onClick={onClose} size="sm" style={{ marginLeft: -8, marginBottom: 8 }}>← Back to dashboard</Btn>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24 }}>
          <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
            {unit.photo && (
              <div style={{ width: 180, height: 130, borderRadius: 4, overflow: "hidden", border: "1px solid var(--border)", flex: "0 0 180px", background: "var(--steel-100)" }}>
                <img src={unit.photo} alt={`${unit.id} ${unit.make} ${unit.model}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              </div>
            )}
            <div>
              <Eyebrow>Unit · {unit.klass === "heavy" ? "NSC time-record" : "Light vehicle"}</Eyebrow>
              <div style={{ font: "700 36px/1.05 var(--font-display)", color: "var(--navy-900)", letterSpacing: "-0.015em", marginTop: 6 }}>{unit.id}</div>
              <div style={{ font: "16px/1.4 var(--font-sans)", color: "var(--fg-subtle)", marginTop: 4 }}>
                {unit.year} {unit.make} {unit.model}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="secondary" size="sm" icon={<Icon name="printer" size={14} />}>Print</Btn>
            <Btn kind="primary" size="sm" icon={<Icon name="external-link" size={14} />}>View live JSON</Btn>
          </div>
        </div>
      </div>

      {/* Specs row */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        <Card padding={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Eyebrow>Vehicle specifications</Eyebrow>
            <Pill tone={unit.klass === "heavy" ? "warn" : "neutral"}>
              GVW {unit.gvw_kg.toLocaleString()} kg
            </Pill>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            {[
              ["Class", unit.klass === "heavy" ? "≥ 11,794 kg (NSC)" : "< 11,794 kg (Light)"],
              ["Operating area", unit.klass === "heavy" ? "160 km radius (AB exempt)" : "Local Edmonton & area"],
              ["Driver of record", unit.driver],
              ["Year / Make / Model", `${unit.year} ${unit.make} ${unit.model}`],
              ["Plate", `${unit.id}-AB`],
              ["VIN", "1FDXX0000NXXX" + unit.id.slice(-3)],
              ["Last odometer", (unit.odo || 142000).toLocaleString() + " km"],
              ["Last inspection", "Apr 18, 2026"],
            ].map(([k, v], i) => (
              <div key={k} style={{
                padding: "12px 18px",
                borderBottom: i < 6 ? "1px solid var(--rule)" : "none",
                borderRight: i % 2 === 0 ? "1px solid var(--rule)" : "none",
              }}>
                <Eyebrow style={{ marginBottom: 4 }}>{k}</Eyebrow>
                <div style={{ font: "500 14px/1.3 var(--font-sans)", color: "var(--navy-900)" }}>{v}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card padding={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--rule)" }}>
            <Eyebrow>Last 90 days</Eyebrow>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--rule)" }}>
            <Stat label="Days active" value={days90} style={{ borderLeft: "none", padding: "14px 18px", borderRight: "1px solid var(--rule)" }} />
            <Stat label="Distance" value={`${totalKm90.toFixed(0)} km`} style={{ borderLeft: "none", padding: "14px 18px" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--rule)" }}>
            <Stat label="Trips" value={recent.length} style={{ borderLeft: "none", padding: "14px 18px", borderRight: "1px solid var(--rule)" }} />
            <Stat label="Flags"
              value={flagged90.length}
              accent={flagged90.length ? "var(--accent-600)" : undefined}
              sub={flagged90.length ? `${(flagged90.length / Math.max(1, recent.length) * 100).toFixed(0)}% of trips` : "Clean"}
              style={{ borderLeft: "none", padding: "14px 18px" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr" }}>
            <Stat label="In-yard moves"
              value={yardMoves90.length}
              sub={yardMoves90.length
                ? `Brief moves at Head Office on ${new Set(yardMoves90.map(t => t.date)).size} day${new Set(yardMoves90.map(t => t.date)).size === 1 ? "" : "s"}`
                : "None"}
              style={{ borderLeft: "none", padding: "14px 18px" }} />
          </div>
        </Card>
      </div>

      {/* Duty-status graph for this unit's most recent active day. The day's
          primary driver (most trips wins ties) is the anchor; their pre/post
          DVIs for the day populate the shoulders. If the unit has no recent
          trips, the chart shows a flat Off-Duty line. */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <Eyebrow>Driver's daily log</Eyebrow>
            {dutyDay ? (
              <div style={{ font: "600 15px/1.2 var(--font-sans)", color: "var(--navy-900)", marginTop: 4 }}>
                {dutyDay.driver_name} <span style={{ color: "var(--fg-muted)", fontWeight: 400 }}>on {dutyDay.day}</span>
              </div>
            ) : (
              <div style={{ font: "500 14px/1.2 var(--font-sans)", color: "var(--fg-muted)", marginTop: 4 }}>
                No recorded activity in the last 90 days
              </div>
            )}
          </div>
          {dutyDay && (
            <Btn kind="ghost" size="sm" onClick={() => onOpenDay?.(dutyDay.day)}>
              Open day detail
            </Btn>
          )}
        </div>
        {dutyDay && window.DutyChart ? (
          <window.DutyChart day={dutyDay.day} trips={dutyDay.trips} pre={dutyDay.pre} post={dutyDay.post} />
        ) : (
          <div style={{ padding: 32, textAlign: "center", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
            Nothing to chart for this unit yet.
          </div>
        )}
      </Card>

      {/* Recent activity table + Flag log */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }}>
        <Card padding={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--rule)" }}>
            <Eyebrow>Recent trips</Eyebrow>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
            <thead>
              <tr style={{ background: "var(--steel-50)", borderBottom: "1px solid var(--rule)" }}>
                {["Date", "Time", "From", "To", "Km", "Status"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 14px", font: "600 10.5px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allActivity.slice(0, 12).map((t, i) => (
                <tr key={`a-${i}`} style={{ borderBottom: "1px solid var(--rule)", cursor: t._isYardMove ? "default" : "pointer" }}
                  onClick={t._isYardMove ? undefined : () => onOpenDay?.(t.date)}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--steel-50)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "10px 14px", font: "500 13px var(--font-mono)" }}>{t.date}</td>
                  <td style={{ padding: "10px 14px", color: "var(--fg-subtle)" }}>{D.minToHHMM(t.start_min)}</td>
                  <td style={{ padding: "10px 14px" }}>{window.LocationCell ? <window.LocationCell name={t.start_site} coords={t.startCoords} /> : (t.start_site || "")}</td>
                  <td style={{ padding: "10px 14px" }}>{window.LocationCell ? <window.LocationCell name={t.end_site} coords={t.endCoords} /> : (t.end_site || "")}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", font: "500 13px var(--font-mono)" }}>{t.km.toFixed(1)}</td>
                  <td style={{ padding: "10px 14px" }}>
                    {t._isYardMove
                      ? <Pill tone="neutral">In-yard move</Pill>
                      : t.flagged
                        ? <Pill tone="flag">{t.outside_radius ? "Outside radius" : ((t.flags && t.flags[0]) || "Flagged")}</Pill>
                        : <Pill tone="ok"><Dot tone="ok" size={6} />Compliant</Pill>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card padding={0}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--rule)" }}>
            <Eyebrow>Flag log</Eyebrow>
          </div>
          {flagged90.length === 0 ? (
            <div style={{ padding: "32px 18px", textAlign: "center", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
              <Dot tone="ok" size={10} style={{ marginBottom: 8 }} />
              <div>No flags in the last 90 days.</div>
            </div>
          ) : (
            <div style={{ maxHeight: 380, overflowY: "auto" }}>
              {flagged90.slice(0, 20).map(t => {
                const rawFlag = (t.flags && t.flags[0]) || "";
                // Relabel upstream DVI-prefixed flags to "Pre-Trip" for UI
                // clarity. The pipeline emits "DVI late" / "DVI missing"
                // generically; in practice these are pre-trip events (the
                // post-trip is informational and not separately tracked).
                const flagLabel = rawFlag ? rawFlag.replace(/\bDVI\b/g, "Pre-Trip") : "Flagged in source data";
                const fromTo = [t.start_site, t.end_site].filter(Boolean).join(" to ") || t.site || "";
                return (
                  <div key={t.id} style={{ padding: "10px 18px", borderBottom: "1px solid var(--rule)", display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <Dot tone="flag" size={8} style={{ marginTop: 6 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ font: "500 13px/1.3 var(--font-sans)", color: "var(--navy-900)" }}>
                        {t.outside_radius ? "Outside 160 km radius (from day-start)" : flagLabel}
                      </div>
                      <div style={{ font: "12px var(--font-sans)", color: "var(--fg-muted)", marginTop: 2 }}>
                        {t.date}{fromTo ? " · " + fromTo : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Maintenance for this specific unit - next 3 due + last 5 events */}
      <UnitMaintenanceCard unitId={unitId} />
    </div>
  );
};

// Maintenance summary for one unit. Shows the next 3 due items + last 5
// log entries for this unit, plus a link out to the full Maintenance
// section. Hidden entirely if no schedule rules apply to this unit AND
// there's no log history for it.
function UnitMaintenanceCard({ unitId }) {
  const D = window.NORFAB_DATA;
  // Up to 3 most-urgent due items for this unit
  const due = (typeof D.maintenanceDueList === "function" ? D.maintenanceDueList() : [])
    .filter(m => m.unit === unitId && m.due_date)
    .map(m => ({ ...m, days: D.daysUntil(m.due_date) }))
    .sort((a, b) => (a.days == null ? 9e9 : a.days) - (b.days == null ? 9e9 : b.days))
    .slice(0, 3);
  // Vehicle expiries for this unit
  const vm = D.vehicleMeta ? D.vehicleMeta(unitId) : {};
  const expiries = [
    { kind: "CVIP", date: vm.cvip_expires },
    { kind: "Registration", date: vm.registration_expires },
    { kind: "Insurance", date: vm.insurance_expires },
  ].filter(e => e.date).map(e => ({ ...e, days: D.daysUntil(e.date) }));
  // Last 5 log entries
  const log = ((D.MAINTENANCE && D.MAINTENANCE.log) || [])
    .filter(e => e.unit === unitId)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5);
  if (due.length === 0 && expiries.length === 0 && log.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
      <Card padding={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Eyebrow>Upcoming maintenance &amp; compliance</Eyebrow>
          <a href={`#maintenance/vehicle/${unitId}`}
            style={{ font: "11.5px var(--font-sans)", color: "var(--navy-700)", textDecoration: "underline" }}
            onClick={(e) => { e.preventDefault(); window.location.hash = `#maintenance/vehicle/${unitId}`; }}
            title={`Open ${unitId}'s full maintenance history`}>
            See all
          </a>
        </div>
        {due.length + expiries.length === 0 ? (
          <div style={{ padding: "20px 18px", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
            No upcoming items on file for this unit.
          </div>
        ) : (
          <div>
            {due.map((m, i) => {
              const tone = m.days != null && m.days < 0 ? "accent" : m.days != null && m.days <= 30 ? "warn" : "neutral";
              return (
                <div key={"d" + i} style={{ padding: "10px 18px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ font: "500 13px var(--font-sans)", color: "var(--navy-900)" }}>{m.item}</div>
                    <div style={{ font: "11.5px var(--font-sans)", color: "var(--fg-muted)", marginTop: 2 }}>
                      Due {m.due_date}
                    </div>
                  </div>
                  <Pill tone={tone}>{m.days == null ? "" : m.days < 0 ? `Overdue ${Math.abs(m.days)}d` : `${m.days}d`}</Pill>
                </div>
              );
            })}
            {expiries.map((e, i) => {
              const tone = e.days != null && e.days < 0 ? "accent" : e.days != null && e.days <= 30 ? "warn" : "neutral";
              return (
                <div key={"e" + i} style={{ padding: "10px 18px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ font: "500 13px var(--font-sans)", color: "var(--navy-900)" }}>{e.kind}</div>
                    <div style={{ font: "11.5px var(--font-sans)", color: "var(--fg-muted)", marginTop: 2 }}>
                      Expires {e.date}
                    </div>
                  </div>
                  <Pill tone={tone}>{e.days == null ? "" : e.days < 0 ? `Overdue ${Math.abs(e.days)}d` : `${e.days}d`}</Pill>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card padding={0}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--rule)" }}>
          <Eyebrow>Recent maintenance log</Eyebrow>
        </div>
        {log.length === 0 ? (
          <div style={{ padding: "20px 18px", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
            No log entries on file for this unit yet.
          </div>
        ) : (
          <div>
            {log.map((e, i) => (
              <div key={i} style={{ padding: "10px 18px", borderBottom: i < log.length - 1 ? "1px solid var(--rule)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ font: "500 13px var(--font-sans)", color: "var(--navy-900)" }}>{e.item}</div>
                  <div style={{ font: "12px var(--font-mono)", color: "var(--fg-muted)" }}>{e.date}</div>
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--fg-subtle)", marginTop: 2 }}>
                  {[
                    e.odometer_km != null ? `${e.odometer_km.toLocaleString()} km` : "",
                    e.performer || "",
                    e.notes || "",
                  ].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

window.UnitDetail = UnitDetail;
