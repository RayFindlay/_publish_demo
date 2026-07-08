// Persistent local state, manager annotations + verified stamps + cycle math.
// Pure JS, exposed on window.NORFAB_LOCAL. Plain localStorage now;
// VSC Claude can swap for SharePoint/SQL/etc later without touching UI code.
(function () {
  const NS = "norfab.v1.";

  function read(k, fallback) {
    try { const v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function write(k, v) {
    try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {}
    window.dispatchEvent(new CustomEvent("nf-local-change", { detail: { key: k } }));
  }

  // ---- Annotations: per driver-day ----
  // Shape: { text: string, by: string, at: ISO }
  function annKey(driverId, dayISO) { return `ann.${driverId}.${dayISO}`; }
  function getAnnotation(driverId, dayISO) { return read(annKey(driverId, dayISO), null); }
  function setAnnotation(driverId, dayISO, text, by = "NF") {
    if (!text || !text.trim()) { localStorage.removeItem(NS + annKey(driverId, dayISO));
      window.dispatchEvent(new CustomEvent("nf-local-change", { detail: { key: "ann" } }));
      return null; }
    const rec = { text: text.trim(), by, at: new Date().toISOString() };
    write(annKey(driverId, dayISO), rec);
    return rec;
  }

  // ---- Verified-by stamp: per driver-month ----
  function verKey(driverId, ym) { return `ver.${driverId}.${ym}`; }
  function getVerified(driverId, year, month) {
    const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
    return read(verKey(driverId, ym), null);
  }
  function setVerified(driverId, year, month, by = "NF") {
    const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
    const rec = { by, at: new Date().toISOString() };
    write(verKey(driverId, ym), rec);
    return rec;
  }

  // ---- Cycle math: rolling on-duty for proximity warnings ----
  // Cycle 1 = 70h / 7 days; Cycle 2 = 120h / 14 days.
  function cycleUsage(driverId, todayISO, days = 7) {
    const D = window.NORFAB_DATA;
    const end = new Date(todayISO + "T12:00Z");
    let total = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(end); d.setUTCDate(end.getUTCDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const c = D.dayCompliance(driverId, iso);
      total += c.onduty_hrs || 0;
    }
    return total;
  }

  function proximityWarning(driverId, todayISO) {
    const D = window.NORFAB_DATA;
    const u = D.UNITS.find(x => x.id === D.DRIVERS.find(d => d.id === driverId).unit);
    if (u.klass !== "heavy") return null; // light vehicles aren't cycle-bound
    const c1 = cycleUsage(driverId, todayISO, 7);
    if (c1 >= 70) return { level: "over", label: "Cycle 1 limit reached", used: c1, limit: 70 };
    if (c1 >= 62) return { level: "warn", label: `${(70 - c1).toFixed(1)}h to Cycle 1 limit`, used: c1, limit: 70 };
    return null;
  }

  // ---- Glossary ----
  const GLOSSARY = {
    NSC:   "National Safety Code, Canada's federal motor carrier safety framework. Carrier ID and audit obligation.",
    SFC:   "Safety Fitness Certificate, Alberta document certifying the carrier's NSC profile.",
    DVIR:  "Driver Vehicle Inspection Report, required pre-trip and post-trip vehicle inspection record.",
    GVW:   "Gross Vehicle Weight, manufacturer-rated maximum loaded weight (kg). 11,794 kg is the threshold for full daily-log requirements.",
    PPB:   "Principal Place of Business, the registered home terminal (Cascade Freight: 16425 130 Ave NW, Edmonton).",
    HOS:   "Hours of Service, Canadian commercial driver duty time regulations.",
    PPE:   "Personal Protective Equipment.",
    "160 km": "The Alberta exemption radius: short-haul drivers operating within 160 km of the home terminal AND returning the same day need not keep a full daily log.",
    "1.5 km": "Cascade Freight internal terminal-return tolerance: a trip is considered 'returned' if it ends within 1.5 km of the PPB.",
    "Cycle 1": "70 hours of on-duty time per 7-day rolling period.",
    "Cycle 2": "120 hours of on-duty time per 14-day rolling period.",
  };

  // ---- URL state ----
  // Hash format:
  //   #fleet | #driver/<id> | #day/<id>/<iso> | #unit/<id>
  //   #audit | #dashboard | #vehicles | #expiries
  //   #maintenance | #maintenance/vehicle/<id>
  function routeToHash(r) {
    if (!r) return "#";
    if (r.name === "fleet") return "#";
    if (r.name === "driver") return `#driver/${r.driverId}`;
    if (r.name === "day") return `#day/${r.driverId}/${r.dayISO}`;
    if (r.name === "unit") return `#unit/${r.unitId}`;
    if (r.name === "audit") return "#audit";
    if (r.name === "dashboard") return "#dashboard";
    if (r.name === "trip-detail") return `#trip/${r.unitId}/${r.dayISO}`;
    if (r.name === "vehicles") return "#vehicles";
    if (r.name === "expiries") return "#expiries";
    if (r.name === "maintenance") return r.unitId ? `#maintenance/vehicle/${r.unitId}` : "#maintenance";
    return "#";
  }
  function hashToRoute(h) {
    h = (h || "").replace(/^#/, "");
    if (!h) return { name: "fleet" };
    const [head, a, b] = h.split("/");
    if (head === "driver" && a) return { name: "driver", driverId: a };
    if (head === "day" && a && b) return { name: "day", driverId: a, dayISO: b };
    if (head === "unit" && a) return { name: "unit", unitId: a };
    if (head === "trip" && a && b) return { name: "trip-detail", unitId: a, dayISO: b };
    if (head === "audit") return { name: "audit" };
    if (head === "dashboard") return { name: "dashboard" };
    if (head === "vehicles") return { name: "vehicles" };
    if (head === "expiries") return { name: "expiries" };
    if (head === "maintenance") {
      if (a === "vehicle" && b) return { name: "maintenance", unitId: b };
      return { name: "maintenance" };
    }
    return { name: "fleet" };
  }

  window.NORFAB_LOCAL = {
    getAnnotation, setAnnotation, getVerified, setVerified,
    cycleUsage, proximityWarning, GLOSSARY,
    routeToHash, hashToRoute,
  };
})();
