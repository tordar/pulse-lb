"use client";

import { useState } from "react";
import { CalendarDays, ChartNoAxesColumn } from "lucide-react";
import { DayBars } from "./DayBars";
import { Heatmap } from "./Heatmap";
import { DayTooltip, useDayTooltip, type DayPoint } from "./DayTooltip";

type View = "heatmap" | "bars";

/**
 * The year card's activity plot: a heatmap/bar-chart switch over one shared
 * dataset. The view lives in local state (instant switch, no server round-trip)
 * and the tooltip handlers sit on the wrapper so both views get them for free —
 * each only has to tag its marks with `data-day`.
 *
 * `heading` and `nav` come in as pre-rendered nodes so the server page keeps
 * owning that markup while the toggle can sit in the same header row.
 */
export function YearActivity({
  days,
  year,
  activeDate,
  heading,
  nav,
}: {
  days: DayPoint[];
  year: number;
  activeDate?: string | null;
  heading: React.ReactNode;
  nav: React.ReactNode;
}) {
  const [view, setView] = useState<View>("heatmap");
  const { tip, handlers } = useDayTooltip(days);

  const hrefFor = (date: string) =>
    `?${new URLSearchParams({ year: String(year), day: date })}`;

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {heading}
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-card border border-card-border rounded-md overflow-hidden">
            <ViewButton
              active={view === "heatmap"}
              onClick={() => setView("heatmap")}
              label="Heatmap view"
            >
              <CalendarDays size={15} />
            </ViewButton>
            <ViewButton
              active={view === "bars"}
              onClick={() => setView("bars")}
              label="Bar chart view"
              divider
            >
              <ChartNoAxesColumn size={15} />
            </ViewButton>
          </div>
          {nav}
        </div>
      </div>

      {/* The tooltip lives INSIDE this wrapper, not as a sibling of it. It is
          position:fixed either way, but the parent section uses Tailwind's
          space-y-4 — which in v4 is `> :not(:last-child) { margin-bottom }` —
          so an extra section-level child would hand the chart a 16px bottom
          margin and make the card grow on hover. */}
      <div {...handlers}>
        {view === "heatmap" ? (
          <Heatmap days={days} activeDate={activeDate} hrefFor={hrefFor} />
        ) : (
          <DayBars days={days} activeDate={activeDate} hrefFor={hrefFor} />
        )}
        <DayTooltip tip={tip} />
      </div>
    </>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  divider,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  divider?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`px-2.5 py-1.5 transition-colors ${divider ? "border-l border-card-border" : ""} ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-foreground/70 hover:bg-muted active:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
