// Vehicle list view - fleet-wide vehicle status and quick navigation.
// Mirrors the driver-centric fleet overview but unit-centric. Groups by
// in_service / maintenance / out_of_service per fleet-meta.json.

const { useState: useStateVL, useMemo: useMemoVL } = React;

const VehicleList = ({ onOpenUnit, onBack }) => {
  const D = window.NORFAB_DATA;
  const [search, setSearch] = useStateVL("");
  const [classFilter, setClassFilter] = useStateVL("all");

  const today = D.TODAY;

  // Build per-unit summary rows
  const rows = useMemoVL(() => {
    return D.UNITS.map(u => {
      const meta = D.vehicleMeta ? D.vehicleMeta(u.id) : {};
      const status = meta.status || "in_service";
      const myTrips = D.TRIPS.filter(t => t.unit === u.id);
      const lastTrip = myTrips.sort((a, b) =>
        b.date.localeCompare(a.date) || (b.end_min || 0) - (a.end_min || 0)
      )[0];
      const drovToday = myTrips.some(t => t.date === today);
      // 7-day sparkline of km
      const week = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today + "T12:00Z");
        d.setUTCDate(d.getUTCDate() - i);
        const iso = d.toISOString().slice(0, 10);
        const km = myTrips.filter(t => t.date === iso).reduce((s, t) => s + (t.km || 0), 0);
        week.push({ iso, km });
      }
      const maxKm = Math.max(1, ...week.map(w => w.km));
      // Expiry warnings (any field within 30 days)
      const cvipDays = D.daysUntil ? D.daysUntil(meta.cvip_expires) : null;
      const regDays = D.daysUntil ? D.daysUntil(meta.registration_expires) : null;
      const insDays = D.daysUntil ? D.daysUntil(meta.insurance_expires) : null;
      const soonest = [cvipDays, regDays, insDays].filter(d => d != null).sort((a, b) => a - b)[0];
      const expiryWarn = soonest != null && soonest <= 30;
      return { u, meta, status, lastTrip, drovToday, week, maxKm, soonest, expiryWarn };
    });
  }, []);

  // Filter rows
  const filtered = rows.filter(({ u, status }) => {
    if (search && !u.id.toLowerCase().includes(search.toLowerCase()) &&
        !`${u.make} ${u.model}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (classFilter === "heavy" && u.klass !== "heavy") return false;
    if (classFilter === "light" && u.klass !== "light") return false;
    return true;
  });

  const grouped = {
    in_service: filtered.filter(r => r.status === "in_service"),
    maintenance: filtered.filter(r => r.status === "maintenance"),
    out_of_service: filtered.filter(r => r.status === "out_of_service"),
  };

  // Counts (unfiltered, for hero strip)
  const total = rows.length;
  const cInService = rows.filter(r => r.status === "in_service").length;
  const cMaint = rows.filter(r => r.status === "maintenance").length;
  const cOos = rows.filter(r => r.status === "out_of_service").length;
  const cExpiringSoon = rows.filter(r => r.expiryWarn).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      {/* Hero strip */}
      <div style={{ background: "var(--navy-900)", color: "#fff", padding: "22px 0", borderBottom: "1px solid var(--navy-950)" }}>
        <div style={{ maxWidth: 1480, margin: "0 auto", padding: "0 24px", boxSizing: "border-box", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 32, flexWrap: "wrap" }}>
          <div>
            <div style={{ font: "600 10.5px/1 var(--font-sans)", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>
              Vehicle fleet
            </div>
            <div style={{ font: "700 34px/1.05 var(--font-display)", color: "#fff", letterSpacing: "-0.015em", marginTop: 8 }}>
              {total} vehicles in service.
            </div>
            <div style={{ font: "13px/1.4 var(--font-sans)", color: "rgba(255,255,255,0.7)", marginTop: 8 }}>
              Status, compliance dates, recent activity. Edit fleet-meta.json to update statuses or expiry dates.
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1480, margin: "20px auto 0", padding: "0 24px", boxSizing: "border-box" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4 }}>
            <HeroCounterV label="Total units" value={total} sub="In fleet catalog" />
            <HeroCounterV label="In service" value={cInService} sub="Available now" tone="ok" divider />
            <HeroCounterV label="Maintenance" value={cMaint} sub={cMaint ? "Off road" : "None"} tone={cMaint ? "accent" : "muted"} divider />
            <HeroCounterV label="Out of service" value={cOos} sub={cOos ? "Parked" : "None"} tone={cOos ? "accent" : "muted"} divider />
            <HeroCounterV label="Expiring soon" value={cExpiringSoon} sub="Within 30 days" tone={cExpiringSoon ? "accent" : "ok"} divider />
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px 32px", maxWidth: 1480, margin: "0 auto", width: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Filter bar */}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: "0 0 280px" }}>
            <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--fg-muted)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search unit ID or make/model..."
              style={{
                width: "100%", padding: "8px 10px 8px 32px", boxSizing: "border-box",
                border: "1px solid var(--border-strong)", borderRadius: 3,
                font: "13px var(--font-sans)", color: "var(--navy-900)", background: "var(--white)", outline: "none",
              }} />
          </div>
          <Segmented value={classFilter} onChange={setClassFilter} options={[
            { v: "all", label: "All weights" },
            { v: "heavy", label: "Heavy" },
            { v: "light", label: "Light" },
          ]} />
          <div style={{ marginLeft: "auto", font: "12px var(--font-sans)", color: "var(--fg-muted)" }}>
            {filtered.length} of {total} units
          </div>
        </div>

        {/* In-service section */}
        {grouped.in_service.length > 0 && (
          <Section title="In service" count={grouped.in_service.length} accent="ok" sub="Available for operation.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {grouped.in_service.map(r => <VehicleCard key={r.u.id} row={r} onOpen={() => onOpenUnit(r.u.id)} />)}
            </div>
          </Section>
        )}

        {grouped.maintenance.length > 0 && (
          <Section title="Maintenance" count={grouped.maintenance.length} accent="accent" sub="In repair or scheduled servicing.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {grouped.maintenance.map(r => <VehicleCard key={r.u.id} row={r} onOpen={() => onOpenUnit(r.u.id)} />)}
            </div>
          </Section>
        )}

        {grouped.out_of_service.length > 0 && (
          <Section title="Out of service" count={grouped.out_of_service.length} accent="neutral" sub="Parked. Not in operation.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {grouped.out_of_service.map(r => <VehicleCard key={r.u.id} row={r} onOpen={() => onOpenUnit(r.u.id)} />)}
            </div>
          </Section>
        )}

        {filtered.length === 0 && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--fg-muted)", border: "1px dashed var(--border)", borderRadius: 4 }}>
            No vehicles match the current filter.
          </div>
        )}
      </div>
    </div>
  );
};

function HeroCounterV({ label, value, sub, tone = "muted", divider }) {
  const tones = { muted: "#fff", ok: "#7DD3A8", accent: "var(--accent-500)" };
  return (
    <div style={{ padding: "14px 18px", borderLeft: divider ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
      <div style={{ font: "600 10px/1 var(--font-sans)", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>{label}</div>
      <div style={{ font: "700 30px/1.05 var(--font-display)", color: tones[tone], marginTop: 8, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ font: "11.5px/1.3 var(--font-sans)", color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function VehicleCard({ row, onOpen }) {
  const { u, meta, status, lastTrip, drovToday, week, maxKm, soonest, expiryWarn } = row;
  const statusBadge =
    status === "in_service" ? { tone: "ok", label: "In service" } :
    status === "maintenance" ? { tone: "warn", label: "Maintenance" } :
    { tone: "neutral", label: "Out of service" };
  // Most-recent driver on this unit. When drovToday is true, lastTrip is
  // already today's trip (sort order is date desc, end_min desc), so the
  // same driver_name covers both labels.
  const lastDriver = (lastTrip && lastTrip.driver_name) ? lastTrip.driver_name : "";
  const lastActivityLabel = drovToday
    ? (lastDriver ? `Driving today, ${lastDriver}` : "Driving today")
    : (lastTrip
        ? (lastDriver ? `Last drove ${lastTrip.date}, ${lastDriver}` : `Last drove ${lastTrip.date}`)
        : "No recorded activity");
  return (
    <div onClick={onOpen} className="nf-card" style={{
      border: "1px solid var(--border)", borderRadius: 4, background: "var(--white)",
      padding: 14, cursor: "pointer", display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {u.photo && (
          <div style={{ width: 72, height: 56, borderRadius: 3, overflow: "hidden", border: "1px solid var(--border)", flex: "0 0 72px", background: "var(--steel-100)" }}>
            <img src={u.photo} alt={u.id} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <div style={{ font: "700 18px/1.1 var(--font-display)", color: "var(--navy-900)", letterSpacing: "-0.005em" }}>{u.id}</div>
              <div style={{ font: "12px/1.3 var(--font-sans)", color: "var(--fg-subtle)", marginTop: 2 }}>
                {u.year} {u.make} {u.model}
              </div>
            </div>
            <Pill tone={statusBadge.tone}>{statusBadge.label}</Pill>
          </div>
          <div style={{ font: "11.5px/1.3 var(--font-sans)", color: "var(--fg-muted)", marginTop: 6 }}>
            {u.klass === "heavy" ? "Heavy" : "Light"} ({u.gvw_kg.toLocaleString()} kg GVW)
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--rule)", paddingTop: 8 }}>
        <div style={{ font: "11.5px var(--font-sans)", color: "var(--fg-subtle)" }}>{lastActivityLabel}</div>
        <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 18 }}>
          {week.map(w => (
            <div key={w.iso} title={`${w.iso}: ${w.km.toFixed(1)} km`} style={{
              width: 5,
              height: w.km > 0 ? Math.max(3, (w.km / maxKm) * 18) : 2,
              background: w.km > 0 ? "var(--accent-500)" : "var(--border)",
              borderRadius: 1,
            }} />
          ))}
        </div>
      </div>

      {expiryWarn && (
        <div style={{ font: "11px var(--font-sans)", color: "var(--accent-700)", fontWeight: 600, padding: "4px 8px", background: "var(--accent-100)", borderRadius: 3 }}>
          Compliance date expiring in {soonest} day{soonest === 1 ? "" : "s"}
        </div>
      )}

      {meta.status_note && (
        <div style={{ font: "11px var(--font-sans)", color: "var(--fg-muted)", fontStyle: "italic" }}>
          {meta.status_note}
        </div>
      )}
    </div>
  );
}

window.VehicleList = VehicleList;
