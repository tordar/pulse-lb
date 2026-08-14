import Link from "next/link";
import type { DayPoint } from "./DayTooltip";

/**
 * One bar per day of the year, height = listening time. Same data and same
 * click target as the heatmap; the bar chart just trades the heatmap's
 * week/weekday layout for a readable magnitude axis.
 */
export function DayBars({
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

  const limit = max ?? Math.max(1, ...days.map((d) => d.effective_ms));
  const today = new Date().toISOString().slice(0, 10);

  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  days.forEach((d, i) => {
    const month = Number(d.date.slice(5, 7));
    if (month !== lastMonth) {
      monthLabels.push({
        col: i + 1,
        label: new Date(`${d.date}T00:00:00Z`).toLocaleString("en-US", {
          month: "short",
          timeZone: "UTC",
        }),
      });
      lastMonth = month;
    }
  });

  return (
    <div
      className="daybars-root"
      style={{ ["--days-count" as string]: days.length } as React.CSSProperties}
    >
      <div className="daybars-area">
        <div className="daybars-axis">
          <span>{axisLabel(limit)}</span>
          <span>{axisLabel(limit / 2)}</span>
          <span>0</span>
        </div>

        <div className="daybars-plot">
          <span className="daybars-line" style={{ top: 0 }} aria-hidden />
          <span className="daybars-line" style={{ top: "50%" }} aria-hidden />

          {days.map((d) => {
            if (d.date > today) {
              return <span key={d.date} className="daybar-col future" aria-hidden />;
            }
            // A day with plays but no duration coverage gets a fixed dim stub
            // rather than a zero-height bar it can't be told apart from.
            const unknown = d.plays > 0 && d.effective_ms === 0;
            const pct = unknown ? 0 : (d.effective_ms / limit) * 100;
            const label = `${d.date} · ${d.plays} ${d.plays === 1 ? "play" : "plays"}`;
            const className = `daybar-col${activeDate === d.date ? " active" : ""}`;
            const bar =
              d.plays > 0 ? (
                <span
                  className={`daybar${unknown ? " unknown" : ""}`}
                  style={unknown ? undefined : { height: `${Math.max(pct, 1.2)}%` }}
                />
              ) : null;

            if (hrefFor) {
              return (
                <Link
                  key={d.date}
                  href={hrefFor(d.date)}
                  className={className}
                  data-day={d.date}
                  aria-label={label}
                  scroll={false}
                >
                  {bar}
                </Link>
              );
            }
            return (
              <button
                key={d.date}
                type="button"
                className={className}
                data-day={d.date}
                aria-label={label}
              >
                {bar}
              </button>
            );
          })}
        </div>

        <div className="daybars-months">
          {monthLabels.map((m) => (
            <span key={m.col} className="month-label" style={{ gridColumn: m.col }}>
              {m.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// Deliberately terser than fmtListeningTime: axis ticks have to fit the narrow
// gutter the heatmap's weekday labels use, so the plot doesn't shift on toggle.
function axisLabel(ms: number): string {
  const h = ms / 3_600_000;
  if (h === 0) return "0";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 10) return `${h.toFixed(1).replace(/\.0$/, "")}h`;
  return `${Math.round(h)}h`;
}
