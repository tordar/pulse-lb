type Day = { date: string; plays: number };

export function Heatmap({ days, max }: { days: Day[]; max?: number }) {
  if (days.length === 0) return null;

  const limit = max ?? Math.max(1, ...days.map((d) => d.plays));
  const byDate = new Map(days.map((d) => [d.date, d.plays]));

  // Build column-major grid: starts on the Sunday on or before the first day.
  const first = parseDate(days[0].date);
  const last = parseDate(days[days.length - 1].date);
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const totalCells = Math.ceil((last.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1;
  const weeks = Math.ceil(totalCells / 7);

  const cells: { date: string; plays: number; inRange: boolean; col: number; row: number }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const inRange = d >= first && d <= last;
    cells.push({
      date: iso,
      plays: byDate.get(iso) ?? 0,
      inRange,
      col: Math.floor(i / 7) + 1,
      row: (i % 7) + 1,
    });
  }

  // Month labels shown above the first week of each calendar month
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const top = cells[w * 7];
    const d = parseDate(top.date);
    const m = d.getUTCMonth();
    if (m !== lastMonth && top.inRange) {
      monthLabels.push({
        col: w + 1,
        label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }),
      });
      lastMonth = m;
    }
  }

  const yearLabel = `${first.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${first.getUTCFullYear()} – ${last.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${last.getUTCFullYear()}`;

  return (
    <div
      className="heatmap-root"
      style={{ ["--weeks-count" as string]: weeks } as React.CSSProperties}
    >
      <div className="heatmap-area">
        <span className="year-label">{yearLabel}</span>

        <div className="month-row">
          {monthLabels.map((m) => (
            <span key={m.col} className="month-label" style={{ gridColumn: m.col }}>
              {m.label}
            </span>
          ))}
        </div>

        <div className="day-col">
          {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
            <span key={i} className="day-label">
              {d}
            </span>
          ))}
        </div>

        <div className="heatmap-grid">
          {cells.map((c, i) => {
            const level = c.inRange ? bucket(c.plays, limit) : -1;
            if (!c.inRange) {
              return (
                <span
                  key={i}
                  className="cell outside"
                  style={{ gridColumn: c.col, gridRow: c.row }}
                  aria-hidden
                />
              );
            }
            const title = `${c.date} · ${c.plays} ${c.plays === 1 ? "play" : "plays"}`;
            return (
              <button
                key={i}
                type="button"
                className="cell"
                data-level={level}
                style={{ gridColumn: c.col, gridRow: c.row }}
                title={title}
                aria-label={title}
              />
            );
          })}
        </div>
      </div>

      <div className="heatmap-legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((lvl) => (
          <span key={lvl} className="cell legend-cell" data-level={lvl} aria-hidden />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

function bucket(plays: number, max: number): number {
  if (plays === 0) return 0;
  const r = plays / max;
  if (r < 0.15) return 1;
  if (r < 0.35) return 2;
  if (r < 0.65) return 3;
  return 4;
}
