"use client";

import { useEffect, useRef, useState } from "react";
import { fmtHours } from "@/lib/format";

// Formatting happens client-side rather than via a prop, because these tiles
// are rendered from a server component and functions can't cross that boundary.
type Format = "int" | "hours";

const DURATION_MS = 600;
// How long the changed value stays tinted after it lands.
const FLASH_MS = 1000;

function render(value: number, format: Format): string {
  return format === "hours" ? fmtHours(value) : Math.round(value).toLocaleString();
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
  value,
  format = "int",
  className,
}: {
  value: number;
  format?: Format;
  className?: string;
}) {
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
