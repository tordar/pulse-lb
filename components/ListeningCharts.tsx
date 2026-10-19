"use client";

import { useState } from "react";
import { YearlyChart } from "@/components/YearlyChart";
import { HourlyChart } from "@/components/HourlyChart";
import { ReleaseYearChart } from "@/components/ReleaseYearChart";

type YearPoint = { year: number; plays: number; hours: number };

const TABS = [
  { label: "By year", caption: "hours listened" },
  { label: "By hour", caption: "plays by hour of day, all-time" },
  { label: "Release year", caption: "hours listened, by album release year" },
] as const;

const HEIGHT = 360;

// The three listening charts share one card; tabs pick which one shows. No
// swipe between them: a horizontal drag scrubs the tooltip along the bars.
export function ListeningCharts({
  yearly,
  hourly,
  releaseYears,
}: {
  yearly: YearPoint[];
  hourly: { hour: number; plays: number }[];
  releaseYears: YearPoint[];
}) {
  const [active, setActive] = useState(0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="tablist" className="inline-flex bg-card border border-border rounded-md overflow-hidden">
          {TABS.map((t, i) => (
            <button
              key={t.label}
              role="tab"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                i > 0 ? "border-l border-border" : ""
              } ${
                active === i
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/80 hover:bg-muted active:bg-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-subtle-foreground">({TABS[active].caption})</span>
      </div>
      {active === 0 && <YearlyChart data={yearly} height={HEIGHT} />}
      {active === 1 && <HourlyChart data={hourly} height={HEIGHT} />}
      {active === 2 && <ReleaseYearChart data={releaseYears} height={HEIGHT} />}
    </section>
  );
}
