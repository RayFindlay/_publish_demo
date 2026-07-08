// Cascade Freight, Driver roadside phone view
// One scroll. Officer-friendly. Big type, single status answer, last-14-days strip.

const { useState: useStatePV, useMemo: useMemoPV } = React;

// ---------- design tokens (phone-scoped, slightly larger than desktop) ----------
const PV = {
  navy: "#112436",
  navyDeep: "#0B1A2A",
  steel900: "#1A1F24",
  steel700: "#3A434D",
  steel500: "#6B7682",
  steel300: "#B7BEC6",
  steel200: "#D4D9DE",
  steel100: "#E7EAEE",
  steel50:  "#F3F5F7",
  paper:    "#FAFBFC",
  white:    "#FFFFFF",
  exempt:   "#1F7A4F",
  exemptBg: "#E7F2EC",
  exemptBd: "#BFD9CC",
  log:      "#1B324A",
  logBg:    "#EAF1F7",
  logBd:    "#C7D2DD",
  flag:     "#B23A0E",
  flagBg:   "#FCEDE3",
  flagBd:   "#F1C6AB",
};

const fontStack = '"Aptos","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif';
const displayStack = '"Aptos Display","Aptos",sans-serif';

// ---------- design tokens (single source of truth for the whole phone view)
// Spacing scale, every padding/margin uses one of these so the page has
// consistent vertical rhythm. Don't introduce ad-hoc values like 14 or 22.
const S = { xs: 4, sm: 8, md: 12, lg: 18, xl: 24, xxl: 32 };
// Radius scale, sm for badges/chips, md for cards/buttons, pill for full-round
const R = { sm: 4, md: 6, pill: 999 };
// Type scale, every font-size comes from here
const F = { caption: 11, micro: 10, body: 13, bodyLg: 14, h6: 16, h5: 18, h4: 22, h3: 26, h2: 30 };
// Page horizontal padding (kept on the page, not inside cards)
const PAGE_X = S.lg;
// Section spacing (gap between modules)
const SECTION_Y = S.lg;

// ---------- helpers ----------
const fmtDate = (iso, opts = {}) => {
  const d = new Date(iso + "T12:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...opts });
};
const fmtDateLong = (iso) => {
  const d = new Date(iso + "T12:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
};
const dayShort = (iso) => new Date(iso + "T12:00").toLocaleDateString("en-US", { weekday: "short" })[0];
const dayNum = (iso) => new Date(iso + "T12:00").getDate();
const monthShort = (iso) => new Date(iso + "T12:00").toLocaleDateString("en-US", { month: "short" }).toUpperCase();
// Distinct unit IDs actually used on this day, from pre/post DVIR + trips.
// Returns [] when no activity. Order matches chronology (pre, then trips
// in time order, then post) so the "first unit driven today" is at [0].
function unitsUsedOnDay(comp) {
  const seen = new Set();
  const out = [];
  const add = (u) => { if (u && !seen.has(u)) { seen.add(u); out.push(u); } };
  if (comp && comp.pre) add(comp.pre.unit);
  if (comp && comp.dayTrips) for (const t of comp.dayTrips) add(t.unit);
  if (comp && comp.post) add(comp.post.unit);
  return out;
}
const isoNDaysAgo = (iso, n) => {
  const d = new Date(iso + "T12:00");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// ---------- atoms ----------
function Eyebrow({ children, style }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, letterSpacing: "0.14em",
      textTransform: "uppercase", color: PV.steel500, ...style,
    }}>{children}</div>
  );
}

function Divider({ inset = 16 }) {
  return <div style={{ height: 1, background: PV.steel100, margin: `0 ${inset}px` }} />;
}

// Section: wraps every module with the same horizontal padding and bottom
// spacing. Modules NEVER set their own outer padding, they live inside a
// Section so the page has consistent rhythm. `inset={false}` for modules
// that want to bleed edge-to-edge (e.g. the photo banner, the 14-day strip
// that scrolls horizontally).
function Section({ children, label, inset = true, pb = SECTION_Y }) {
  return (
    <div style={{ padding: inset ? `0 ${PAGE_X}px ${pb}px` : `0 0 ${pb}px` }}>
      {label && (
        <div style={{ padding: inset ? 0 : `0 ${PAGE_X}px`, marginBottom: S.sm }}>
          <Eyebrow>{label}</Eyebrow>
        </div>
      )}
      {children}
    </div>
  );
}

// Card: the one and only card surface. White bg, steel200 border, R.md
// radius. `tone` adds a left-edge accent stripe for status surfaces (the
// only place pastels live, semantic compliance state, not decoration).
function Card({ tone = null, children, padding = S.md + 2, style }) {
  const accent = tone === "exempt" ? { bg: PV.exemptBg, bd: PV.exemptBd, fg: PV.exempt }
              : tone === "log"     ? { bg: PV.logBg,    bd: PV.logBd,    fg: PV.log }
              : tone === "flag"    ? { bg: PV.flagBg,   bd: PV.flagBd,   fg: PV.flag }
              : null;
  return (
    <div style={{
      background: accent ? accent.bg : PV.white,
      border: `1px solid ${accent ? accent.bd : PV.steel200}`,
      borderLeft: accent ? `4px solid ${accent.fg}` : `1px solid ${accent ? accent.bd : PV.steel200}`,
      borderRadius: R.md, padding,
      overflow: "hidden",
      ...style,
    }}>{children}</div>
  );
}

// Badge: small uppercase label. ONE shape (R.sm rounded rectangle), ONE
// size. Used for the unit ID chip, the PDF prefix, the day-strip status
// letter, the trip distance flag. `solid` = filled (for emphasis),
// `outline` = thin border only (for neutral context).
function Badge({ tone = "neutral", variant = "solid", children, style }) {
  const m = {
    navy:    { bg: PV.navyDeep, fg: PV.white, bd: PV.navyDeep },
    flag:    { bg: PV.flag,     fg: PV.white, bd: PV.flag },
    exempt:  { bg: PV.exempt,   fg: PV.white, bd: PV.exempt },
    neutral: { bg: PV.steel100, fg: PV.steel700, bd: PV.steel200 },
  }[tone] || { bg: PV.steel100, fg: PV.steel700, bd: PV.steel200 };
  const filled = variant === "solid";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: filled ? m.bg : "transparent",
      color: filled ? m.fg : m.bd,
      border: filled ? "none" : `1px solid ${m.bd}`,
      padding: "2px 6px", borderRadius: R.sm,
      fontSize: F.caption, fontWeight: 700, letterSpacing: 0.4,
      textTransform: "uppercase", fontFamily: fontStack,
      whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
      ...style,
    }}>{children}</span>
  );
}

function Pill({ tone = "neutral", children }) {
  const m = {
    exempt: { bg: PV.exemptBg, bd: PV.exemptBd, fg: PV.exempt },
    log:    { bg: PV.logBg,    bd: PV.logBd,    fg: PV.log },
    flag:   { bg: PV.flagBg,   bd: PV.flagBd,   fg: PV.flag },
    neutral:{ bg: PV.steel50,  bd: PV.steel200, fg: PV.steel700 },
  }[tone];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: m.bg, color: m.fg, border: `1px solid ${m.bd}`,
      borderRadius: 3, padding: "4px 10px", fontSize: 12, fontWeight: 600,
      letterSpacing: 0.2,
    }}>{children}</span>
  );
}

function Check({ ok = true, color }) {
  const c = color || (ok ? PV.exempt : PV.flag);
  return ok ? (
    <svg width="18" height="18" viewBox="0 0 20 20" style={{ flex: "none" }}>
      <circle cx="10" cy="10" r="9" fill={c} />
      <path d="M5.5 10.2l3 3 6-6.5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 20 20" style={{ flex: "none" }}>
      <circle cx="10" cy="10" r="9" fill={c} />
      <path d="M6.5 6.5l7 7M13.5 6.5l-7 7" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ---------- top brand bar ----------
function BrandBar({ onBack = null }) {
  const { SFC } = window.NORFAB_DATA;
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 10,
      background: PV.navyDeep, color: PV.white,
      // Safe-area-aware top padding so the navy bg extends into the
      // phone's status bar / notch area when added to home screen.
      // In a regular browser tab safe-area inset is 0, so this collapses
      // to the standard 12px header padding.
      paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
      paddingBottom: 12,
      paddingLeft: 18,
      paddingRight: 18,
      borderBottom: `3px solid ${PV.flag}`,
      display: "flex", alignItems: "center", gap: 12,
      cursor: onBack ? "pointer" : "default",
    }} onClick={onBack || undefined} role={onBack ? "button" : undefined} aria-label={onBack ? "Back to daily logs" : undefined}>
      {/* Real CFI-yard logo (white version for the navy banner). The whole banner
          is the back-to-home affordance when onBack is set, no separate
          chevron/arrow needed. Matches the dashboard's top bar. */}
      <img
        src="assets/logo-nfm-white.png"
        alt="Cascade Freight"
        style={{ height: 36, width: "auto", display: "block", flexShrink: 0 }}
        onError={(e) => {
          // Fallback to the white "N" tile if the image is missing or fails
          // to load (e.g. stale Pages deploy), keeps the banner readable.
          const node = e.currentTarget;
          node.style.display = "none";
          if (node.parentNode && !node.parentNode.querySelector(".nfm-logo-fallback")) {
            const fb = document.createElement("div");
            fb.className = "nfm-logo-fallback";
            fb.textContent = "CFI";
            fb.style.cssText = "width:48px;height:36px;border-radius:4px;background:#fff;color:" + PV.navyDeep + ";display:flex;align-items:center;justify-content:center;font-family:'Aptos Display','Aptos',sans-serif;font-weight:800;font-size:14px;letter-spacing:-0.5px;flex-shrink:0;";
            node.parentNode.insertBefore(fb, node);
          }
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: displayStack,
          fontWeight: 700, fontSize: F.h6 - 1, letterSpacing: 0, lineHeight: 1.1,
        }}>Cascade Freight Inc.</div>
        <div style={{ fontSize: F.caption, color: PV.steel300, letterSpacing: 0.4, marginTop: 2 }}>
          NSC {SFC.nsc} · Roadside compliance
        </div>
      </div>
    </div>
  );
}

// ---------- driver hero ----------
function DriverHero({ drv, unit, comp }) {
  const D = window.NORFAB_DATA;
  // Today's actual units (from today's pre/trips/post). If empty, we fall
  // back to drv.unit (the most recent unit driven across all data) with a
  // "Last driven" prefix so the hero doesn't claim a unit is in use today
  // when it isn't.
  const todayUnits = unitsUsedOnDay(comp);
  const todaysPrimaryId = todayUnits[0] || null;
  const todaysPrimary = todaysPrimaryId ? D.UNITS.find(u => u.id === todaysPrimaryId) : null;
  // Which unit to feature in the hero (photo + ID badge): today's primary
  // if there's activity today, otherwise the last-driven unit (drv.unit).
  const heroUnit = todaysPrimary || unit;
  const hasPhoto = !!(heroUnit && heroUnit.photo);
  return (
    <div style={{ background: PV.white }}>
      {/* Full-width hero photo, ~200px tall. Officers can identify the
          vehicle at a glance before reading anything. Falls back to a
          subtle gradient + unit ID badge when no photo is on file
          (currently FPT21 and FPT23). */}
      {hasPhoto ? (
        <div style={{
          position: "relative", width: "100%", height: 200,
          background: PV.navyDeep, overflow: "hidden",
        }}>
          <img
            src={heroUnit.photo}
            alt={`${heroUnit.id} ${heroUnit.year} ${heroUnit.make} ${heroUnit.model}`}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            style={{
              width: "100%", height: "100%", objectFit: "cover",
              objectPosition: "center",
              display: "block",
            }}
          />
          {/* Unit ID chip in the corner, quick visual cross-check that
              photo matches the displayed unit info. */}
          <div style={{ position: "absolute", top: S.sm + 2, left: S.sm + 2 }}>
            <Badge tone="neutral" variant="solid" style={{
              background: PV.white, color: PV.navyDeep, fontSize: F.body,
              padding: "5px 10px", letterSpacing: 0.5,
            }}>{heroUnit.id}</Badge>
          </div>
          {/* "Last driven" prefix when there's no activity today, keeps
              the hero honest about whether the displayed unit is current. */}
          {!todaysPrimary && (
            <div style={{ position: "absolute", top: S.sm + 2, right: S.sm + 2 }}>
              <Badge tone="neutral" variant="solid" style={{
                background: "rgba(11, 26, 42, 0.85)", color: PV.white,
                padding: "4px 8px", letterSpacing: 0.4,
              }}>LAST DRIVEN</Badge>
            </div>
          )}
        </div>
      ) : (
        // Empty-state passport frame: navy gradient + red accent stripe to
        // mirror the BrandBar's identity, instead of the pastel-gray
        // fallback that was drifting away from the Cascade Freight palette.
        <div style={{
          width: "100%", height: 140,
          background: `linear-gradient(135deg, ${PV.navy}, ${PV.navyDeep})`,
          borderBottom: `3px solid ${PV.flag}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: S.md + 2,
        }}>
          <Badge tone="neutral" variant="solid" style={{
            background: PV.white, color: PV.navyDeep, fontSize: F.h4,
            padding: "10px 16px", letterSpacing: 0.5,
          }}>{heroUnit ? heroUnit.id : "-"}</Badge>
          <div style={{ fontSize: F.body, color: PV.steel300, letterSpacing: 0.3 }}>
            {heroUnit ? `${heroUnit.year} ${heroUnit.make} ${heroUnit.model}` : "No assigned unit"}
          </div>
        </div>
      )}

      {/* Driver info block, below the hero photo */}
      <div style={{ padding: `${S.lg - 2}px ${S.lg}px ${S.md + 2}px` }}>
        <div style={{
          fontFamily: displayStack,
          fontSize: F.h4 + 2, fontWeight: 700, color: PV.navy, lineHeight: 1.1,
        }}>{drv.name}</div>
        <div style={{ fontSize: F.body, color: PV.steel500, marginTop: S.xs + 2, lineHeight: 1.45 }}>
          {!todaysPrimary && <span style={{ fontWeight: 600, color: PV.steel700 }}>Last driven · </span>}
          {heroUnit ? `${heroUnit.id} · ${heroUnit.year} ${heroUnit.make} ${heroUnit.model}` : "No assigned unit"}
          {heroUnit && Number.isFinite(heroUnit.gvw_kg) && (
            <span style={{ display: "block", marginTop: 2 }}>
              GVW {heroUnit.gvw_kg.toLocaleString()} kg · {heroUnit.klass === "heavy" ? "NSC time-record vehicle" : "Light vehicle"}
            </span>
          )}
          {/* Multi-vehicle today: surface the other unit(s), this can
              affect compliance interpretation (different GVW class). */}
          {todayUnits.length > 1 && (
            <span style={{ display: "block", marginTop: S.xs, fontWeight: 600, color: PV.flag }}>
              Multi-vehicle today: {todayUnits.join(" · ")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- the hero status card ----------
function StatusCard({ comp, today }) {
  const isExempt = comp.state === "exempt";
  const isFlagged = comp.reasons && comp.reasons.length > 0 && comp.state === "full-log";
  const tone = isFlagged ? "flag" : isExempt ? "exempt" : comp.state === "none" ? null : "log";
  const fg = isFlagged ? PV.flag : isExempt ? PV.exempt : comp.state === "none" ? PV.steel700 : PV.log;
  const headline = comp.state === "none" ? "No driving today"
                 : isExempt ? "Exempt"
                 : "Full daily log on file";
  return (
    <Section label={`Today · ${fmtDateLong(today)}`}>
      <Card tone={tone} padding={`${S.lg - 2}px ${S.lg}px`}>
        <div style={{
          fontFamily: displayStack,
          fontSize: F.h2, fontWeight: 700, color: fg, lineHeight: 1.05, letterSpacing: -0.3,
        }}>{headline}</div>
        <div style={{ fontSize: F.bodyLg, color: PV.steel700, marginTop: S.sm, lineHeight: 1.4 }}>
          {isExempt && (
            <>Daily log not required under <strong>NSC 76(2)(b)</strong>. All trips within 160 km radius of day-start, returned same day, ≥8 h off-duty.</>
          )}
          {comp.state === "full-log" && !isFlagged && (
            <>Required because at least one trip exceeded the 160 km exempt radius. Duty status reconstructed below.</>
          )}
          {isFlagged && (
            <>Full daily log applies. Reason: <strong>{comp.reasons[0]}</strong>.</>
          )}
          {comp.state === "none" && (
            <>This vehicle did not operate today. Last 14 days are below.</>
          )}
        </div>
      </Card>
    </Section>
  );
}

// ---------- today snapshot ----------
function TodaySnapshot({ comp, unit }) {
  if (comp.state === "none") return null;
  const stats = [
    { label: "Unit", value: unit.id, sub: `${unit.year} ${unit.make}` },
    { label: "Trips", value: comp.trips, sub: "today" },
    { label: "Distance", value: `${Math.round(comp.km)}`, sub: "km" },
    { label: "Drive time", value: comp.drive_hrs.toFixed(1), sub: "hours" },
  ];
  return (
    <Section label="Today's activity">
      <Card padding={0}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          {stats.map((s, i) => (
            <div key={s.label} style={{
              padding: `${S.md}px ${S.md + 2}px`,
              borderRight: (i % 2 === 0) ? `1px solid ${PV.steel100}` : "none",
              borderBottom: (i < 2) ? `1px solid ${PV.steel100}` : "none",
            }}>
              <div style={{
                fontSize: F.micro, fontWeight: 700, letterSpacing: "0.12em",
                textTransform: "uppercase", color: PV.steel500,
              }}>{s.label}</div>
              <div style={{
                fontFamily: displayStack,
                fontSize: F.h4, fontWeight: 700, color: PV.steel900,
                fontVariantNumeric: "tabular-nums", marginTop: 2, lineHeight: 1,
              }}>{s.value}</div>
              <div style={{ fontSize: F.caption, color: PV.steel500, marginTop: 2 }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div style={{
          background: PV.steel50, borderTop: `1px solid ${PV.steel100}`,
          padding: `${S.sm + 2}px ${S.md + 2}px`,
          display: "flex", gap: S.md + 2, alignItems: "center", fontSize: F.body, color: PV.steel700,
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Check ok={!!comp.pre} />
            Pre-trip {comp.pre ? `· ${comp.pre.time_local}` : "missing"}
          </span>
          <span style={{ width: 1, height: 18, background: PV.steel200 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Check ok={!!comp.post} />
            Post-trip {comp.post ? `· ${comp.post.time_local}` : "pending"}
          </span>
        </div>
      </Card>
    </Section>
  );
}

// ---------- cycle hours card ----------
function CycleCard({ used, limit = 70 }) {
  const pct = Math.min(100, (used / limit) * 100);
  const avail = Math.max(0, limit - used);
  const tone = pct > 90 ? PV.flag : pct > 75 ? "#C97615" : PV.exempt;
  return (
    <Section label={`Cycle 1 (7-day), NSC §27`}>
      <Card padding={`${S.md + 2}px ${S.md + 4}px`}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: S.sm + 2 }}>
          <div>
            <span style={{
              fontFamily: displayStack,
              fontSize: F.h3, fontWeight: 700, color: PV.steel900,
              fontVariantNumeric: "tabular-nums",
            }}>{used.toFixed(1)}</span>
            <span style={{ fontSize: F.bodyLg, color: PV.steel500, marginLeft: 4 }}>/ {limit} h used</span>
          </div>
          <div style={{ fontSize: F.body, color: tone, fontWeight: 600 }}>
            {avail.toFixed(1)} h available
          </div>
        </div>
        <div style={{
          height: 8, background: PV.steel100, borderRadius: R.pill, overflow: "hidden",
        }}>
          <div style={{
            height: "100%", width: `${pct}%`, background: tone,
            transition: "width 0.4s ease",
          }} />
        </div>
        <div style={{ fontSize: F.body - 1, color: PV.steel500, marginTop: S.sm }}>
          Resets after 24 consecutive hours off-duty.
        </div>
      </Card>
    </Section>
  );
}

// ---------- 14-day strip ----------
function FourteenStrip({ drv, today, onPickDay }) {
  const D = window.NORFAB_DATA;
  const days = [];
  for (let i = 0; i < 14; i++) {
    const iso = isoNDaysAgo(today, i);
    days.push({ iso, c: D.dayCompliance(drv.id, iso) });
  }
  // Newest first (today on the left). For a roadside view the most recent
  // activity is what an officer / driver cares about, they shouldn't have
  // to scroll right past two weeks of history to find today. Scrolling
  // right reveals older days, which matches "scroll back in time" intuition.

  return (
    <Section label="Last 14 days · tap for details" inset={false}>
      <div style={{
        overflowX: "auto", overflowY: "hidden",
        scrollbarWidth: "thin",
      }}>
        <div style={{
          display: "flex", gap: S.sm - 2, padding: `2px ${PAGE_X}px ${S.sm - 2}px`,
          minWidth: "max-content",
        }}>
          {days.map((d) => {
            const isToday = d.iso === today;
            const flagged = d.c.state === "full-log" && d.c.reasons && d.c.reasons.length;
            // Solid bold status block on the bottom third of each cell.
            // Designed for outdoor legibility, readable in glare or rain
            // from arm's length. Pastels are nowhere on the strip;
            // every status color is the saturated/bold variant.
            const status = d.c.state === "exempt" ? { color: PV.exempt, label: "EX" }
                        : flagged ? { color: PV.flag, label: "FL" }
                        : d.c.state === "full-log" ? { color: PV.log, label: "LG" }
                        : { color: PV.steel200, label: "-" };
            return (
              <button
                key={d.iso}
                onClick={() => onPickDay(d.iso)}
                className="pv-day-cell"
                style={{
                  background: PV.white,
                  border: `2px solid ${isToday ? PV.navy : PV.steel200}`,
                  borderRadius: R.md, padding: 0,
                  width: 60, height: 88,
                  display: "flex", flexDirection: "column",
                  textAlign: "center", flex: "none", cursor: "pointer",
                  position: "relative", fontFamily: fontStack,
                  overflow: "hidden",
                }}
              >
                {/* Top section: day-of-week + month + day-number.
                    Month abbreviation matters when the strip crosses a
                    month boundary (otherwise "31, 1, 2" reads as nonsense).
                    Each cell is fully self-identifying. */}
                <div style={{
                  flex: 1, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center",
                  padding: `${S.xs}px 0`,
                }}>
                  <div style={{
                    fontSize: F.micro - 1, fontWeight: 700, color: PV.steel500,
                    letterSpacing: 0.6,
                  }}>{dayShort(d.iso).toUpperCase()}</div>
                  <div style={{
                    fontFamily: displayStack,
                    fontSize: F.h4, fontWeight: 700, color: PV.steel900, lineHeight: 1,
                    fontVariantNumeric: "tabular-nums", marginTop: 1,
                  }}>{dayNum(d.iso)}</div>
                  <div style={{
                    fontSize: F.micro - 1, fontWeight: 700, color: PV.steel500,
                    letterSpacing: 0.6, marginTop: 1,
                  }}>{monthShort(d.iso)}</div>
                </div>
                {/* Bottom status block: SOLID bold color + white letter.
                    This is the visual identifier officers see at a distance. */}
                <div style={{
                  background: status.color, color: PV.white,
                  fontSize: F.caption, fontWeight: 800, letterSpacing: 0.6,
                  padding: `${S.xs + 1}px 0`,
                  fontFamily: fontStack,
                  textShadow: "0 1px 0 rgba(0,0,0,0.15)",
                }}>{status.label}</div>
                {isToday && (
                  <div style={{
                    position: "absolute", top: -2, right: -2,
                    background: PV.navy, color: PV.white,
                    fontSize: F.micro - 2, padding: "2px 6px",
                    borderRadius: `0 ${R.sm}px 0 ${R.sm}px`,
                    letterSpacing: 0.5, fontWeight: 700,
                  }}>TODAY</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{
        padding: `${S.md}px ${PAGE_X}px 0`, fontSize: F.caption, color: PV.steel700,
        display: "flex", gap: S.md, flexWrap: "wrap", alignItems: "center",
      }}>
        {[
          { c: PV.exempt, l: "EX", t: "Exempt" },
          { c: PV.log,    l: "LG", t: "Full log" },
          { c: PV.flag,   l: "FL", t: "Flagged" },
        ].map((m) => (
          <span key={m.l} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: m.c, color: PV.white,
              minWidth: 22, height: 16, padding: "0 5px", borderRadius: R.sm,
              fontSize: F.micro, fontWeight: 800, letterSpacing: 0.4,
              textShadow: "0 1px 0 rgba(0,0,0,0.15)",
            }}>{m.l}</span>
            <span style={{ fontWeight: 600 }}>{m.t}</span>
          </span>
        ))}
      </div>
    </Section>
  );
}

// ---------- carrier credentials ----------
function CarrierBlock() {
  const { SFC } = window.NORFAB_DATA;
  return (
    <Section label="Carrier credentials">
      <Card padding={0}>
        <Row k="Carrier" v={SFC.carrier} />
        <Row k="NSC #" v={SFC.nsc} mono />
        <Row k="Safety Fitness Cert" v={`Valid · expires ${SFC.expires}`} />
        <Row k="Home terminal" v="16425 130 Ave NW, Edmonton AB" last />
      </Card>
    </Section>
  );
}
function Row({ k, v, mono, last }) {
  return (
    <div style={{
      padding: `${S.sm + 2}px ${S.md + 2}px`,
      borderBottom: last ? "none" : `1px solid ${PV.steel100}`,
      display: "flex", justifyContent: "space-between", gap: S.md, alignItems: "baseline",
    }}>
      <div style={{ fontSize: F.body - 1, color: PV.steel500 }}>{k}</div>
      <div style={{
        fontSize: F.body, color: PV.steel900, fontWeight: 500, textAlign: "right",
        fontFamily: mono ? '"SF Mono",Menlo,monospace' : "inherit",
        fontVariantNumeric: "tabular-nums",
      }}>{v}</div>
    </div>
  );
}

// ---------- updated timestamp ----------
function FreshFooter({ minutesAgo = 2 }) {
  return (
    <div style={{
      padding: `${S.sm + 2}px ${PAGE_X}px ${S.xl - 2}px`, textAlign: "center",
      fontSize: F.caption, color: PV.steel500, letterSpacing: 0.3,
    }}>
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        color: PV.steel500, fontWeight: 600,
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: R.pill, background: PV.exempt,
          animation: "pulse 2s ease-in-out infinite",
        }} />
        Live · updated {minutesAgo} min ago
      </span>
      <div style={{ marginTop: S.sm }}>
        Auto-refreshes from Cascade Freight compliance pipeline hourly.
      </div>
    </div>
  );
}

// ---------- DAY DETAIL screen ----------
function DayDetail({ drv, unit, iso, onBack }) {
  const D = window.NORFAB_DATA;
  const c = D.dayCompliance(drv.id, iso);
  const isExempt = c.state === "exempt";
  const isFlagged = c.state === "full-log" && c.reasons && c.reasons.length;
  const fg = isFlagged ? PV.flag : isExempt ? PV.exempt : PV.log;
  const bg = isFlagged ? PV.flagBg : isExempt ? PV.exemptBg : PV.logBg;
  const bd = isFlagged ? PV.flagBd : isExempt ? PV.exemptBd : PV.logBd;

  const dayTone = isFlagged ? "flag" : isExempt ? "exempt" : c.state === "none" ? null : "log";
  return (
    <React.Fragment>
      {/* Day-context strip: driver name + selected date + the unit(s)
          actually used on this day (NOT drv.unit, which is the "most
          recent" across all data). Multi-vehicle days get flagged so an
          officer knows the day involves two different GVW classes, which
          can change which set of rules applies to which trips. */}
      <div style={{
        background: PV.white, color: PV.steel900,
        padding: `${S.md}px ${PAGE_X}px`, borderBottom: `1px solid ${PV.steel100}`,
      }}>
        <div style={{ fontSize: F.micro, color: PV.steel500, letterSpacing: 0.6, textTransform: "uppercase", fontWeight: 700 }}>
          {drv.name}
        </div>
        <div style={{ fontSize: F.h6, fontWeight: 700, color: PV.steel900, marginTop: 2 }}>{fmtDateLong(iso)}</div>
        {(() => {
          const dayUnits = unitsUsedOnDay(c);
          if (dayUnits.length === 0) return null;
          const unitInfo = dayUnits.map(uid => {
            const u = D.UNITS.find(x => x.id === uid);
            return { id: uid, klass: u ? u.klass : null };
          });
          const isMulti = unitInfo.length > 1;
          return (
            <div style={{
              marginTop: S.xs + 2, display: "flex", alignItems: "center",
              flexWrap: "wrap", gap: S.xs + 2,
            }}>
              {unitInfo.map((u) => (
                <Badge key={u.id} tone={u.klass === "heavy" ? "navy" : "neutral"} variant="solid"
                  style={{ fontSize: F.caption, padding: "3px 7px" }}>
                  {u.id}{u.klass === "heavy" ? " · HEAVY" : u.klass === "light" ? " · LIGHT" : ""}
                </Badge>
              ))}
              {isMulti && (
                <span style={{ fontSize: F.caption, fontWeight: 600, color: PV.flag }}>
                  Multi-vehicle day
                </span>
              )}
            </div>
          );
        })()}
      </div>

      {/* Status banner + condition checklist combined in ONE card. The
          headline (Exempt / Full log required) and the four conditions
          that explain WHY belong together, separating them with a
          redundant "Why exempt" heading was visual noise. */}
      <Section pb={S.md}>
        <div style={{ height: S.md }} />
        <Card tone={dayTone} padding={0}>
          <div style={{ padding: `${S.md + 2}px ${S.md + 4}px` }}>
            <div style={{
              fontFamily: displayStack,
              fontSize: F.h4, fontWeight: 700, color: fg, lineHeight: 1.1,
            }}>
              {c.state === "none" ? "No driving recorded"
                : isExempt ? "Exempt"
                : "Full daily log required"}
            </div>
            {c.state !== "none" && (
              <div style={{ fontSize: F.body, color: PV.steel700, marginTop: S.xs + 2 }}>
                {isExempt ? "All conditions of NSC 76(2)(b) met." : (c.reasons[0] || "Outside 160 km radius.")}
              </div>
            )}
          </div>
          {c.state !== "none" && (
            <div style={{ background: PV.white, borderTop: `1px solid ${PV.steel200}` }}>
              <ConditionRow ok={!c.outside} label="All trips within 160 km of day-start location" />
              <ConditionRow ok={c.allReturned} label="Returned to day-start location within 1.5 km" />
              <ConditionRow ok={!!c.pre} label="Pre-trip inspection signed" />
              <ConditionRow ok={!!c.post} optional label="Post-trip inspection signed" last />
            </div>
          )}
        </Card>
      </Section>

      {/* Duty status chart, drawn on EVERY active day, whether exempt or
          full-log. The 24-h timeline is part of the carrier log either way;
          driver and officer both expect it to be present. Uses c.segments
          (built by data.js) so it's identical to the dashboard's chart. */}
      {c.segments && c.segments.length > 0 && (
        <DutyMini segments={c.segments} />
      )}

      {/* Trips list, no header; the rows speak for themselves. */}
      {c.dayTrips && c.dayTrips.length > 0 && (
        <Section pb={S.md}>
          <Card padding={0}>
            {c.pre && (
              <TripLine
                left="Pre-trip DVIR"
                right={c.pre.time_local}
                tag={<Check ok />}
                sub={`${c.pre.unit || unit.id} · odometer ${c.pre.odometer_km.toLocaleString()} km`}
              />
            )}
            {c.dayTrips.map((t, i) => {
              // Distance from day-start (the regulation's reference point,
              // re-annotated onto each trip by dayCompliance). The legacy
              // t.site_dist / t.returned fields measure against the carrier
              // PPB and are misleading, mid-day trips don't need to return,
              // only the final trip does (and that's tracked at day level
              // via c.allReturned).
              const distKm = Number.isFinite(t.dist_from_start_km) ? t.dist_from_start_km : 0;
              // Officer-readable "where" line: From → To with location names,
              // coord fallback when names missing, and a "loop" indicator when
              // start == end (yard re-park, idle/movement noise).
              const startName = (t.start_site || "").trim();
              const endName = (t.end_site || "").trim();
              const coordPair = (c) => (c && c.length === 2) ? `${c[0].toFixed(3)},${c[1].toFixed(3)}` : null;
              const fallbackA = coordPair(t.startCoords);
              const fallbackB = coordPair(t.endCoords);
              const a = startName || fallbackA || "?";
              const b = endName || fallbackB || "?";
              const isLoop = (startName && endName && startName === endName);
              // ?q=loc:LAT,LNG drops a pin at the exact GPS coords without
              // triggering Google's business-name fuzzy match (which would
              // otherwise hit nearby public listings like Nelson Lumber
              // when a truck was actually at the Cascade Freight-internal NFB
              // geofence). The 'loc:' prefix is the key — bare ?q=LAT,LNG
              // would still do a business search.
              const mapHref = (coords) => coords && coords.length === 2
                ? `https://www.google.com/maps?q=loc:${coords[0]},${coords[1]}`
                : null;
              const startHref = mapHref(t.startCoords);
              const endHref = mapHref(t.endCoords);
              const whereJsx = isLoop ? (
                <span>
                  {startHref ? <a href={startHref} target="_blank" rel="noopener" style={{ color: PV.steel900, textDecoration: "underline", textDecorationColor: PV.steel200 }}>{a}</a> : a}
                  <span style={{ color: PV.steel500, fontWeight: 400, marginLeft: 6 }}>· loop</span>
                </span>
              ) : (
                <span>
                  {startHref ? <a href={startHref} target="_blank" rel="noopener" style={{ color: PV.steel900, textDecoration: "underline", textDecorationColor: PV.steel200 }}>{a}</a> : a}
                  <span style={{ color: PV.steel500, fontWeight: 400, margin: "0 6px" }}>→</span>
                  {endHref ? <a href={endHref} target="_blank" rel="noopener" style={{ color: PV.steel900, textDecoration: "underline", textDecorationColor: PV.steel200 }}>{b}</a> : b}
                </span>
              );
              // Compact time format for the trip row: "8:34a–8:56p" (fits next
              // to a long location name on a narrow phone, unlike "8:34 a.m.").
              const tShort = (m) => {
                if (m == null || isNaN(m)) return "-";
                const h = Math.floor(m/60), mm = m%60;
                const h12 = ((h+11)%12)+1;
                return `${h12}:${String(mm).padStart(2,"0")}${h>=12?"p":"a"}`;
              };
              const timeRange = `${tShort(t.start_min)}–${tShort(t.end_min)}`;
              // Trip-row tag: quiet monochrome text for in-radius trips
              // (they're the norm, shouldn't visually compete with the
              // From → To line). Strong single-color flag Badge only when
              // the trip exceeds the 160 km exemption, that's where
              // attention is actually needed.
              const tagJsx = t.outside_radius
                ? <Badge tone="flag">{distKm.toFixed(0)} km out</Badge>
                : <span style={{
                    fontSize: F.caption, color: PV.steel500, fontWeight: 500,
                    fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                  }}>{distKm.toFixed(0)} km</span>;
              return (
                <TripLine
                  key={t.id}
                  left={whereJsx}
                  right={timeRange}
                  tag={tagJsx}
                  sub={`${t.unit || "?"} · ${t.km.toFixed(1)} km · odometer ${(t.endingOdometer || 0).toLocaleString()}`}
                  last={i === c.dayTrips.length - 1 && !c.post}
                />
              );
            })}
            {c.post && (
              <TripLine
                left="Post-trip DVIR"
                right={c.post.time_local}
                tag={<Check ok />}
                sub={`${c.post.unit || unit.id} · odometer ${c.post.odometer_km.toLocaleString()} km`}
                last
              />
            )}
          </Card>
        </Section>
      )}

      {/* Source documents, single link to the original SiteDocs PDF.
          Rendered with the same design language as everything else: navy
          surface, white text, the badge as a Badge primitive. */}
      {drv.token && (c.pre || c.post) && (
        <Section label="Source documents" pb={S.md}>
          <a
            href={`${D.PUBLISH_BASE}/drivers/${drv.token}/support/${iso}/inspection-source.pdf`}
            target="_blank" rel="noopener"
            style={{
              display: "flex", alignItems: "center", gap: S.sm + 2,
              padding: `${S.md}px ${S.md + 2}px`, textDecoration: "none",
              background: PV.navyDeep, color: PV.white, borderRadius: R.md,
              fontFamily: fontStack, fontWeight: 600, fontSize: F.bodyLg,
              border: `1px solid ${PV.navyDeep}`,
            }}
          >
            <Badge tone="flag">PDF</Badge>
            <span>Open pre-trip inspection (SiteDocs)</span>
          </a>
        </Section>
      )}

      <div style={{ height: S.md + 2 }} />
      <FreshFooter minutesAgo={2} />
    </React.Fragment>
  );
}

function ConditionRow({ ok, label, last, optional }) {
  // For `optional` conditions (post-trip DVIR, not legally required under
  // NSC Standard 13), render a neutral grey indicator instead of the red X
  // when missing, and tag the row "OPTIONAL" so an officer / driver knows
  // its absence is not a compliance failure.
  const showCheck = ok || !optional;
  return (
    <div style={{
      padding: "10px 14px", display: "flex", gap: 10, alignItems: "center",
      borderBottom: last ? "none" : `1px solid ${PV.steel100}`,
    }}>
      {showCheck ? (
        <Check ok={ok} />
      ) : (
        // Neutral "-" indicator for an optional condition that wasn't met.
        <span style={{
          width: 18, height: 18, borderRadius: 999, flex: "none",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: PV.steel100, color: PV.steel500, fontSize: 12, fontWeight: 700,
        }}>-</span>
      )}
      <div style={{
        fontSize: 13, color: PV.steel900, lineHeight: 1.35,
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      }}>
        {label}
        {optional && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
            color: PV.steel500, background: PV.steel50,
            border: `1px solid ${PV.steel200}`, borderRadius: 3,
            padding: "1px 6px", textTransform: "uppercase",
          }}>Optional</span>
        )}
      </div>
    </div>
  );
}

function TripLine({ left, right, sub, tag, last }) {
  return (
    <div style={{
      padding: "10px 14px",
      borderBottom: last ? "none" : `1px solid ${PV.steel100}`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: PV.steel900, minWidth: 0, flex: 1 }}>
          {left}
        </div>
        <div style={{
          fontSize: 12, color: PV.steel500, fontVariantNumeric: "tabular-nums",
        }}>{right}</div>
      </div>
      <div style={{
        marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
      }}>
        <div style={{ fontSize: 11, color: PV.steel500 }}>{sub}</div>
        <div>{tag}</div>
      </div>
    </div>
  );
}

// ---------- duty mini chart (phone) ----------
//
// Consumes the segments computed in data.js (`c.segments`) so the chart on
// the phone is mathematically identical to the dashboard's DutyChart and
// the PDF chart. No local segment math, the previous version split DVIR
// times with `.split(":")` which silently mishandled "1:30 PM" as 1:30 AM,
// and treated gaps between trips as off-duty instead of on-duty.
//
// Renders a proper stepped polyline (not isolated rectangles) so the path
// reads as a continuous 24-hour duty trace: Off → On (pre-trip) → Driving
// → On (on-site) → Driving → ... → Off.
function DutyMini({ segments }) {
  const W = 360, padL = 60, padR = 14, rowH = 22, padT = 10;
  const plotW = W - padL - padR;
  const rows = ["Off", "Sleeper", "Driving", "On Duty"];
  const plotH = rowH * 4;
  const H = padT + plotH + 24;
  const xAt = (m) => padL + (Math.max(0, Math.min(1440, m)) / 1440) * plotW;
  // y is the centerline of each row (row 0 top, row 3 bottom).
  const yAt = (row) => padT + (row + 0.5) * rowH;

  const segs = Array.isArray(segments) ? segments : [];

  // Build a stepped polyline path through the segments. Each segment is a
  // horizontal segment at row's y; transitions are vertical jumps.
  let pathD = "";
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (i === 0) pathD += `M ${xAt(s.start)} ${yAt(s.row)} `;
    else pathD += `L ${xAt(s.start)} ${yAt(s.row)} `;
    pathD += `L ${xAt(s.end)} ${yAt(s.row)} `;
  }
  const drivingSegs = segs.filter(s => s.row === 2);

  return (
    <Section pb={S.md}>
      <Card padding={0}>
        {/* Navy banner header, elevates the duty chart as the most
            regulator-relevant artifact on the page. White text on navy
            with red accent stripe (mirrors the BrandBar identity). */}
        <div style={{
          background: PV.navyDeep, color: PV.white,
          padding: `${S.sm + 2}px ${S.md + 2}px`,
          borderBottom: `2px solid ${PV.flag}`,
          fontFamily: displayStack, fontWeight: 700,
          fontSize: F.bodyLg, letterSpacing: 0.6,
          textTransform: "uppercase",
        }}>
          Duty status · 24 hours
        </div>
        <div style={{ padding: `${S.sm}px ${S.xs + 2}px` }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
            {/* Row labels + dashed centerlines */}
            {rows.map((r, i) => (
              <g key={r}>
                <line x1={padL} x2={W - padR} y1={padT + (i + 0.5) * rowH} y2={padT + (i + 0.5) * rowH}
                  stroke={PV.steel100} strokeWidth="1" strokeDasharray="2 3" />
                <text x={padL - 8} y={padT + (i + 0.5) * rowH + 3} fontSize="9" fill={PV.steel500}
                  textAnchor="end" fontWeight={i === 2 ? 700 : 500}>{r}</text>
              </g>
            ))}
            {/* Hour ticks */}
            {[0, 6, 12, 18, 24].map(h => (
              <g key={h}>
                <line x1={xAt(h * 60)} x2={xAt(h * 60)} y1={padT} y2={padT + plotH} stroke={PV.steel100} />
                <text x={xAt(h * 60)} y={padT + plotH + 12} fontSize="9" fill={PV.steel500} textAnchor="middle">
                  {h === 24 ? "24" : h}
                </text>
              </g>
            ))}
            {/* Navy stepped polyline through all duty states */}
            {pathD && (
              <path d={pathD} fill="none" stroke={PV.navy} strokeWidth="1.75"
                strokeLinejoin="miter" strokeLinecap="square" />
            )}
            {/* Visible orange overlay specifically on the Driving row */}
            {drivingSegs.map((s, i) => (
              <line key={`d${i}`}
                x1={xAt(s.start)} y1={yAt(2)} x2={xAt(s.end)} y2={yAt(2)}
                stroke={PV.flag} strokeWidth="2.5" strokeLinecap="square" />
            ))}
          </svg>
          <div style={{ fontSize: F.micro, color: PV.steel500, padding: `0 ${S.md + 2}px ${S.xs}px`, textAlign: "right" }}>
            Reconstructed from trip + DVIR data · driving in orange
          </div>
        </div>
      </Card>
    </Section>
  );
}

// ---------- MAIN VIEW ----------
function PhoneView({ driverId = "ray" }) {
  const D = window.NORFAB_DATA;
  const drv = useMemoPV(() => D.DRIVERS.find(x => x.id === driverId), [driverId]);
  const unit = useMemoPV(() => D.UNITS.find(x => x.id === drv.unit), [drv]);
  const today = D.TODAY;
  const comp = useMemoPV(() => D.dayCompliance(driverId, today), [driverId, today]);
  const [openDay, setOpenDay] = useStatePV(null);

  // Cycle usage: sum of drive+onduty over last 7 days
  const cycleUsed = useMemoPV(() => {
    let m = 0;
    for (let i = 0; i < 7; i++) {
      const c = D.dayCompliance(driverId, isoNDaysAgo(today, i));
      m += c.onduty_hrs || 0;
    }
    return m;
  }, [driverId, today]);

  return (
    <div style={{
      width: "100%", background: PV.paper,
      fontFamily: fontStack, color: PV.steel900,
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* BrandBar is sticky-pinned and ALWAYS rendered, both on the day
          list AND inside DayDetail, so the Cascade Freight navy banner anchors
          every screen. When a day is open, tapping the banner navigates
          back to the day list (banner doubles as the back affordance). */}
      <BrandBar onBack={openDay ? () => setOpenDay(null) : null} />
      <div className="pv-screen">
        {openDay ? (
          <DayDetail drv={drv} unit={unit} iso={openDay} onBack={() => setOpenDay(null)} />
        ) : (
          <React.Fragment>
            <DriverHero drv={drv} unit={unit} comp={comp} />
            <div style={{ height: S.md }} />
            <StatusCard comp={comp} today={today} />
            <TodaySnapshot comp={comp} unit={unit} />
            <CycleCard used={cycleUsed} limit={drv.unit.startsWith("FDT") ? 70 : 80} />
            <FourteenStrip drv={drv} today={today} onPickDay={setOpenDay} />
            <CarrierBlock />
            <FreshFooter minutesAgo={2} />
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

window.PhoneView = PhoneView;
