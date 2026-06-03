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
    <div className="grid grid-cols-5 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-12 gap-2">
      {years.map((y) => {
        const isActive = y === active;
        return (
          <button
            key={y}
            onClick={() => setYear(y)}
            className={`w-full px-3 py-1.5 rounded-md text-sm font-medium tabular-nums transition-colors cursor-pointer ${
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
