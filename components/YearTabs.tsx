"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function YearTabs({ years, active }: { years: number[]; active: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setYear(y: number) {
    const next = new URLSearchParams(params);
    next.set("year", String(y));
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {years.map((y) => {
        const isActive = y === active;
        return (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium tabular-nums transition-colors ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border text-foreground/80 hover:bg-muted"
            }`}
          >
            {y}
          </button>
        );
      })}
    </div>
  );
}
