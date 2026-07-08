// Feature #7, Acronym glossary tooltips
// Plus #3 annotation tab, #4 verified stamp, #5 proximity warning chip.

const { useState: useStateG, useEffect: useEffectG, useRef: useRefG } = React;

// ---------- Acronym tooltip ----------
function Acronym({ term, children }) {
  const def = (window.NORFAB_LOCAL && window.NORFAB_LOCAL.GLOSSARY[term]) || "";
  const [hover, setHover] = useStateG(false);
  return (
    <span onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: "relative", display: "inline-block",
               borderBottom: "1px dotted var(--steel-300)", cursor: "help" }}>
      {children || term}
      {hover && def && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)", zIndex: 100,
          background: "var(--navy-900)", color: "#fff",
          font: "12px/1.45 var(--font-sans)", padding: "8px 10px",
          borderRadius: 3, width: 260, textAlign: "left",
          boxShadow: "0 6px 16px rgba(11,26,42,0.22)",
          pointerEvents: "none",
        }}>
          <span style={{ font: "600 10px/1 var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-500)", display: "block", marginBottom: 4 }}>
            {term}
          </span>
          {def}
        </span>
      )}
    </span>
  );
}

// ---------- Annotation tab (corner of a calendar cell) ----------
function AnnotationTab({ driverId, dayISO, onOpen }) {
  const a = window.NORFAB_LOCAL.getAnnotation(driverId, dayISO);
  if (!a) return null;
  return (
    <span title={`Note · ${a.by}: ${a.text}`}
      onClick={(e) => { e.stopPropagation(); onOpen && onOpen(); }}
      style={{
        position: "absolute", top: 0, right: 0,
        width: 0, height: 0,
        borderTop: "14px solid var(--navy-800)",
        borderLeft: "14px solid transparent",
        cursor: "help", pointerEvents: "auto",
      }} />
  );
}

// ---------- Annotation editor (popover) ----------
function AnnotationEditor({ driverId, dayISO, anchorRef, onClose, onSaved }) {
  const existing = window.NORFAB_LOCAL.getAnnotation(driverId, dayISO);
  const [text, setText] = useStateG(existing ? existing.text : "");
  const taRef = useRefG(null);
  useEffectG(() => { setTimeout(() => taRef.current && taRef.current.focus(), 20); }, []);

  const save = () => {
    const rec = window.NORFAB_LOCAL.setAnnotation(driverId, dayISO, text, "NF");
    onSaved && onSaved(rec);
    onClose();
  };
  const remove = () => {
    window.NORFAB_LOCAL.setAnnotation(driverId, dayISO, "", "NF");
    onSaved && onSaved(null);
    onClose();
  };

  // Anchor-aware position
  const rect = anchorRef && anchorRef.current ? anchorRef.current.getBoundingClientRect() : null;
  const style = rect ? {
    position: "fixed", top: rect.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - 320, rect.left)),
  } : { position: "fixed", top: "30%", left: "50%", transform: "translateX(-50%)" };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 290, background: "transparent" }} />
      <div onClick={e => e.stopPropagation()} style={{
        ...style, zIndex: 300, width: 320,
        background: "var(--white)", border: "1px solid var(--border-strong)", borderRadius: 3,
        boxShadow: "0 12px 30px rgba(11,26,42,0.18)",
        padding: 12,
      }}>
        <div style={{ font: "600 10px/1 var(--font-sans)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-muted)", marginBottom: 8 }}>
          Manager note · {dayISO}
        </div>
        <textarea ref={taRef} value={text} onChange={e => setText(e.target.value)}
          placeholder="e.g. Called driver, flat tire on 21 NE; returned 17:45."
          style={{
            width: "100%", boxSizing: "border-box", minHeight: 80,
            border: "1px solid var(--border-strong)", borderRadius: 2,
            font: "13px/1.5 var(--font-sans)", color: "var(--navy-900)",
            padding: "8px 10px", outline: "none", resize: "vertical",
          }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          {existing && <button onClick={remove} style={{
            background: "transparent", border: "none", color: "var(--accent-700)",
            font: "12px var(--font-sans)", cursor: "pointer", padding: 0, textDecoration: "underline",
          }}>Delete note</button>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Btn kind="ghost" size="sm" onClick={onClose}>Cancel</Btn>
            <Btn kind="primary" size="sm" onClick={save}>Save</Btn>
          </span>
        </div>
      </div>
    </>
  );
}

// ---------- Verified-by stamp ----------
function VerifiedStamp({ driverId, year, month, onChanged }) {
  const v = window.NORFAB_LOCAL.getVerified(driverId, year, month);
  const verify = () => {
    window.NORFAB_LOCAL.setVerified(driverId, year, month, "NF");
    onChanged && onChanged();
  };
  if (v) {
    const when = new Date(v.at);
    const label = when.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + when.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    return (
      <span title={`Verified ${v.at}`} style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        font: "12px/1 var(--font-sans)", color: "var(--fg-subtle)",
        padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 2,
        background: "var(--steel-50)",
      }}>
        <span style={{ width: 6, height: 6, background: "var(--ok)", borderRadius: 999 }} />
        Verified by <strong style={{ color: "var(--navy-900)", fontWeight: 600 }}>{v.by}</strong> · {label}
        <button onClick={verify} style={{
          background: "transparent", border: "none", color: "var(--fg-link)",
          font: "11px var(--font-sans)", cursor: "pointer", padding: 0, marginLeft: 4, textDecoration: "underline",
        }}>Re-verify</button>
      </span>
    );
  }
  return (
    <button onClick={verify} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      font: "12px var(--font-sans)", color: "var(--navy-900)",
      padding: "5px 10px", border: "1px dashed var(--border-strong)", borderRadius: 2,
      background: "transparent", cursor: "pointer",
    }}>
      <span style={{ width: 6, height: 6, background: "var(--steel-300)", borderRadius: 999 }} />
      Mark month as verified
    </button>
  );
}

// ---------- Proximity warning chip ----------
function ProximityChip({ driverId }) {
  const D = window.NORFAB_DATA;
  const p = window.NORFAB_LOCAL.proximityWarning(driverId, D.TODAY);
  if (!p) return null;
  const isOver = p.level === "over";
  return (
    <span title={`${p.used.toFixed(1)} of ${p.limit}h used in last 7 days`} style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      font: "600 11px/1 var(--font-sans)",
      padding: "4px 8px", borderRadius: 2,
      background: isOver ? "var(--accent-100)" : "#FBF1DB",
      color: isOver ? "var(--accent-700)" : "#7A5306",
      border: `1px solid ${isOver ? "#F0BFA0" : "#E9CD8B"}`,
    }}>
      <Icon name="alert-triangle" size={11} />
      {p.label}
    </span>
  );
}

Object.assign(window, { Acronym, AnnotationTab, AnnotationEditor, VerifiedStamp, ProximityChip });
