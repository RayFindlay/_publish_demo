// App shell, wires routes/screens together with shared state.

const { useState: useStateApp, useEffect: useEffectApp } = React;

// Format an ISO sync timestamp into a short local-time string. Returns
// "pending" if the value is missing so the UI never shows a fake time.
function formatSyncTime(iso) {
  if (!iso) return "pending";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "pending";
  // e.g. "14:32 MDT" (24-h) with the user's local time zone abbreviation.
  const time = d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
  const tz = (d.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop()) || "";
  return tz ? `${time} ${tz}` : time;
}
// Same idea, longer form for the hero subtext.
function formatSyncTimeLong(iso) {
  if (!iso) return "pending";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "pending";
  const time = d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false });
  const tz = (d.toLocaleTimeString("en-US", { timeZoneName: "short" }).split(" ").pop()) || "";
  const sameDay = d.toDateString() === new Date().toDateString();
  if (sameDay) return tz ? `${time} ${tz}` : time;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return tz ? `${date} ${time} ${tz}` : `${date} ${time}`;
}
window.formatSyncTime = formatSyncTime;
window.formatSyncTimeLong = formatSyncTimeLong;

const TWEAKS = /*EDITMODE-BEGIN*/{
  "showFleetSummary": true,
  "compactCalendar": false
}/*EDITMODE-END*/;

function App() {
  const [state, setState] = useStateApp(() => {
    // Default to the CURRENT month in Mountain time, not a hardcoded snapshot.
    // localTodayISO returns "YYYY-MM-DD" anchored to America/Edmonton, so the
    // calendar opens on "today" regardless of when this file was last touched.
    const [ty, tm] = window.NORFAB_DATA.localTodayISO().split("-").map(Number);
    return {
      unitId: "ALL",
      weightFilter: "all", // all | heavy | light (defaults to "all" so first impression isn't filtered)
      year: ty,
      month: tm - 1, // JS months are 0-indexed
      includeMinor: false,
    };
  });
  // Feature #2, deep-linkable URLs. Init from hash; sync on change.
  const initial = window.NORFAB_LOCAL.hashToRoute(window.location.hash);
  const [route, setRoute] = useStateApp(initial);
  const [modal, setModal] = useStateApp(null); // {kind: 'daily-log', unitId, dayISO}
  const [toast, setToast] = useStateApp(null);
  // Feature #1, command palette
  const [paletteOpen, setPaletteOpen] = useStateApp(false);
  // Bumps when data.js polls and gets fresh JSON. Forces the React tree
  // to re-render so children re-read window.NORFAB_DATA from their
  // function bodies and pick up the new numbers. Without this, only a
  // browser refresh would pull new pipeline output.
  const [refreshTick, setRefreshTick] = useStateApp(0);

  useEffectApp(() => {
    const onRefresh = () => setRefreshTick(t => t + 1);
    window.addEventListener("nf-data-refreshed", onRefresh);
    return () => window.removeEventListener("nf-data-refreshed", onRefresh);
  }, []);

  useEffectApp(() => {
    const desired = window.NORFAB_LOCAL.routeToHash(route);
    if (window.location.hash !== desired) {
      // pushState (not replaceState) so every screen becomes a history
      // entry — this is what makes the browser back button and the app's
      // "Back" buttons actually return to the previous screen. The one
      // exception: landing on the default route with no hash yet; replace
      // so back doesn't dead-end on a hashless duplicate of the same page.
      if (!window.location.hash && route.name === "fleet") {
        window.history.replaceState(null, "", desired || "#");
      } else {
        window.history.pushState(null, "", desired || "#");
      }
    }
  }, [route]);

  useEffectApp(() => {
    const onPop = () => setRoute(window.NORFAB_LOCAL.hashToRoute(window.location.hash));
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    // The TopBar Search button dispatches this custom event; without the
    // listener the button silently does nothing (only Ctrl/Cmd+K worked).
    const onOpenPalette = () => setPaletteOpen(true);
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    window.addEventListener("keydown", onKey);
    window.addEventListener("nf-open-palette", onOpenPalette);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("nf-open-palette", onOpenPalette);
    };
  }, []);

  const navigate = (name, params = {}) => {
    if (name === "daily-log") { setModal({ kind: "daily-log", ...params }); return; }
    setRoute({ name, ...params });
  };

  // Back = browser back, so the screen the user actually came from is
  // restored (routes live in the URL hash). Falls back to the fleet
  // overview when this tab has no history, e.g. a pasted deep link.
  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else setRoute({ name: "fleet" });
  };

  const copyLink = async (drv) => {
    const url = window.NORFAB_DATA.roadsideUrl(drv.id);
    try {
      await navigator.clipboard.writeText(url);
      setToast(`Copied · ${drv.name.split(" ")[0]}'s roadside link`);
    } catch (e) {
      setToast(`Copy failed, ${url}`);
    }
    setTimeout(() => setToast(null), 2400);
  };

  // Tweaks panel
  const [tweaks, setTweak] = window.useTweaks ? window.useTweaks(TWEAKS) : [TWEAKS, () => {}];

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <TopBar route={route} onHome={() => setRoute({ name: "fleet" })} onOpenAudit={() => setRoute({ name: "audit" })} />
      <TabNav route={route} setRoute={setRoute} />
      <div key={route.name + (route.driverId || route.unitId || route.dayISO || "")} className="nf-route" style={{ flex: 1, minHeight: 0, overflowY: "scroll", scrollbarGutter: "stable" }}>
        {route.name === "fleet" && (
          <FleetOverview
            onOpenDriver={(id) => setRoute({ name: "driver", driverId: id })}
            onOpenDay={(id, iso) => setRoute({ name: "day", driverId: id, dayISO: iso })}
            onOpenAudit={() => setRoute({ name: "audit" })}
            onOpenVehicles={() => setRoute({ name: "vehicles" })}
            onOpenExpiries={() => setRoute({ name: "expiries" })}
            onCopyLink={copyLink}
          />
        )}
        {route.name === "driver" && (
          <DriverDetail driverId={route.driverId}
            onClose={() => setRoute({ name: "fleet" })}
            onOpenDay={(id, iso) => setRoute({ name: "day", driverId: id, dayISO: iso })}
            onCopyLink={copyLink} />
        )}
        {route.name === "day" && (
          <DayDetail driverId={route.driverId} dayISO={route.dayISO}
            onClose={() => setRoute({ name: "driver", driverId: route.driverId })} />
        )}
        {route.name === "dashboard" && (
          <Dashboard state={state} setState={setState} onNavigate={navigate} />
        )}
        {route.name === "trip-detail" && (
          <TripDetail unitId={route.unitId} dayISO={route.dayISO}
            onClose={goBack}
            onPrint={() => navigate("daily-log", { unitId: route.unitId, dayISO: route.dayISO })} />
        )}
        {route.name === "unit" && (
          <UnitDetail unitId={route.unitId}
            onClose={goBack}
            onOpenDay={(iso) => setRoute({ name: "trip-detail", unitId: route.unitId, dayISO: iso })} />
        )}
        {route.name === "daily-log-list" && (
          <LogsList state={state} dayFilter={route.dayISO}
            onClose={goBack}
            onOpenLog={(uid, iso) => navigate("daily-log", { unitId: uid, dayISO: iso })} />
        )}
        {route.name === "audit" && (
          <AuditExport unitId={state.unitId} year={state.year} month={state.month}
            weightFilter={state.weightFilter}
            onClose={goBack} />
        )}
        {route.name === "vehicles" && window.VehicleList && (
          <window.VehicleList
            onOpenUnit={(uid) => setRoute({ name: "unit", unitId: uid })}
            onBack={() => setRoute({ name: "fleet" })} />
        )}
        {route.name === "expiries" && window.Expiries && (
          <window.Expiries
            onOpenUnit={(uid) => setRoute({ name: "unit", unitId: uid })}
            onOpenDriver={(did) => setRoute({ name: "driver", driverId: did })}
            onBack={() => setRoute({ name: "fleet" })} />
        )}
        {route.name === "maintenance" && window.Maintenance && (
          <window.Maintenance
            unitId={route.unitId}
            onExitDeepView={() => setRoute({ name: "maintenance" })}
            onOpenDeepView={(uid) => setRoute({ name: "maintenance", unitId: uid })}
            onOpenUnit={(uid) => setRoute({ name: "unit", unitId: uid })}
            onOpenDriver={(did) => setRoute({ name: "driver", driverId: did })} />
        )}
      </div>

      {modal && modal.kind === "daily-log" && (
        <DailyLog unitId={modal.unitId} dayISO={modal.dayISO} onClose={() => setModal(null)} />
      )}

      {window.CommandPalette && (
        <window.CommandPalette open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNavigate={(r) => setRoute(r)} />
      )}

      {toast && (
        <div className="nf-toast" style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--navy-900)", color: "#fff",
          padding: "10px 16px", borderRadius: 4,
          font: "600 13px var(--font-sans)",
          boxShadow: "0 6px 18px rgba(17,36,54,0.18)",
          zIndex: 200,
        }}>{toast}</div>
      )}

      {window.TweaksPanel && (
        <window.TweaksPanel title="Tweaks">
          <window.TweakSection title="Layout">
            <window.TweakToggle label="Fleet summary strip"
              value={tweaks.showFleetSummary} onChange={v => setTweak("showFleetSummary", v)} />
            <window.TweakToggle label="Compact calendar"
              value={tweaks.compactCalendar} onChange={v => setTweak("compactCalendar", v)} />
          </window.TweakSection>
        </window.TweaksPanel>
      )}
    </div>
  );
}

// ---------- Primary tab navigation ----------
// Sits between the navy top bar and the section's hero. Highlights the
// section that's currently active (including when on a sub-screen like
// Unit Detail or Driver Detail, where the parent section's tab stays lit).
// Tab label vs internal route-name mapping (labels changed, routes stable
// to preserve URL hashes and deep links):
//   route "fleet"       -> tab labelled "Drivers"  (driver-centric overview)
//   route "vehicles"    -> tab labelled "Fleet"    (unit-centric overview)
//   route "maintenance" -> tab labelled "Maintenance" (schedule + log + expiries)
//   route "audit"       -> no tab, lives as a top-bar button now
function activeTabFor(routeName) {
  if (routeName === "vehicles" || routeName === "unit") return "vehicles";
  if (routeName === "maintenance" || routeName === "expiries") return "maintenance";
  return "fleet"; // fleet + driver + day + trip-detail + daily-log-list + dashboard + audit-as-overlay
}

function TabNav({ route, setRoute }) {
  const active = activeTabFor(route.name);
  const tabs = [
    { id: "fleet",       label: "Drivers",     target: { name: "fleet" } },
    { id: "vehicles",    label: "Fleet",       target: { name: "vehicles" } },
    { id: "maintenance", label: "Maintenance", target: { name: "maintenance" } },
  ];
  return (
    <div style={{
      background: "var(--white)",
      borderBottom: "1px solid var(--border)",
      padding: "0 24px",
      display: "flex",
      gap: 4,
    }}>
      {tabs.map(t => {
        const isActive = active === t.id;
        return (
          <button key={t.id} onClick={() => setRoute(t.target)} style={{
            background: "transparent",
            border: "none",
            padding: "12px 16px 10px",
            borderBottom: isActive ? "2px solid var(--accent-500)" : "2px solid transparent",
            color: isActive ? "var(--navy-900)" : "var(--fg-muted)",
            font: isActive ? "600 13px var(--font-sans)" : "500 13px var(--font-sans)",
            cursor: "pointer",
            letterSpacing: "0.005em",
          }}
          onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = "var(--navy-800)"; }}
          onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = "var(--fg-muted)"; }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Top bar ----------
function TopBar({ route, onHome, onOpenAudit }) {
  const crumbs = (() => {
    if (route.name === "fleet") return ["Drivers"];
    if (route.name === "driver") {
      const d = window.NORFAB_DATA.DRIVERS.find(x => x.id === route.driverId);
      return ["Drivers", d ? d.name : route.driverId];
    }
    if (route.name === "day") {
      const d = window.NORFAB_DATA.DRIVERS.find(x => x.id === route.driverId);
      return ["Drivers", d ? d.name : route.driverId, route.dayISO];
    }
    if (route.name === "dashboard") return ["Drivers", "Legacy dashboard"];
    if (route.name === "trip-detail") return ["Drivers", `${route.unitId}`, `${route.dayISO}`];
    if (route.name === "unit") return ["Fleet", `Unit ${route.unitId}`];
    if (route.name === "daily-log-list") return ["Drivers", "Driver logs"];
    if (route.name === "audit") return ["NSC audit export"];
    if (route.name === "vehicles") return ["Fleet"];
    if (route.name === "maintenance") return route.unitId ? ["Maintenance", route.unitId] : ["Maintenance"];
    if (route.name === "expiries") return ["Maintenance", "Expiries"];
    return ["Drivers"];
  })();
  return (
    <header style={{
      height: 56, padding: "0 20px",
      background: "var(--navy-900)",
      color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: "1px solid #000",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={onHome} style={{
          background: "transparent", border: "none", padding: 0, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <img src="assets/logo-nfm-white.png" style={{ height: 24 }} alt="Cascade Freight" />
        </button>
        <nav style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4, font: "13px var(--font-sans)" }}>
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: "rgba(255,255,255,0.4)" }}>/</span>}
              <span style={{ color: i === crumbs.length - 1 ? "#fff" : "rgba(255,255,255,0.65)", fontWeight: i === crumbs.length - 1 ? 600 : 400 }}>{c}</span>
            </React.Fragment>
          ))}
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button onClick={() => window.dispatchEvent(new CustomEvent("nf-open-palette"))}
          title="Search (Cmd/Ctrl + K)"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.16)",
            color: "rgba(255,255,255,0.85)", padding: "4px 8px 4px 10px", borderRadius: 3,
            font: "12.5px var(--font-sans)", cursor: "pointer",
          }}>
          <Icon name="search" size={12} /> Search
          <kbd style={{ font: "600 10px/1 var(--font-mono)", background: "rgba(255,255,255,0.12)", color: "#fff", padding: "2px 5px", borderRadius: 2 }}>⌘K</kbd>
        </button>
        <button onClick={onOpenAudit}
          title="Open the NSC audit export packet"
          style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            background: "var(--accent-600)", border: "1px solid var(--accent-700)",
            color: "#fff", padding: "5px 12px", borderRadius: 3,
            font: "600 12.5px var(--font-sans)", cursor: "pointer",
          }}>
          <Icon name="file-text" size={12} /> NSC Audit Export
        </button>
        <SfcChip />
        <HeartbeatIndicator />
        <div
          title="Auto-refreshes every 5 minutes while this tab is active. Shows the time the pipeline last published new data."
          style={{ font: "12.5px var(--font-sans)", color: "rgba(255,255,255,0.75)" }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>Synced</span> {formatSyncTime(window.NORFAB_DATA && window.NORFAB_DATA.LATEST_SYNC_UTC)}
        </div>
      </div>
    </header>
  );
}

// Stale-pipeline heartbeat. The pipeline depends on a GitHub Actions cron
// (dropbox-sync.yml, '7 * * * *') which sometimes silently skips runs
// during GitHub platform incidents. When that happens, new Titan/SiteDocs
// files accumulate in Dropbox but never make it into the dashboard.
//
// This component watches LATEST_SYNC_UTC against wall-clock and surfaces
// a manual-recovery button when sync is stale during Titan's delivery
// window (6am-6pm Mountain, hourly on the hour). Clicking opens the
// GitHub Actions UI for the Dropbox Sync workflow where Ray can press
// "Run workflow" to force a sync.
//
// Threshold: 90 min during work hours. Titan delivers hourly so any gap
// over ~70 min is suspicious; 90 absorbs normal pipeline latency.
//
// Permanent fix tracked in memory/project_pending_cloudflare_cron.md.
function HeartbeatIndicator() {
  const [now, setNow] = useStateApp(Date.now());
  useEffectApp(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  const syncUtc = window.NORFAB_DATA && window.NORFAB_DATA.LATEST_SYNC_UTC;
  if (!syncUtc) return null;
  const syncMs = new Date(syncUtc).getTime();
  if (!Number.isFinite(syncMs)) return null;
  const minutesSinceSync = (now - syncMs) / 60000;

  // Are we currently in Titan's delivery window (6am - 6pm Mountain)?
  // The pipeline can legitimately go quiet overnight, so suppress the
  // warning outside delivery hours to avoid alarming Ray at 11pm.
  const mountainHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/Edmonton", hour: "numeric", hour12: false }),
    10,
  );
  const inDeliveryWindow = mountainHour >= 6 && mountainHour < 19;
  const isStale = inDeliveryWindow && minutesSinceSync > 90;

  if (!isStale) return null;

  const workflowUrl = "https://github.com/RayFindlay/SFC-Automation-Project/actions/workflows/dropbox-sync.yml";
  const minutesText = minutesSinceSync >= 60
    ? `${Math.floor(minutesSinceSync / 60)}h ${Math.floor(minutesSinceSync % 60)}m ago`
    : `${Math.floor(minutesSinceSync)}m ago`;

  return (
    <a
      href={workflowUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`Pipeline last published ${minutesText}. Click to open the Dropbox Sync workflow on GitHub, then press "Run workflow" to force a refresh.`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        background: "var(--accent-600)", border: "1px solid var(--accent-700)",
        color: "#fff", padding: "5px 12px", borderRadius: 3,
        font: "600 12px var(--font-sans)", textDecoration: "none",
        letterSpacing: "0.02em",
      }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: "#fff", display: "inline-block",
        animation: "nf-pulse 1.4s ease-in-out infinite",
      }} />
      Stale {minutesText} · run sync ↗
    </a>
  );
}

function SfcChip() {
  // Both text spans pin line-height to 12px so the bolder SFC code and
  // the lighter validity tail share the same line-box, avoiding the
  // subpixel rounding drift that made the original look off-baseline.
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.16)",
      padding: "5px 10px", borderRadius: 3,
      lineHeight: 1,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--ok)", flexShrink: 0, display: "block" }} />
      <span style={{ font: "600 11px/12px var(--font-sans)", letterSpacing: "0.06em", color: "#fff" }}>SFC AB-NSC-013-2241</span>
      <span style={{ font: "500 11px/12px var(--font-sans)", color: "rgba(255,255,255,0.55)", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ display: "inline-block", width: 2, height: 2, borderRadius: 999, background: "rgba(255,255,255,0.4)", flexShrink: 0 }} />
        valid to 2028-11-30
      </span>
    </div>
  );
}

// Wait for the real-data adapter to finish loading latest.json + the registry
// before mounting React. Without this, the first render would see empty arrays
// and the route never re-renders because the design only rekeys on route change.
function NF_bootstrap() {
  ReactDOM.createRoot(document.getElementById("root")).render(<App />);
}
if (window.NORFAB_DATA && window.NORFAB_DATA.ready) {
  NF_bootstrap();
} else {
  window.addEventListener("nf-data-ready", NF_bootstrap, { once: true });
  // Belt-and-braces fallback: never block forever if the data fetch errors out.
  setTimeout(() => { if (!window.__nfMounted) { window.__nfMounted = true; NF_bootstrap(); } }, 6000);
  window.addEventListener("nf-data-ready", () => { window.__nfMounted = true; }, { once: true });
}
