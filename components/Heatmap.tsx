import Link from "next/link";
import type { DayPoint } from "./DayTooltip";

export function Heatmap({
  days,
  max,
  hrefFor,
  activeDate,
}: {
  days: DayPoint[];
  max?: number;
  hrefFor?: (date: string) => string;
  activeDate?: string | null;
}) {
  if (days.length === 0) return null;

  // Shading tracks listening TIME, matching the bar view's bar heights.
  const limit = max ?? Math.max(1, ...days.map((d) => d.effective_ms));
  const byDate = new Map(days.map((d) => [d.date, d]));

  const first = parseDate(days[0].date);
  const last = parseDate(days[days.length - 1].date);
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const totalCells = Math.ceil((last.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1;
  const weeks = Math.ceil(totalCells / 7);

  const today = new Date().toISOString().slice(0, 10);

  const cells: {
    date: string;
    plays: number;
    ms: number;
    inRange: boolean;
    future: boolean;
    col: number;
    row: number;
  }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const inRange = d >= first && d <= last;
    const point = byDate.get(iso);
    cells.push({
      date: iso,
      plays: point?.plays ?? 0,
      ms: point?.effective_ms ?? 0,
      inRange,
      future: iso > today,
      col: Math.floor(i / 7) + 1,
      row: (i % 7) + 1,
    });
  }

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

  return (
    <div
      className="heatmap-root"
      style={{ ["--weeks-count" as string]: weeks } as React.CSSProperties}
    >
      <div className="heatmap-area">
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
            if (c.future) {
              return (
                <span
                  key={i}
                  className="cell future"
                  style={{ gridColumn: c.col, gridRow: c.row }}
                  aria-hidden
                />
              );
            }
            const level = bucket(c.ms, limit, c.plays);
            const label = `${c.date} · ${c.plays} ${c.plays === 1 ? "play" : "plays"}`;
            const active = activeDate === c.date;
            const className = `cell${active ? " active" : ""}`;
            // No `title` — the browser's ~1s delay is what the custom tooltip
            // in DayTooltip replaces. aria-label still carries the same text.
            if (hrefFor) {
              return (
                <Link
                  key={i}
                  href={hrefFor(c.date)}
                  className={className}
                  data-level={level}
                  data-day={c.date}
                  style={{ gridColumn: c.col, gridRow: c.row }}
                  aria-label={label}
                  scroll={false}
                />
              );
            }
            return (
              <button
                key={i}
                type="button"
                className={className}
                data-level={level}
                data-day={c.date}
                style={{ gridColumn: c.col, gridRow: c.row }}
                aria-label={label}
              />
            );
          })}
        </div>
      </div>

    </div>
  );
}

function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}

// `plays` only breaks the ms === 0 tie: days we know were listened to but have
// no duration coverage yet still get the faintest fill instead of reading as
// silence.
function bucket(ms: number, max: number, plays: number): number {
  if (ms === 0) return plays > 0 ? 1 : 0;
  const r = ms / max;
  if (r < 0.15) return 1;
  if (r < 0.35) return 2;
  if (r < 0.65) return 3;
  return 4;
}
