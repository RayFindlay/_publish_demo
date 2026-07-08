// Feature #1, Cmd+K command palette
// Search across drivers, units, dates, screens. Keyboard-driven.

const { useState: useStatePal, useEffect: useEffectPal, useMemo: useMemoPal, useRef: useRefPal } = React;

function CommandPalette({ open, onClose, onNavigate }) {
  const [q, setQ] = useStatePal("");
  const [idx, setIdx] = useStatePal(0);
  const inputRef = useRefPal(null);
  const listRef = useRefPal(null);

  useEffectPal(() => {
    if (open) {
      setQ(""); setIdx(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 30);
    }
  }, [open]);

  const items = useMemoPal(() => {
    const D = window.NORFAB_DATA;
    const all = [];
    // Screens
    all.push({ kind: "screen", id: "fleet",        label: "Drivers",             hint: "Today's driver status",       route: { name: "fleet" } });
    all.push({ kind: "screen", id: "vehicles",     label: "Fleet",               hint: "All units, status",           route: { name: "vehicles" } });
    all.push({ kind: "screen", id: "maintenance",  label: "Maintenance",         hint: "Schedule, log, expiries",     route: { name: "maintenance" } });
    all.push({ kind: "screen", id: "audit",        label: "NSC audit export",    hint: "Print-ready binder",          route: { name: "audit" } });
    // Drivers
    for (const d of D.DRIVERS) {
      const u = D.UNITS.find(x => x.id === d.unit);
      all.push({ kind: "driver", id: d.id, label: d.name, hint: `${d.unit} · ${u.make} ${u.model}`, route: { name: "driver", driverId: d.id } });
    }
    // Units
    for (const u of D.UNITS) {
      all.push({ kind: "unit", id: u.id, label: u.id, hint: `${u.year} ${u.make} ${u.model} · ${u.gvw_kg.toLocaleString()} kg ${u.klass}`, route: { name: "unit", unitId: u.id } });
    }
    return all;
  }, []);

  // Try to parse date from query
  const dateMatch = useMemoPal(() => {
    if (!q) return null;
    // ISO yyyy-mm-dd
    let m = q.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // mm/dd or dd/mm or yyyy/mm/dd → try a flexible parse
    const d = new Date(q);
    if (!isNaN(d.getTime()) && q.length >= 6) return d.toISOString().slice(0, 10);
    return null;
  }, [q]);

  const filtered = useMemoPal(() => {
    const Q = q.trim().toLowerCase();
    if (!Q) return items.slice(0, 20);
    const score = (it) => {
      const hay = `${it.label} ${it.hint} ${it.id}`.toLowerCase();
      if (hay.startsWith(Q)) return 100;
      if (hay.includes(" " + Q)) return 50;
      if (hay.includes(Q)) return 20;
      return 0;
    };
    const ranked = items.map(it => ({ it, s: score(it) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.it).slice(0, 20);
    // If a date parsed, append per-driver day shortcuts
    if (dateMatch) {
      const D = window.NORFAB_DATA;
      for (const d of D.DRIVERS) {
        ranked.push({ kind: "day", id: `${d.id}-${dateMatch}`, label: `${d.name} on ${dateMatch}`, hint: "Open day detail", route: { name: "day", driverId: d.id, dayISO: dateMatch } });
        if (ranked.length >= 28) break;
      }
    }
    return ranked;
  }, [q, items, dateMatch]);

  useEffectPal(() => { setIdx(0); }, [q]);
  useEffectPal(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(filtered.length - 1, i + 1)); }
      else if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const sel = filtered[idx];
        if (sel) { onNavigate(sel.route); onClose(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, idx, onClose, onNavigate]);

  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(11,26,42,0.45)",
      zIndex: 400,
      display: "grid", placeItems: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "min(620px, calc(100vw - 32px))",
        background: "var(--white)",
        border: "1px solid var(--border)", borderRadius: 6,
        boxShadow: "0 24px 60px rgba(11,26,42,0.30)",
        display: "flex", flexDirection: "column", maxHeight: "70vh",
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--rule)" }}>
          <Icon name="search" size={16} style={{ color: "var(--fg-muted)" }} />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
            placeholder="Find a driver, unit, screen, or date (YYYY-MM-DD)…"
            style={{ flex: 1, border: "none", outline: "none", font: "15px var(--font-sans)", color: "var(--navy-900)", background: "transparent" }} />
          <kbd style={{ font: "600 10px/1 var(--font-mono)", color: "var(--fg-muted)", background: "var(--steel-100)", padding: "3px 6px", borderRadius: 2 }}>ESC</kbd>
        </div>
        <div ref={listRef} style={{ overflowY: "auto", padding: 6 }}>
          {filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-muted)", font: "13px var(--font-sans)" }}>
              No matches. Try a driver name, unit ID, or date.
            </div>
          )}
          {filtered.map((it, i) => {
            const active = i === idx;
            return (
              <button key={it.kind + it.id} onClick={() => { onNavigate(it.route); onClose(); }}
                onMouseEnter={() => setIdx(i)}
                style={{
                  display: "flex", width: "100%", alignItems: "center", gap: 12,
                  padding: "9px 12px", border: "none", borderRadius: 3,
                  background: active ? "var(--steel-100)" : "transparent",
                  cursor: "pointer", textAlign: "left",
                  font: "13px var(--font-sans)", color: "var(--navy-900)",
                }}>
                <KindBadge kind={it.kind} />
                <span style={{ fontWeight: 600 }}>{it.label}</span>
                <span style={{ color: "var(--fg-muted)", font: "12px var(--font-sans)" }}>{it.hint}</span>
                <span style={{ marginLeft: "auto", color: "var(--fg-muted)", font: "11px var(--font-mono)" }}>
                  {active ? "↵" : ""}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--rule)", display: "flex", gap: 16, font: "11px var(--font-sans)", color: "var(--fg-muted)" }}>
          <span><kbd style={kbdStyle}>↑</kbd><kbd style={kbdStyle}>↓</kbd> Navigate</span>
          <span><kbd style={kbdStyle}>↵</kbd> Open</span>
          <span><kbd style={kbdStyle}>Esc</kbd> Close</span>
          <span style={{ marginLeft: "auto" }}>Cmd / Ctrl + K to open</span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle = { font: "600 10px/1 var(--font-mono)", color: "var(--steel-700)", background: "var(--steel-100)", padding: "2px 5px", borderRadius: 2, marginRight: 4 };

function KindBadge({ kind }) {
  const map = {
    driver:   { label: "DRIVER", bg: "var(--accent-100)", fg: "var(--accent-700)" },
    unit:     { label: "UNIT",   bg: "#E8EEF6",           fg: "var(--navy-800)" },
    screen:   { label: "SCREEN", bg: "var(--steel-100)",  fg: "var(--steel-700)" },
    day:      { label: "DAY",    bg: "#EAF3EE",           fg: "var(--ok)" },
  };
  const m = map[kind] || map.screen;
  return (
    <span style={{
      font: "600 9.5px/1 var(--font-sans)", letterSpacing: "0.1em",
      padding: "3px 6px", background: m.bg, color: m.fg, borderRadius: 2,
      minWidth: 52, textAlign: "center",
    }}>{m.label}</span>
  );
}

window.CommandPalette = CommandPalette;
