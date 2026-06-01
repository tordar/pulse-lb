type Day = { date: string; plays: number };

export function Heatmap({ days, max }: { days: Day[]; max?: number }) {
  if (days.length === 0) return null;

  const limit = max ?? Math.max(1, ...days.map((d) => d.plays));
  const byDate = new Map(days.map((d) => [d.date, d.plays]));

  // Build the week-column grid: starts on the Sunday on/before the first day.
  const first = parseDate(days[0].date);
  const last = parseDate(days[days.length - 1].date);
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // back to Sunday
  const totalCells = Math.ceil((last.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1;
  const weeks = Math.ceil(totalCells / 7);

  const cells: { date: string; plays: number; inRange: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const inRange = d >= first && d <= last;
    cells.push({ date: iso, plays: byDate.get(iso) ?? 0, inRange });
  }

  // Month labels: emit one above the column where a new month starts (only Sundays counted).
  const monthLabels: { col: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const c = cells[w * 7];
    const d = parseDate(c.date);
    const isFirstOfMonth = d.getUTCDate() <= 7;
    if (isFirstOfMonth && c.inRange) {
      monthLabels.push({ col: w, label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) });
    }
  }

  const cellSize = 12;
  const gap = 2;
  const gridWidth = weeks * (cellSize + gap);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block" style={{ minWidth: gridWidth + 32 }}>
        <div className="flex" style={{ marginLeft: 32 }}>
          {Array.from({ length: weeks }).map((_, w) => {
            const m = monthLabels.find((l) => l.col === w);
            return (
              <div key={w} style={{ width: cellSize + gap, fontSize: 10 }} className="text-gray-500 mb-1">
                {m?.label ?? ""}
              </div>
            );
          })}
        </div>
        <div className="flex gap-[2px]">
          <div className="flex flex-col gap-[2px] mr-2 text-[10px] text-gray-500" style={{ width: 24 }}>
            {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
              <div key={i} style={{ height: cellSize, lineHeight: `${cellSize}px` }}>
                {d}
              </div>
            ))}
          </div>
          <div
            className="grid gap-[2px]"
            style={{
              gridTemplateColumns: `repeat(${weeks}, ${cellSize}px)`,
              gridTemplateRows: `repeat(7, ${cellSize}px)`,
              gridAutoFlow: "column",
            }}
          >
            {cells.map((c, i) => {
              const level = c.inRange ? bucket(c.plays, limit) : -1;
              const cls = colorFor(level);
              const title = c.inRange ? `${c.date} · ${c.plays} ${c.plays === 1 ? "play" : "plays"}` : "";
              return <div key={i} className={`rounded-sm ${cls}`} title={title} />;
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-gray-500">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span key={lvl} className={`w-3 h-3 rounded-sm ${colorFor(lvl)}`} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

function parseDate(s: string): Date {
  // Force UTC interpretation of YYYY-MM-DD strings
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

function colorFor(level: number): string {
  switch (level) {
    case -1:
      return "bg-transparent";
    case 0:
      return "bg-gray-100 dark:bg-zinc-800/60";
    case 1:
      return "bg-emerald-200 dark:bg-emerald-900/60";
    case 2:
      return "bg-emerald-400 dark:bg-emerald-700/70";
    case 3:
      return "bg-emerald-500 dark:bg-emerald-500/90";
    case 4:
      return "bg-emerald-600 dark:bg-emerald-400";
    default:
      return "bg-gray-100";
  }
}
