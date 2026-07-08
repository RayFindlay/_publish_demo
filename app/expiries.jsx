// Expiries view - per-vehicle and per-driver compliance dates.
// Surfaces what's due in the next 30/60/90 days from fleet-meta.json.
// All data is hand-maintained (no upstream feed). Editing fleet-meta.json
// in the source repo updates this view on next pipeline run.

const { useState: useStateEx, useMemo: useMemoEx } = React;

const Expiries = ({ onBack, onOpenUnit, onOpenDriver }) => {
  const D = window.NORFAB_DATA;
  const [scope, setScope] = useStateEx("all"); // all | 30 | 60 | 90 | overdue

  // Flatten all expiry rows from vehicles + drivers
  const allRows = useMemoEx(() => {
    const rows = [];
    for (const u of D.UNITS) {
      const meta = D.vehicleMeta ? D.vehicleMeta(u.id) : {};
      const fields = [
        { kind: "CVIP", date: meta.cvip_expires },
        { kind: "Registration", date: meta.registration_expires },
        { kind: "Insurance", date: meta.insurance_expires },
      ];
      for (const f of fields) {
        const days = D.daysUntil ? D.daysUntil(f.date) : null;
        rows.push({
          subjectKind: "vehicle",
          subjectId: u.id,
          subjectLabel: `${u.id} (${u.year} ${u.make} ${u.model})`,
          recordType: f.kind,
          date: f.date || "",
          days,
        });
      }
    }
    for (const d of D.DRIVERS) {
      const meta = D.driverMeta ? D.driverMeta(d.id) : {};
      const fields = [
        { kind: "Licence", date: meta.license_expires, extra: meta.license_class ? ` (${meta.license_class})` : "" },
        { kind: "Medical", date: meta.medical_expires, extra: "" },
        { kind: "Abstract obtained", date: meta.abstract_obtained, extra: "", isObtainedDate: true },
      ];
      for (const f of fields) {
        const days = D.daysUntil ? D.daysUntil(f.date) : null;
        rows.push({
          subjectKind: "driver",
          subjectId: d.id,
          subjectLabel: d.name,
          recordType: f.kind + (f.extra || ""),
          date: f.date || "",
          days,
          isObtainedDate: f.isObtainedDate,
        });
      }
    }
    return rows;
  }, []);

  // Filter
  const filtered = allRows.filter(r => {
    if (!r.date) return false; // hide rows with no date set (would always be "no date" noise)
    if (scope === "all") return true;
    if (scope === "overdue") return r.days != null && r.days < 0 && !r.isObtainedDate;
    const n = parseInt(scope, 10);
    return r.days != null && r.days >= 0 && r.days <= n && !r.isObtainedDate;
  });

  // Sort by days ascending (most urgent first), then by subject
  filtered.sort((a, b) => {
    if (a.days == null && b.days == null) return 0;
    if (a.days == null) return 1;
    if (b.days == null) return -1;
    return a.days - b.days;
  });

  // Counts (unfiltered)
  const cOverdue = allRows.filter(r => r.date && r.days != null && r.days < 0 && !r.isObtainedDate).length;
  const c30 = allRows.filter(r => r.date && r.days != null && r.days >= 0 && r.days <= 30 && !r.isObtainedDate).length;
  const c60 = allRows.filter(r => r.date && r.days != null && r.days >= 0 && r.days <= 60 && !r.isObtainedDate).length;
  const cMissing = allRows.filter(r => !r.date && !r.isObtainedDate).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Hero strip */}
      <div style={{ background: "var(--navy-900)", color: "#fff", padding: "22px 0", borderBottom: "1px solid var(--navy-950)" }}>
        <div style={{ maxWidth: 1480, margin: "0 auto", padding: "0 24px", boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 32, flexWrap: "wrap" }}>
          <div>
            <div style={{ font: "600 10.5px/1 var(--font-sans)", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
              Compliance expiries
            </div>
            <div style={{ font: "700 34px/1.05 var(--font-display)", color: "#fff", letterSpacing: "-0.015em", marginTop: 8 }}>
              {cOverdue > 0
                ? <><span style={{ color: "var(--accent-500)" }}>{cOverdue}</span> overdue. <span style={{ color: "rgba(255,255,255,0.6)" }}>{c30} due in 30 days.</span></>
                : <>{c30} compliance item{c30 === 1 ? "" : "s"} due in 30 days.</>}
            </div>
            <div style={{ font: "13px/1.4 var(--font-sans)", color: "rgba(255,255,255,0.7)", marginTop: 8 }}>
              Per-vehicle CVIP, registration, insurance. Per-driver licence, medical, abstract. Edit fleet-meta.json to update.
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1480, margin: "20px auto 0", padding: "0 24px", boxSizing: "border-box" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4 }}>
            <HeroCounterEx label="Overdue" value={cOverdue} sub="Past expiry date" tone={cOverdue ? "accent" : "muted"} />
            <HeroCounterEx label="Due in 30 days" value={c30} sub="Action this month" tone={c30 ? "accent" : "ok"} divider />
            <HeroCounterEx label="Due in 60 days" value={c60} sub="Plan ahead" tone="muted" divider />
            <HeroCounterEx label="No date on file" value={cMissing} sub="Records incomplete" tone={cMissing ? "accent" : "muted"} divider />
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px 32px", maxWidth: 1480, margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Segmented value={scope} onChange={setScope} options={[
            { v: "overdue", label: "Overdue" },
            { v: "30", label: "Next 30 days" },
            { v: "60", label: "Next 60 days" },
            { v: "90", label: "Next 90 days" },
            { v: "all", label: "All with dates" },
          ]} />
          <div style={{ marginLeft: "auto", font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
            {filtered.length} item{filtered.length === 1 ? "" : "s"}
          </div>
        </div>

        <div style={{ background: "var(--white)", border: "1px solid var(--border)", borderRadius: 4 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--fg-muted)" }}>
              No items in this window.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", font: "13px var(--font-sans)" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--navy-900)" }}>
                  <th style={{ textAlign: "left", padding: "10px 14px", font: "600 10px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>Subject</th>
                  <th style={{ textAlign: "left", padding: "10px 14px", font: "600 10px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>Record</th>
                  <th style={{ textAlign: "left", padding: "10px 14px", font: "600 10px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>Date</th>
                  <th style={{ textAlign: "right", padding: "10px 14px", font: "600 10px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>Days</th>
                  <th style={{ textAlign: "left", padding: "10px 14px", font: "600 10px var(--font-sans)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const onClick = r.subjectKind === "vehicle"
                    ? () => onOpenUnit(r.subjectId)
                    : () => onOpenDriver(r.subjectId);
                  const tone =
                    r.days != null && r.days < 0 ? "accent" :
                    r.days != null && r.days <= 30 ? "warn" :
                    r.days != null && r.days <= 60 ? "neutral" :
                    "ok";
                  const label =
                    r.isObtainedDate ? `Obtained ${Math.abs(r.days || 0)} days ago` :
                    r.days == null ? "" :
                    r.days < 0 ? `Overdue by ${Math.abs(r.days)} days` :
                    r.days === 0 ? "Due today" :
                    `${r.days} day${r.days === 1 ? "" : "s"} remaining`;
                  return (
                    <tr key={i} onClick={onClick} style={{ cursor: "pointer", borderBottom: "1px solid var(--rule)" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 500 }}>{r.subjectLabel}</td>
                      <td style={{ padding: "10px 14px" }}>{r.recordType}</td>
                      <td style={{ padding: "10px 14px", fontFamily: "var(--font-mono)" }}>{r.date}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600,
                        color: tone === "accent" ? "var(--accent-700)" : tone === "warn" ? "var(--accent-700)" : "var(--navy-900)" }}>
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

        {cMissing > 0 && (
          <div style={{ padding: 14, background: "var(--steel-50)", border: "1px solid var(--rule)", borderRadius: 4, font: "12px var(--font-sans)", color: "var(--fg-subtle)" }}>
            {cMissing} record{cMissing === 1 ? "" : "s"} have no date on file. Edit fleet-meta.json in the repo to add missing dates (licence, medical, CVIP, registration, insurance).
          </div>
        )}
      </div>
    </div>
  );
};

function HeroCounterEx({ label, value, sub, tone = "muted", divider }) {
  const tones = { muted: "#fff", ok: "#7DD3A8", accent: "var(--accent-500)" };
  return (
    <div style={{ padding: "14px 18px", borderLeft: divider ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
      <div style={{ font: "600 10px/1 var(--font-sans)", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{label}</div>
      <div style={{ font: "700 30px/1.05 var(--font-display)", color: tones[tone], marginTop: 8, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ font: "11.5px/1.3 var(--font-sans)", color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

window.Expiries = Expiries;
