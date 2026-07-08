// Cascade Freight Fleet Compliance, UI primitives
// Conservative, audit-software credibility. 1px borders, 2-4px radii, no glass.

const { useState, useEffect, useMemo, useRef } = React;

// ---------- Lucide icon ----------
function Icon({ name, size = 16, stroke = 1.75, color = "currentColor", style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !window.lucide) return;
    const pascal = name.split("-").map(x => x[0].toUpperCase() + x.slice(1)).join("");
    const data = window.lucide.icons?.[pascal] || window.lucide[pascal];
    if (!data) { ref.current.innerHTML = ""; return; }
    // Modern lucide UMD: icons are [tag, attrs, children] tuples or arrays of them.
    // Normalize to an array of child elements.
    let children = [];
    if (Array.isArray(data)) {
      // Could be [tag, attrs, children?] OR [[tag,attrs],[tag,attrs]...]
      if (typeof data[0] === "string") children = [data];
      else children = data;
    } else if (data && Array.isArray(data[2])) {
      children = data[2];
    } else if (data && data.toSvg) {
      ref.current.innerHTML = data.toSvg({ width: size, height: size, "stroke-width": stroke });
      return;
    }
    const inner = children.map(c => {
      if (!c) return "";
      const tag = c[0];
      const attrs = c[1] || {};
      const a = Object.entries(attrs).map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`).join(" ");
      return `<${tag} ${a} />`;
    }).join("");
    ref.current.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  }, [name, size, stroke]);
  return <span ref={ref} style={{ display: "inline-flex", lineHeight: 0, color, ...style }} />;
}

// ---------- Buttons ----------
function Btn({ kind = "primary", size = "md", children, onClick, icon, iconRight, style, type = "button", disabled, ...rest }) {
  const base = {
    fontFamily: "var(--font-sans)",
    fontWeight: 600,
    fontSize: size === "sm" ? 12.5 : 13.5,
    padding: size === "sm" ? "6px 12px" : "9px 16px",
    borderRadius: 4,
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    transition: "all 160ms cubic-bezier(.2,.7,.2,1)",
    whiteSpace: "nowrap",
    letterSpacing: 0,
    ...style,
  };
  const kinds = {
    primary:   { background: "var(--navy-900)", color: "#fff" },
    accent:    { background: "var(--accent-600)", color: "#fff" },
    secondary: { background: "var(--white)", color: "var(--navy-900)", borderColor: "var(--border-strong)" },
    ghost:     { background: "transparent", color: "var(--navy-900)", padding: size === "sm" ? "6px 8px" : "9px 10px" },
    icon:      { background: "var(--white)", color: "var(--navy-900)", borderColor: "var(--border)", padding: 7 },
  };
  return (
    <button type={type} onClick={disabled ? undefined : onClick} style={{ ...base, ...kinds[kind] }} disabled={disabled} {...rest}>
      {icon}
      {children}
      {iconRight}
    </button>
  );
}

// ---------- Eyebrow ----------
function Eyebrow({ children, style }) {
  return <div style={{
    font: "600 10.5px/1 var(--font-sans)",
    letterSpacing: "0.14em", textTransform: "uppercase",
    color: "var(--fg-muted)", ...style,
  }}>{children}</div>;
}

// ---------- Surface card ----------
function Card({ children, style, padding = 16, ...rest }) {
  return (
    <div style={{
      background: "var(--white)",
      border: "1px solid var(--border)",
      borderRadius: 4,
      padding,
      ...style,
    }} {...rest}>{children}</div>
  );
}

// ---------- KPI Stat ----------
function Stat({ label, value, sub, accent, tone, style, numeric, unit = "", decimals = 2 }) {
  const valueColor = tone === "accent" ? "#B23A0E" : "var(--navy-900)";
  // Left border stays neutral unless an explicit accent is passed, keeps headers calm.
  const leftBorder = accent || "var(--border)";

  // Count-up reveal for numeric values
  const [shown, setShown] = React.useState(numeric == null ? null : 0);
  React.useEffect(() => {
    if (numeric == null) return;
    const start = performance.now();
    const dur = 520;
    const target = Number(numeric) || 0;
    let raf = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [numeric]);

  const display = numeric != null && shown != null
    ? `${shown.toFixed(decimals)}${unit}`
    : value;

  return (
    <div style={{
      padding: "10px 14px",
      borderLeft: `2px solid ${leftBorder}`,
      minWidth: 0, ...style,
    }}>
      <Eyebrow>{label}</Eyebrow>
      <div className="nf-stat-value" style={{
        font: "600 22px/1.1 var(--font-display)",
        color: valueColor, marginTop: 6, letterSpacing: "-0.01em",
        fontVariantNumeric: "tabular-nums",
      }}>{display}</div>
      {sub && <div style={{ font: "12px/1.3 var(--font-sans)", color: "var(--fg-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ---------- Status pill ----------
function Pill({ tone = "neutral", children, style }) {
  const tones = {
    neutral: { bg: "var(--steel-50)", fg: "var(--steel-700)", bd: "var(--steel-200)" },
    ok:      { bg: "#EAF3EE", fg: "#236B43", bd: "#BFDDC9" },
    warn:    { bg: "#FBF1DB", fg: "#7A5306", bd: "#E9CD8B" },
    flag:    { bg: "var(--accent-100)", fg: "var(--accent-700)", bd: "#F0BFA0" },
    info:    { bg: "#E8EEF6", fg: "var(--navy-800)", bd: "#C9D5E5" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      font: "600 11px/1 var(--font-sans)",
      color: t.fg, background: t.bg,
      border: `1px solid ${t.bd}`,
      padding: "3px 8px", borderRadius: 3,
      letterSpacing: "0.01em",
      ...style,
    }}>{children}</span>
  );
}

// ---------- Status dot ----------
function Dot({ tone = "ok", size = 8, style }) {
  const colors = {
    ok: "var(--ok)",
    warn: "var(--warn)",
    flag: "var(--accent-600)",
    off: "var(--steel-300)",
    info: "var(--navy-700)",
  };
  return <span aria-hidden style={{
    display: "inline-block",
    width: size, height: size, borderRadius: 999,
    background: colors[tone] || tone,
    flex: "0 0 auto",
    ...style,
  }} />;
}

// ---------- Field row (forms / settings) ----------
function FieldLabel({ children }) {
  return <Eyebrow style={{ marginBottom: 6 }}>{children}</Eyebrow>;
}

// ---------- Select ----------
function Select({ value, onChange, options, style }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      font: "500 13px/1 var(--font-sans)",
      color: "var(--navy-900)",
      background: "var(--white)",
      border: "1px solid var(--border-strong)",
      borderRadius: 3,
      padding: "8px 28px 8px 10px",
      width: "100%",
      appearance: "none",
      backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"6\" viewBox=\"0 0 10 6\"><path d=\"M1 1l4 4 4-4\" stroke=\"%23294866\" stroke-width=\"1.5\" fill=\"none\" stroke-linecap=\"round\"/></svg>')",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 10px center",
      cursor: "pointer",
      ...style,
    }}>
      {options.map(o => typeof o === "string"
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ---------- Section header ----------
function SectionHead({ title, eyebrow, right, style }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      gap: 16, padding: "0 0 12px", borderBottom: "1px solid var(--rule)",
      marginBottom: 16, ...style,
    }}>
      <div>
        {eyebrow && <Eyebrow style={{ marginBottom: 6 }}>{eyebrow}</Eyebrow>}
        <div style={{ font: "600 18px/1.2 var(--font-sans)", color: "var(--navy-900)" }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

// ---------- Segmented control ----------
function Segmented({ value, onChange, options, style }) {
  return (
    <div style={{
      display: "inline-flex", padding: 2,
      background: "var(--steel-50)",
      border: "1px solid var(--border)", borderRadius: 4,
      ...style,
    }}>
      {options.map(o => {
        const active = o.v === value;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{
            font: "600 12px var(--font-sans)",
            padding: "5px 12px",
            background: active ? "var(--white)" : "transparent",
            color: active ? "var(--navy-900)" : "var(--fg-muted)",
            border: active ? "1px solid var(--border)" : "1px solid transparent",
            borderRadius: 3, cursor: "pointer",
            boxShadow: active ? "0 1px 0 rgba(17,36,54,0.04)" : "none",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

Object.assign(window, { Icon, Btn, Eyebrow, Card, Stat, Pill, Dot, FieldLabel, Select, SectionHead, Segmented });
