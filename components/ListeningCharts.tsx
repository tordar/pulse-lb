"use client";

import { useRef, useState } from "react";
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

// The three listening charts share one card. Tabs pick a chart; on touch
// screens the strip also swipes sideways (scroll-snap), and the tabs follow.
export function ListeningCharts({
  yearly,
  hourly,
  releaseYears,
}: {
  yearly: YearPoint[];
  hourly: { hour: number; plays: number }[];
  releaseYears: YearPoint[];
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  function select(i: number) {
    setActive(i);
    const el = strip.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  function onScroll() {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    setActive(Math.round(el.scrollLeft / el.clientWidth));
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="tablist" className="inline-flex bg-card border border-border rounded-md overflow-hidden">
          {TABS.map((t, i) => (
            <button
              key={t.label}
              role="tab"
              aria-selected={active === i}
              onClick={() => select(i)}
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
      <div
        ref={strip}
        onScroll={onScroll}
        className="flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="w-full shrink-0 snap-start">
          <YearlyChart data={yearly} height={HEIGHT} />
        </div>
        <div className="w-full shrink-0 snap-start">
          <HourlyChart data={hourly} height={HEIGHT} />
        </div>
        <div className="w-full shrink-0 snap-start">
          <ReleaseYearChart data={releaseYears} height={HEIGHT} />
        </div>
      </div>
    </section>
  );
}
