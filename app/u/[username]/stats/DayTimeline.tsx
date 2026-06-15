"use client";

import { useMemo, useState } from "react";

type Listen = {
  listened_at: string;
  track_name: string;
  artist_name: string;
};

// Distinct, reasonably high-contrast hues cycled by order of first appearance,
// so the busiest artists of the day get the most separable colors. Artists
// beyond the palette wrap around — acceptable for a glanceable timeline.
const PALETTE = [
  "#22c55e", "#38bdf8", "#f472b6", "#fb923c", "#a78bfa", "#facc15",
  "#34d399", "#60a5fa", "#fb7185", "#c084fc", "#2dd4bf", "#f59e0b",
  "#4ade80", "#e879f9", "#818cf8", "#fbbf24",
];

// listened_at is stored/displayed in UTC throughout the day detail, so the
// timeline reads the UTC clock too — matching the time labels in the list.
function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function DayTimeline({ listens }: { listens: Listen[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const { colorFor } = useMemo(() => {
    const map = new Map<string, string>();
    let next = 0;
    for (const l of listens) {
      if (!map.has(l.artist_name)) {
        map.set(l.artist_name, PALETTE[next % PALETTE.length]);
        next++;
      }
    }
    return { colorFor: (a: string) => map.get(a) ?? PALETTE[0] };
  }, [listens]);

  if (listens.length === 0) return null;

  const active = hover != null ? listens[hover] : null;
  const activeLeft = hover != null ? (minuteOfDay(listens[hover].listened_at) / 1440) * 100 : 0;

  return (
    <div className="space-y-1.5">
      <div className="relative h-12 select-none">
        {/* Hour gridlines every 6h */}
        {[6, 12, 18].map((h) => (
          <div
            key={h}
            className="absolute inset-y-0 w-px bg-border/60"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
        {/* Play markers */}
        {listens.map((l, i) => {
          const left = (minuteOfDay(l.listened_at) / 1440) * 100;
          const isActive = hover === i;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              aria-label={`${l.track_name} — ${l.artist_name}`}
              className="absolute top-0 bottom-0 -translate-x-1/2 cursor-default"
              style={{ left: `${left}%`, width: 10 }}
            >
              <span
                className="absolute inset-y-1 left-1/2 -translate-x-1/2 rounded-full transition-all"
                style={{
                  width: isActive ? 4 : 2.5,
                  backgroundColor: colorFor(l.artist_name),
                  opacity: hover == null || isActive ? 0.9 : 0.35,
                }}
              />
            </button>
          );
        })}
        {/* Tooltip */}
        {active && (
          <div
            className="absolute bottom-full mb-1.5 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg pointer-events-none"
            style={{ left: `${Math.min(92, Math.max(8, activeLeft))}%` }}
          >
            <span className="tabular-nums text-subtle-foreground">
              {new Date(active.listened_at).toISOString().slice(11, 16)}
            </span>{" "}
            <span className="text-foreground">{active.track_name}</span>
            <span className="text-subtle-foreground"> · {active.artist_name}</span>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-subtle-foreground">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}
