"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function YearNav({
  year,
  prevYear,
  nextYear,
}: {
  year: number;
  prevYear: number | null;
  nextYear: number | null;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const mkHref = (y: number) => {
    const next = new URLSearchParams(params);
    next.set("year", String(y));
    next.delete("day");
    return `${pathname}?${next}`;
  };

  return (
    <div className="inline-flex items-center gap-1 bg-card border border-card-border rounded-full p-1">
      {prevYear !== null ? (
        <Link
          href={mkHref(prevYear)}
          scroll={false}
          aria-label={`View ${prevYear}`}
          className="p-1.5 rounded-full text-foreground/80 hover:bg-muted transition-colors"
        >
          <ChevronLeft size={14} />
        </Link>
      ) : (
        <span className="p-1.5 text-subtle-foreground/60">
          <ChevronLeft size={14} />
        </span>
      )}
      <span className="px-3 text-sm font-medium tabular-nums">{year}</span>
      {nextYear !== null ? (
        <Link
          href={mkHref(nextYear)}
          scroll={false}
          aria-label={`View ${nextYear}`}
          className="p-1.5 rounded-full text-foreground/80 hover:bg-muted transition-colors"
        >
          <ChevronRight size={14} />
        </Link>
      ) : (
        <span className="p-1.5 text-subtle-foreground/60">
          <ChevronRight size={14} />
        </span>
      )}
    </div>
  );
}
