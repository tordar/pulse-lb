"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function YearTabs({ years, active }: { years: number[]; active: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const rowRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // On phones the years are one swipeable row; keep the selected one visible.
  useEffect(() => {
    // Scroll only the row: scrollIntoView would also drag the page down to it.
    const row = rowRef.current;
    const btn = activeRef.current;
    if (!row || !btn) return;
    row.scrollLeft = btn.offsetLeft - (row.clientWidth - btn.offsetWidth) / 2;
  }, [active]);

  function setYear(y: number) {
    const next = new URLSearchParams(params);
    next.set("year", String(y));
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <div ref={rowRef} className="relative flex overflow-x-auto gap-2 -mx-5 px-5 [scrollbar-width:none] sm:mx-0 sm:px-0 sm:grid sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-12 sm:overflow-visible">
      {years.map((y) => {
        const isActive = y === active;
        return (
          <button
            key={y}
            ref={isActive ? activeRef : undefined}
            onClick={() => setYear(y)}
            className={`shrink-0 sm:w-full px-3 py-1.5 rounded-md text-sm font-medium tabular-nums transition active:scale-95 cursor-pointer ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {y}
          </button>
        );
      })}
    </div>
  );
}
