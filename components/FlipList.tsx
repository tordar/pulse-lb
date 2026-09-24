"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

const DURATION_MS = 400;
// Below this, a "move" is just sub-pixel layout noise and animating it only
// makes the list shimmer on every refresh.
const MIN_DELTA_PX = 2;

// useLayoutEffect warns during SSR; this component's measuring only ever means
// anything in the browser.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * FLIP-animates its children between renders: any child carrying a
 * `data-flip-key` that lands at a different offset than last time is snapped
 * back to its old position and then transitioned to the new one, so rows
 * visibly slide past each other when the ranking shifts. Children that are new
 * this render fade in instead.
 *
 * Offsets are measured relative to the container, not the viewport, so the list
 * doesn't animate just because something above it changed height.
 *
 * Exits are not animated — that would mean holding removed rows in the DOM, and
 * an item falling off the bottom of a top-10 list doesn't earn the machinery.
 */
export function FlipList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLOListElement>(null);
  const prevOffsets = useRef<Map<string, number>>(new Map());

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>("[data-flip-key]"));
    const rootTop = root.getBoundingClientRect().top;
    const next = new Map<string, number>();
    for (const el of items) {
      next.set(el.dataset.flipKey!, el.getBoundingClientRect().top - rootTop);
    }

    const prev = prevOffsets.current;
    prevOffsets.current = next;

    // Nothing to compare against on the first pass, and no work to do at all if
    // the reader has asked for less motion.
    if (prev.size === 0 || prefersReducedMotion()) return;

    const cleanups: (() => void)[] = [];
    for (const el of items) {
      const key = el.dataset.flipKey!;
      const before = prev.get(key);
      const after = next.get(key)!;

      if (before === undefined) {
        el.classList.add("flip-enter");
        const t = setTimeout(() => el.classList.remove("flip-enter"), DURATION_MS);
        cleanups.push(() => clearTimeout(t));
        continue;
      }

      const delta = before - after;
      if (Math.abs(delta) < MIN_DELTA_PX) continue;

      // Invert: put it back where it was, with no transition...
      el.style.transition = "none";
      el.style.transform = `translateY(${delta}px)`;
      // ...then play: next frame, let it travel to its real position.
      const frame = requestAnimationFrame(() => {
        el.style.transition = `transform ${DURATION_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
        el.style.transform = "";
      });
      const t = setTimeout(() => {
        el.style.transition = "";
      }, DURATION_MS + 50);
      cleanups.push(() => {
        cancelAnimationFrame(frame);
        clearTimeout(t);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  });

  return (
    <ol ref={ref} className={className}>
      {children}
    </ol>
  );
}
