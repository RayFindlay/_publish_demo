// Calendar, month grid showing trip activity & flags per day.
// Conservative styling: subtle left-border tint, small dot for flags,
// trip count in the corner. Click a day to drill into trip detail.

const { useState: useStateCal, useMemo: useMemoCal } = React;

function MonthCalendar({ year, month, byDay, onDay, focusedDate, weightCritical }) {
  // Build grid: weeks starting Sunday. Always 6 rows for a stable layout.
  const first = new Date(Date.UTC(year, month, 1));
  const startDow = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  while (cells.length < 42) cells.push(null);
  const weeks = [];
  for (let w = 0; w < cells.length / 7; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));

  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
        borderBottom: "1px solid var(--rule)",
        paddingBottom: 8, marginBottom: 8,
      }}>
        {dows.map((d, i) => (
          <div key={d} style={{
            font: "600 10.5px/1 var(--font-sans)",
            letterSpacing: "0.14em", textTransform: "uppercase",
            color: i === 0 || i === 6 ? "var(--steel-500)" : "var(--fg-muted)",
            padding: "0 6px",
          }}>{d}</div>
        ))}
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gridTemplateRows: "repeat(6, 1fr)",
        gap: 4, flex: 1, minHeight: 0,
      }}>
        {weeks.flat().map((d, idx) => {
          if (!d) return <div key={idx} style={{ background: "var(--steel-50)", border: "1px solid var(--rule)", borderRadius: 2, opacity: 0.4 }} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const data = byDay[iso];
          const isFocused = focusedDate === iso;
          return (
            <DayCell key={iso} day={d} iso={iso} data={data}
              focused={isFocused} onClick={() => onDay?.(iso)} weightCritical={weightCritical} />
          );
        })}
      </div>
    </div>
  );
}

function DayCell({ day, iso, data, focused, onClick, weightCritical }) {
  const has = data && data.total > 0;
  const flagged = data && data.flags > 0;

  // Conservative status: subtle left border. No alarming color blocks.
  let leftBorder = "1px solid var(--rule)";
  if (has) leftBorder = `2px solid var(--navy-700)`;
  if (flagged) leftBorder = `2px solid var(--accent-600)`;

  return (
    <button onClick={onClick} style={{
      textAlign: "left", cursor: "pointer", font: "inherit",
      background: focused ? "#F6F4EF" : "var(--white)",
      border: "1px solid var(--border)",
      borderLeft: leftBorder,
      borderRadius: 2,
      padding: "6px 8px 8px",
      display: "flex", flexDirection: "column",
      gap: 4, minHeight: 0, overflow: "hidden",
      transition: "background 120ms ease, border-color 120ms ease",
      outline: focused ? "1px solid var(--navy-700)" : "none",
    }}
      onMouseEnter={e => { if (!focused) e.currentTarget.style.background = "var(--steel-50)"; }}
      onMouseLeave={e => { if (!focused) e.currentTarget.style.background = "var(--white)"; }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
        <span style={{
          font: `${has ? 600 : 500} 12.5px/1 var(--font-sans)`,
          color: has ? "var(--navy-900)" : "var(--steel-500)",
        }}>{day}</span>
        {flagged && <Dot tone="flag" size={6} />}
      </div>
      {has && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
          <div style={{
            font: "500 11px/1.2 var(--font-sans)", color: "var(--navy-800)",
            display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6,
          }}>
            <span style={{ color: "var(--fg-muted)" }}>{data.total === 1 ? "1 trip" : `${data.total} trips`}</span>
            <span style={{ font: "600 11px/1.2 var(--font-mono)", color: "var(--navy-900)" }}>
              {data.km.toFixed(0)}<span style={{ font: "10px/1 var(--font-sans)", color: "var(--fg-muted)", marginLeft: 2 }}>km</span>
            </span>
          </div>
          {data.units.size > 1 && (
            <div style={{ font: "11px/1 var(--font-sans)", color: "var(--fg-muted)" }}>
              {data.units.size} units
            </div>
          )}
          {flagged && (
            <div style={{
              font: "600 10.5px/1 var(--font-sans)", letterSpacing: "0.04em",
              color: "var(--accent-700)", marginTop: "auto",
            }}>
              {data.flags === 1 ? "1 flag" : `${data.flags} flags`}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

Object.assign(window, { MonthCalendar });
