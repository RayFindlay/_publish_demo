// Voice command grammar — pure logic, NO DOM / React / network.
//
// Turns a raw speech transcript into an action: a route to navigate to,
// a toast to show, and (for question-type commands) a short phrase to
// speak back. Deterministic — no LLM. Everything the parser needs is
// passed in as arguments so it runs identically in the browser and under
// vitest (mirrors the lib/compliance.mjs testability pattern).
//
// Exposed as globalThis.NORFAB_VOICE_GRAMMAR = { normalize, buildVocab,
// levenshtein, resolveDatePhrase, interpret }.

(function () {
  "use strict";

  // ---- small utilities ------------------------------------------------

  function levenshtein(a, b) {
    a = a || ""; b = b || "";
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      let cur = [i];
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[n];
  }

  // Allowed edit distance scales with word length (short words must match
  // tighter, or "fdt" fuzzes into everything).
  function allowedDist(len) {
    if (len <= 4) return 1;
    if (len <= 7) return 2;
    return 3;
  }

  const ONES = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19,
  };
  const TENS = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90,
  };

  // "twenty one" -> "21", "twelve" -> "12". Handles 0-99.
  function numberWords(s) {
    const toks = s.split(" ");
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t in TENS) {
        const next = toks[i + 1];
        if (next in ONES && ONES[next] < 10) {
          out.push(String(TENS[t] + ONES[next]));
          i++;
          continue;
        }
        out.push(String(TENS[t]));
        continue;
      }
      if (t in ONES) { out.push(String(ONES[t])); continue; }
      out.push(t);
    }
    return out.join(" ");
  }

  // Lowercase, strip punctuation, apply aliases, number-words -> digits,
  // collapse spelled-out letter runs ("f d t" -> "fdt").
  function normalize(raw, aliases) {
    let s = " " + String(raw || "").toLowerCase() + " ";
    s = s.replace(/[.,!?;:'"()\-_/]/g, " ");
    s = s.replace(/\s+/g, " ");
    // aliases first (whole-word, longest key wins)
    if (aliases) {
      const keys = Object.keys(aliases).sort((a, b) => b.length - a.length);
      for (const k of keys) {
        if (!k) continue;
        const esc = k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        s = s.replace(new RegExp("(^| )" + esc + "( |$)", "g"), " " + aliases[k] + " ");
      }
    }
    s = s.replace(/\s+/g, " ").trim();
    s = numberWords(s);
    // collapse runs of >=2 single letters: "f d t" -> "fdt"
    s = s.replace(/\b([a-z])(?: ([a-z])\b)+/g, (m) => m.replace(/ /g, ""));
    return s.replace(/\s+/g, " ").trim();
  }

  function splitUnit(id) {
    const m = String(id).toLowerCase().match(/^([a-z]+)(\d+)$/);
    return m ? { prefix: m[1], digits: m[2] } : { prefix: String(id).toLowerCase(), digits: "" };
  }

  // ---- vocabulary from live data --------------------------------------

  // Build lookup tables from D.DRIVERS / D.UNITS. Screens include the
  // label swap (the tab labelled "Fleet" is route "vehicles").
  function buildVocab(D) {
    const drivers = [];       // { key, tokens[], driverId }
    const seen = new Set();
    for (const d of (D.DRIVERS || [])) {
      const name = (d.name || "").toLowerCase().replace(/[^a-z ]/g, "").trim();
      if (!name) continue;
      const toks = name.split(" ").filter(Boolean);
      const push = (key) => {
        const k = key.trim();
        if (k && !seen.has(k + "->" + d.id)) { seen.add(k + "->" + d.id); drivers.push({ key: k, tokens: k.split(" "), driverId: d.id }); }
      };
      push(name);                       // full name
      if (toks.length > 1) { push(toks[0]); push(toks[toks.length - 1]); } // first, last
    }
    const units = (D.UNITS || []).map((u) => ({ id: u.id, ...splitUnit(u.id) }));
    const screens = [
      { words: ["maintenance"], route: { name: "maintenance" } },
      { words: ["drivers", "driver board", "home", "today"], route: { name: "fleet" } },
      { words: ["fleet", "vehicles", "trucks", "vehicle list"], route: { name: "vehicles" } },
      { words: ["audit", "nsc audit", "audit export", "report"], route: { name: "audit" } },
    ];
    return { drivers, units, screens };
  }

  // Best driver match for a phrase (token-set scoring + edit distance).
  // Returns { driverId, score } or null; { ambiguous:[a,b] } if two tie.
  function matchDriver(phrase, vocab) {
    const pTokens = phrase.split(" ").filter(Boolean);
    if (!pTokens.length) return null;
    const scored = [];
    for (const cand of vocab.drivers) {
      let matched = 0;
      for (const ct of cand.tokens) {
        let best = 99;
        for (const pt of pTokens) best = Math.min(best, levenshtein(ct, pt));
        if (best <= allowedDist(ct.length)) matched++;
      }
      if (matched === cand.tokens.length) {
        // full candidate matched; score favors longer (full-name) matches
        scored.push({ driverId: cand.driverId, score: cand.tokens.length + cand.key.length / 100 });
      }
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    // collapse to distinct drivers
    const byDriver = {};
    for (const s of scored) if (!(s.driverId in byDriver)) byDriver[s.driverId] = s.score;
    const ids = Object.keys(byDriver).sort((a, b) => byDriver[b] - byDriver[a]);
    if (ids.length > 1 && byDriver[ids[0]] - byDriver[ids[1]] < 0.15) {
      return { ambiguous: [ids[0], ids[1]] };
    }
    return { driverId: ids[0], score: byDriver[ids[0]] };
  }

  // Find a unit id in the phrase. DIGITS MUST MATCH EXACTLY (same-prefix
  // units differ only by the number); the alpha prefix may fuzz by 1.
  function matchUnit(phrase, vocab) {
    const cands = [];
    const re = /([a-z]{2,5}) ?(\d{1,3})/g;
    let m;
    while ((m = re.exec(phrase)) !== null) cands.push({ prefix: m[1], digits: m[2] });
    for (const c of cands) {
      let best = null, bestDist = 99;
      for (const u of vocab.units) {
        if (u.digits !== c.digits) continue;
        const dist = levenshtein(u.prefix, c.prefix);
        if (dist <= 1 && dist < bestDist) { best = u.id; bestDist = dist; }
      }
      if (best) return best;
    }
    return null;
  }

  function matchScreen(phrase, vocab) {
    for (const sc of vocab.screens) {
      for (const w of sc.words) {
        // whole phrase-ish contains the screen word
        if (phrase === w || phrase.indexOf(w) !== -1) return sc.route;
      }
    }
    return null;
  }

  // ---- dates ----------------------------------------------------------

  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july",
    "august", "september", "october", "november", "december"];

  function isoToParts(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return { y, m, d };
  }
  function partsToISO(y, m, d) {
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  // Day-count since an epoch, for offset math without Date() (which is
  // banned in some sandboxes and drifts with timezones).
  function dayNumber(y, m, d) {
    // Convert to a serial day using a fixed algorithm (proleptic Gregorian).
    const a = Math.floor((14 - m) / 12);
    const yy = y + 4800 - a;
    const mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
      - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  }
  function fromDayNumber(n) {
    const a = n + 32044;
    const b = Math.floor((4 * a + 3) / 146097);
    const c = a - Math.floor((146097 * b) / 4);
    const dd = Math.floor((4 * c + 3) / 1461);
    const e = c - Math.floor((1461 * dd) / 4);
    const mm = Math.floor((5 * e + 2) / 153);
    const day = e - Math.floor((153 * mm + 2) / 5) + 1;
    const month = mm + 3 - 12 * Math.floor(mm / 10);
    const year = 100 * b + dd - 4800 + Math.floor(mm / 10);
    return { y: year, m: month, d: day };
  }
  function weekdayOf(y, m, d) {
    return ((dayNumber(y, m, d) + 1) % 7 + 7) % 7; // 0=Sunday
  }

  // Resolve a date phrase relative to todayISO (wall-clock today). Returns
  // an ISO string or null.
  function resolveDatePhrase(phrase, todayISO) {
    if (!phrase) return null;
    const p = phrase.trim();
    const t = isoToParts(todayISO);
    const todayN = dayNumber(t.y, t.m, t.d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
    if (p === "today") return todayISO;
    if (p === "yesterday") { const q = fromDayNumber(todayN - 1); return partsToISO(q.y, q.m, q.d); }
    if (p === "day before yesterday") { const q = fromDayNumber(todayN - 2); return partsToISO(q.y, q.m, q.d); }
    let mm = p.match(/^(\d{1,3}) days ago$/);
    if (mm) { const q = fromDayNumber(todayN - parseInt(mm[1], 10)); return partsToISO(q.y, q.m, q.d); }
    // weekday: "last tuesday" / "tuesday" -> most recent strictly before today
    const wdMatch = p.match(/(?:last )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
    if (wdMatch) {
      const target = WEEKDAYS.indexOf(wdMatch[1]);
      const todayWd = weekdayOf(t.y, t.m, t.d);
      let back = (todayWd - target + 7) % 7;
      if (back === 0) back = 7; // "tuesday" said on a tuesday = last tuesday
      const q = fromDayNumber(todayN - back);
      return partsToISO(q.y, q.m, q.d);
    }
    // "july 3", "july 3rd", "3rd of july", "jan 13"
    const strip = p.replace(/(\d+)(st|nd|rd|th)/g, "$1");
    let dm = strip.match(/([a-z]+) (\d{1,2})/) || strip.match(/(\d{1,2}) of ([a-z]+)/);
    if (dm) {
      let monName, day;
      if (/^\d/.test(dm[1])) { day = parseInt(dm[1], 10); monName = dm[2]; }
      else { monName = dm[1]; day = parseInt(dm[2], 10); }
      let monIdx = -1;
      for (let i = 0; i < MONTHS.length; i++) {
        if (MONTHS[i] === monName || MONTHS[i].slice(0, 3) === monName.slice(0, 3)) { monIdx = i; break; }
      }
      if (monIdx >= 0 && day >= 1 && day <= 31) {
        let year = t.y;
        const cand = dayNumber(year, monIdx + 1, day);
        if (cand > todayN) year -= 1; // future date => previous year
        return partsToISO(year, monIdx + 1, day);
      }
    }
    return null;
  }

  function spokenDate(iso) {
    if (!iso) return "";
    const { y, m, d } = isoToParts(iso);
    return `${MONTHS[m - 1].charAt(0).toUpperCase() + MONTHS[m - 1].slice(1)} ${d}`;
  }

  // ---- trip lookups ---------------------------------------------------

  function driverNameFor(D, driverId) {
    const d = (D.DRIVERS || []).find((x) => x.id === driverId);
    return (d && d.name) || driverId;
  }

  function daysDroveUnit(D, driverId, unitId) {
    const set = {};
    for (const trp of (D.TRIPS || [])) {
      if (trp.driver === driverId && trp.unit === unitId && trp.date) set[trp.date] = true;
    }
    return Object.keys(set).sort().reverse(); // newest first
  }

  // Distinct place names seen in the trip data (start/end sites), for the
  // "did it go to <place>" / "last truck to <place>" questions.
  function buildSiteVocab(D) {
    const set = {};
    for (const t of (D.TRIPS || [])) {
      for (const s of [t.start_site, t.end_site]) {
        const v = (s || "").trim();
        if (v) set[v.toLowerCase()] = v; // canonical casing, first seen
      }
    }
    return Object.keys(set).map((k) => ({ key: k, tokens: k.split(/\s+/).filter(Boolean), name: set[k] }));
  }

  // Fuzzy-match a spoken place against the known site names (multi-word aware).
  function matchSite(phrase, sites) {
    const pt = phrase.split(/\s+/).filter(Boolean);
    let best = null, bestScore = 0;
    for (const s of sites) {
      if (!s.tokens.length) continue;
      let matched = 0;
      for (const st of s.tokens) {
        for (const p of pt) { if (levenshtein(st, p) <= allowedDist(st.length)) { matched++; break; } }
      }
      const score = matched / s.tokens.length;
      if (score >= 0.6 && score > bestScore) { bestScore = score; best = s.name; }
    }
    return best;
  }

  // ---- intent parsing -------------------------------------------------

  // ctx: { lastDriver, lastUnit, routeUnitId }
  function interpret(rawTranscript, D, ctx, cfg) {
    ctx = ctx || {};
    cfg = cfg || {};
    const todayISO = D.CALENDAR_TODAY || D.TODAY ||
      (typeof D.localTodayISO === "function" ? D.localTodayISO() : "2026-01-01");
    const norm = normalize(rawTranscript, cfg.aliases);
    const nextCtx = { lastDriver: ctx.lastDriver, lastUnit: ctx.lastUnit, routeUnitId: ctx.routeUnitId };
    const fail = (toast, say) => ({ ok: false, toast, say: say || null, ctx: nextCtx, transcript: rawTranscript });

    if (!norm) return fail(`Didn't catch that.`);

    const vocab = buildVocab(D);
    const siteVocab = buildSiteVocab(D);
    // Example unit id for "which truck?" prompts — taken from the live roster
    // so it always matches the actual fleet (real on prod, fake on the demo).
    const unitEg = (D.UNITS && D.UNITS[0] && D.UNITS[0].id) || null;
    const askUnit = "Which truck?" + (unitEg ? " Say a unit like " + unitEg + "." : "");

    // Resolve a driver slot: explicit name, else pronoun -> lastDriver.
    function resolveDriver(text) {
      const dm = matchDriver(text, vocab);
      if (dm && dm.ambiguous) return { ambiguous: dm.ambiguous };
      if (dm && dm.driverId) return { driverId: dm.driverId };
      if (/\b(they|them|he|she|him|her|his)\b/.test(text) && ctx.lastDriver) return { driverId: ctx.lastDriver };
      return null;
    }
    // Resolve a unit slot: explicit id, else "this truck / it" -> route/last.
    function resolveUnit(text) {
      const u = matchUnit(text, vocab);
      if (u) return u;
      if (/\b(this|that|the) (truck|unit|trailer|vehicle)\b|\bit\b/.test(text)) {
        return ctx.routeUnitId || ctx.lastUnit || null;
      }
      return null;
    }

    // Find a date phrase ANYWHERE in the text (not just trailing), so
    // "...on monday at seven thirty" still resolves the day.
    function grabDate(text) {
      let m = text.match(/\bon (\d{4}-\d{2}-\d{2}|\d{1,2} of \w+|\w+ \d{1,2}[a-z]*|last \w+day|\w+day|yesterday|today|day before yesterday|\d+ days ago)\b/);
      if (m) { const d = resolveDatePhrase(m[1].trim(), todayISO); if (d) return d; }
      const scan = [
        /\bday before yesterday\b/, /\byesterday\b/, /\btoday\b/, /\b\d{1,3} days ago\b/,
        /\blast (?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
        /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
        /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)[a-z]* \d{1,2}[a-z]*\b/,
        /\b\d{1,2} of (?:january|february|march|april|may|june|july|august|september|october|november|december)\b/,
        /\b\d{4}-\d{2}-\d{2}\b/,
      ];
      for (const re of scan) { const mm = text.match(re); if (mm) { const d = resolveDatePhrase(mm[0].trim(), todayISO); if (d) return d; } }
      return null;
    }

    // 0. WHO_DROVE  ("who drove <unit> [on <date>]")
    if (/\bwho\b/.test(norm) && /\b(drove|drives|driving|drive|had|has|used|use|took|take)\b/.test(norm)) {
      const unit = resolveUnit(norm);
      if (!unit) return fail(askUnit);
      nextCtx.lastUnit = unit;
      const wantDate = grabDate(norm);
      const unitTrips = (D.TRIPS || []).filter((t) => t.unit === unit && t.date);
      if (wantDate) {
        const dayTrips = unitTrips.filter((t) => t.date === wantDate);
        if (!dayTrips.length) {
          return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
            toast: `No recorded trips for ${unit} on ${wantDate}.`, say: null };
        }
        const counts = {};
        dayTrips.forEach((t) => { counts[t.driver] = (counts[t.driver] || 0) + 1; });
        const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        nextCtx.lastDriver = ids[0];
        const names = ids.map((id) => driverNameFor(D, id)).join(", ");
        return { ok: true, route: { name: "trip-detail", unitId: unit, dayISO: wantDate }, ctx: nextCtx, transcript: rawTranscript,
          toast: `${unit} on ${wantDate}: ${names}.`, say: cfg.speak ? `${driverNameFor(D, ids[0])} drove ${unit}.` : null };
      }
      const sorted = unitTrips.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
      if (!sorted.length) {
        return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
          toast: `No recorded trips for ${unit}.`, say: null };
      }
      nextCtx.lastDriver = sorted[0].driver;
      const nm = driverNameFor(D, sorted[0].driver);
      return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
        toast: `${unit} — last driven by ${nm} on ${sorted[0].date}.`, say: cfg.speak ? `Last driven by ${nm}.` : null };
    }

    // 0b. WHAT_TRUCK  ("what/which truck did <driver> drive [on <date>]")
    // Yields to LAST_TO_PLACE when it's actually a "last ... to <place>" query.
    if (/\b(what|which)\b/.test(norm) && /\b(truck|trucks|unit|vehicle|drive|drove|driving|driven)\b/.test(norm)
        && !(/\blast\b/.test(norm) && matchSite(norm, siteVocab))) {
      const dr = resolveDriver(norm);
      if (dr && dr.ambiguous) return fail(`Did you mean ${driverNameFor(D, dr.ambiguous[0])} or ${driverNameFor(D, dr.ambiguous[1])}?`);
      if (!dr) return fail(`Who do you mean? Say the driver's name.`);
      const name = driverNameFor(D, dr.driverId);
      nextCtx.lastDriver = dr.driverId;
      const wantDate = grabDate(norm);
      let trips = (D.TRIPS || []).filter((t) => t.driver === dr.driverId && t.date);
      if (wantDate) trips = trips.filter((t) => t.date === wantDate);
      if (!trips.length) {
        return { ok: true, route: { name: "driver", driverId: dr.driverId }, ctx: nextCtx, transcript: rawTranscript,
          toast: `No recorded trips for ${name}${wantDate ? ` on ${wantDate}` : ""}.`, say: null };
      }
      const day = wantDate || trips.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0].date;
      const units = [];
      trips.filter((t) => t.date === day).forEach((t) => { if (units.indexOf(t.unit) === -1) units.push(t.unit); });
      nextCtx.lastUnit = units[0];
      return { ok: true, route: { name: "day", driverId: dr.driverId, dayISO: day }, ctx: nextCtx, transcript: rawTranscript,
        toast: `${name} drove ${units.join(", ")} on ${day}.`, say: cfg.speak ? `${name} drove ${units[0]}.` : null };
    }

    // 0c. LAST_TO_PLACE  ("which was the last truck to <place>")
    // Only fires when an actual site is named, so "who drove the truck last
    // week" falls through to the right intent instead of being hijacked.
    if (/\blast\b/.test(norm) && /\b(truck|unit|vehicle|rig|trailer)\b/.test(norm)) {
      const place = matchSite(norm, siteVocab);
      if (place) {
        const trips = (D.TRIPS || []).filter((t) => t.date && (t.start_site === place || t.end_site === place));
        if (!trips.length) return fail(`No record of any truck at ${place}.`);
        const latest = trips.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        nextCtx.lastUnit = latest.unit;
        return { ok: true, route: { name: "trip-detail", unitId: latest.unit, dayISO: latest.date }, ctx: nextCtx, transcript: rawTranscript,
          toast: `Last at ${place}: ${latest.unit} on ${latest.date}.`, say: null };
      }
    }

    // 0d. WHERE_WAS  ("where was <unit> [on <date>]")
    if (/\bwhere (was|is|were)\b/.test(norm)) {
      const unit = resolveUnit(norm);
      if (!unit) return fail(askUnit);
      nextCtx.lastUnit = unit;
      const wantDate = grabDate(norm);
      const unitTrips = (D.TRIPS || []).filter((t) => t.unit === unit && t.date);
      const day = wantDate || (unitTrips.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || {}).date;
      if (!day) {
        return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
          toast: `No recorded trips for ${unit}.`, say: null };
      }
      const dayTrips = unitTrips.filter((t) => t.date === day);
      if (!dayTrips.length) {
        return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
          toast: `No recorded trips for ${unit} on ${day}.`, say: null };
      }
      const sites = [];
      dayTrips.forEach((t) => { [t.start_site, t.end_site].forEach((s) => { if (s && sites.indexOf(s) === -1) sites.push(s); }); });
      const where = sites.length ? sites.join(" → ") : "see the route map";
      return { ok: true, route: { name: "trip-detail", unitId: unit, dayISO: day }, ctx: nextCtx, transcript: rawTranscript,
        toast: `${unit} on ${day}: ${where}.`, say: null };
    }

    // 0e. DID_GO_TO_PLACE  ("did <unit> go to <place> [on <date>]")
    if (/\bdid\b/.test(norm) && /\b(go|goto|went|end up|ended up|visit|visited|stop|stopped|make it|get to)\b/.test(norm)) {
      const unit = resolveUnit(norm);
      const place = matchSite(norm, siteVocab);
      if (!unit) return fail(askUnit);
      if (!place) return fail(`Which place? Say a site name.`);
      nextCtx.lastUnit = unit;
      const wantDate = grabDate(norm);
      let trips = (D.TRIPS || []).filter((t) => t.unit === unit && t.date && (t.start_site === place || t.end_site === place));
      if (wantDate) trips = trips.filter((t) => t.date === wantDate);
      if (!trips.length) {
        return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
          toast: `No record of ${unit} at ${place}${wantDate ? ` on ${wantDate}` : ""}.`, say: null };
      }
      const latest = trips.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      return { ok: true, route: { name: "trip-detail", unitId: unit, dayISO: latest.date }, ctx: nextCtx, transcript: rawTranscript,
        toast: `Yes — ${unit} was at ${place} on ${latest.date}.`, say: null };
    }

    // 1. WHEN_DROVE
    if (/\bwhen (did|has|was|were)\b|\blast time\b/.test(norm) && /\b(drive|drove|driven|use|used|in)\b/.test(norm)) {
      const dr = resolveDriver(norm);
      if (dr && dr.ambiguous) return fail(`Did you mean ${driverNameFor(D, dr.ambiguous[0])} or ${driverNameFor(D, dr.ambiguous[1])}?`);
      const unit = resolveUnit(norm);
      if (!dr) return fail(`Who do you mean? Say the driver's name.`);
      if (!unit) return fail(askUnit);
      const name = driverNameFor(D, dr.driverId);
      nextCtx.lastDriver = dr.driverId; nextCtx.lastUnit = unit;
      const days = daysDroveUnit(D, dr.driverId, unit);
      if (!days.length) {
        return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
          toast: `No recorded trips for ${name} in ${unit}.`, say: cfg.speak ? `No recorded trips for ${name} in ${unit}.` : null };
      }
      const extra = days.length - 1;
      return {
        ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
        toast: `${name} drove ${unit} on ${days[0]}${extra ? ` (+${extra} more day${extra === 1 ? "" : "s"})` : ""}.`,
        say: cfg.speak ? `${name} last drove ${unit} on ${spokenDate(days[0])}.` : null,
      };
    }

    // 2. WHERE_DROVE
    if (/\bwhere (did|does|has)\b/.test(norm) && /\b(drive|drove|driven|go|went|take|took)\b/.test(norm)) {
      const dr = resolveDriver(norm);
      if (dr && dr.ambiguous) return fail(`Did you mean ${driverNameFor(D, dr.ambiguous[0])} or ${driverNameFor(D, dr.ambiguous[1])}?`);
      const unit = resolveUnit(norm);
      if (!dr) return fail(`Who do you mean? Say the driver's name.`);
      if (!unit) return fail(askUnit);
      const name = driverNameFor(D, dr.driverId);
      nextCtx.lastDriver = dr.driverId; nextCtx.lastUnit = unit;
      const wantDate = grabDate(norm);
      const days = daysDroveUnit(D, dr.driverId, unit);
      const day = wantDate && days.indexOf(wantDate) !== -1 ? wantDate : days[0];
      if (!day) {
        return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript,
          toast: `No recorded trips for ${name} in ${unit}.`, say: cfg.speak ? `No trips found.` : null };
      }
      // destination = last trip's end_site that day
      const dayTrips = (D.TRIPS || []).filter((t) => t.driver === dr.driverId && t.unit === unit && t.date === day);
      const dest = dayTrips.length ? (dayTrips[dayTrips.length - 1].end_site || "") : "";
      return {
        ok: true, route: { name: "trip-detail", unitId: unit, dayISO: day }, ctx: nextCtx, transcript: rawTranscript,
        toast: `${name} in ${unit} on ${day}${dest ? ` — to ${dest}` : ""}.`,
        say: cfg.speak ? (dest ? `They drove to ${dest}.` : `Showing the route for ${spokenDate(day)}.`) : null,
      };
    }

    // 3. DAY  ("show <driver>'s day <date>")
    if (/\b(show|open|pull up|bring up)\b/.test(norm) && /\bday\b/.test(norm)) {
      const dr = resolveDriver(norm);
      if (dr && dr.ambiguous) return fail(`Did you mean ${driverNameFor(D, dr.ambiguous[0])} or ${driverNameFor(D, dr.ambiguous[1])}?`);
      if (!dr) return fail(`Whose day? Say the driver's name.`);
      const date = grabDate(norm) || todayISO;
      nextCtx.lastDriver = dr.driverId;
      const name = driverNameFor(D, dr.driverId);
      return {
        ok: true, route: { name: "day", driverId: dr.driverId, dayISO: date }, ctx: nextCtx, transcript: rawTranscript,
        toast: `${name} — ${date}.`, say: null,
      };
    }

    // 4. OPEN (screen | driver | unit)
    if (/^(open|show|go to|goto|take me to|show me|pull up|bring up)\b/.test(norm)) {
      const target = norm.replace(/^(open|show me|show|go to|goto|take me to|pull up|bring up)\b/, "").replace(/^ the /, " ").trim();
      const screen = matchScreen(target, vocab);
      if (screen) return { ok: true, route: screen, ctx: nextCtx, transcript: rawTranscript, toast: `Opening ${target}.`, say: null };
      const unit = matchUnit(target, vocab);
      if (unit) { nextCtx.lastUnit = unit; return { ok: true, route: { name: "unit", unitId: unit }, ctx: nextCtx, transcript: rawTranscript, toast: `Opening ${unit}.`, say: null }; }
      const dr = matchDriver(target, vocab);
      if (dr && dr.driverId) { nextCtx.lastDriver = dr.driverId; return { ok: true, route: { name: "driver", driverId: dr.driverId }, ctx: nextCtx, transcript: rawTranscript, toast: `Opening ${driverNameFor(D, dr.driverId)}.`, say: null }; }
      return fail(`Open what? Try a name, a unit, or a screen.`);
    }

    return fail(`Didn't catch that — heard: "${rawTranscript}"`);
  }

  const API = { normalize, buildVocab, levenshtein, matchDriver, matchUnit, resolveDatePhrase, spokenDate, interpret };
  if (typeof globalThis !== "undefined") globalThis.NORFAB_VOICE_GRAMMAR = API;
  if (typeof window !== "undefined") window.NORFAB_VOICE_GRAMMAR = API;
})();
