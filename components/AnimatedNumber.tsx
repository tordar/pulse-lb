"use client";

import { useEffect, useRef, useState } from "react";
import { fmtHours } from "@/lib/format";
import {
  readTotalMs,
  readTotalPlays,
  useProjected,
  type Counters,
} from "@/lib/sync/liveDelta";

// Formatting happens client-side rather than via a prop, because these tiles
// are rendered from a server component and functions can't cross that boundary.
type Format = "int" | "durationMs";

// Which running total from an in-flight sync to add on top of the server value.
// Omitted for the distinct_* tiles: a new listen tells us nothing about whether
// its artist or album was already counted.
type Live = "plays" | "durationMs";

const NO_PROJECTION = () => 0;
const PROJECTIONS: Record<Live, (c: Counters) => number> = {
  plays: readTotalPlays,
  durationMs: readTotalMs,
};

const DURATION_MS = 600;
// How long the changed value stays tinted after it lands.
const FLASH_MS = 1000;

function render(value: number, format: Format): string {
  return format === "durationMs"
    ? fmtHours(value / 1000 / 3600)
    : Math.round(value).toLocaleString();
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// easeOutCubic — most of the distance is covered early, so the number reads as
// settling into place rather than crawling.
function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Counts from the currently displayed value up (or down) to `value` whenever it
 * changes. The first render paints the final value immediately — otherwise every
 * navigation to the page would replay the count from zero.
 */
export function AnimatedNumber({
  value: base,
  format = "int",
  live,
  className,
}: {
  value: number;
  format?: Format;
  live?: Live;
  className?: string;
}) {
  // While a sync runs the server figure is stale by design, so show it with the
  // listens the poller has since watched land added on top.
  const value = useProjected(base, live ? PROJECTIONS[live] : NO_PROJECTION);
  const [displayed, setDisplayed] = useState(value);
  const [flashing, setFlashing] = useState(false);
  // What's on screen right now. A second update landing mid-tween re-aims from
  // here, so the number never jumps back before running to the new target.
  const displayedRef = useRef(value);
  // The value we last animated toward, so a re-render carrying the same number
  // doesn't restart the tween.
  const targetRef = useRef(value);

  useEffect(() => {
    if (value === targetRef.current) return;
    targetRef.current = value;

    const reduced = prefersReducedMotion();
    const from = displayedRef.current;
    const start = performance.now();
    let frame = 0;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    const step = (now: number) => {
      // Reduced motion resolves on the first frame, so the value still lands —
      // it just doesn't travel there.
      const t = reduced ? 1 : Math.min(1, (now - start) / DURATION_MS);
      const next = from + (value - from) * ease(t);
      displayedRef.current = next;
      setDisplayed(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };

    // All of it runs inside the frame callback rather than the effect body, so
    // updating never cascades a synchronous re-render.
    frame = requestAnimationFrame((now) => {
      if (!reduced) {
        setFlashing(true);
        flashTimer = setTimeout(() => setFlashing(false), DURATION_MS + FLASH_MS);
      }
      step(now);
    });

    return () => {
      cancelAnimationFrame(frame);
      if (flashTimer) clearTimeout(flashTimer);
    };
  }, [value]);

  return (
    <span className={`${flashing ? "value-flash " : ""}${className ?? ""}`}>
      {render(displayed, format)}
    </span>
  );
}
