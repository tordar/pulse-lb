"use client";

import { useCallback, useMemo, useState } from "react";
import { fmtListeningTime } from "@/lib/format";

export type DayPoint = { date: string; plays: number; effective_ms: number };

type Tip = { point: DayPoint; x: number; y: number };

/**
 * Hover/focus state shared by the heatmap and the day-bar views.
 *
 * Two deliberate choices: the handlers are meant for ONE container element and
 * find the hovered day by walking up from the event target to the nearest
 * `[data-day]`, so 365 marks cost one listener instead of 365 — and the bubble
 * is `position: fixed`, so the horizontal scroller around either plot can't
 * clip it. There is no open delay; `title` attributes (which the browser
 * delays ~1s) are deliberately absent from the marks.
 */
export function useDayTooltip(days: DayPoint[]) {
  const [tip, setTip] = useState<Tip | null>(null);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const show = useCallback(
    (e: React.SyntheticEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-day]");
      // Hovering the gaps between marks keeps the last tooltip rather than
      // flickering it off — leaving the plot entirely is what closes it.
      if (!el?.dataset.day) return;
      const point = byDate.get(el.dataset.day);
      if (!point) return;
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 90), window.innerWidth - 90);
      setTip({ point, x, y: r.top });
    },
    [byDate],
  );

  const hide = useCallback(() => setTip(null), []);

  return {
    tip,
    // onMouseOver rather than onMouseEnter (enter doesn't bubble, so it would
    // never fire for the children). React's onFocus IS focusin, so it bubbles.
    handlers: { onMouseOver: show, onMouseLeave: hide, onFocus: show, onBlur: hide },
  };
}

export function DayTooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const { plays, effective_ms } = tip.point;
  return (
    <div className="day-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
      <div className="day-tip-date">{fmtTipDate(tip.point.date)}</div>
      <div className="day-tip-stat">
        {plays === 0
          ? "No listening"
          : `${effective_ms > 0 ? fmtListeningTime(effective_ms) : "duration unknown"} · ${plays.toLocaleString()} ${plays === 1 ? "play" : "plays"}`}
      </div>
    </div>
  );
}

function fmtTipDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
