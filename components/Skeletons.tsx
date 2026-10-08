export function Sk({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

/** Generic content skeleton for the list/dashboard pages under /u/[username]. */
export function PageSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading">
      <div className="flex items-center gap-3">
        <Sk className="h-4 w-36" />
        <Sk className="h-8 w-24 rounded-md" />
      </div>
      <StatTilesSkeleton />
      <Sk className="h-72 rounded-lg" />
      <Sk className="h-44 rounded-lg" />
    </div>
  );
}

/** Detail-page skeleton mirroring the song/album/artist header layout. */
export function DetailSkeleton({ artwork = true }: { artwork?: boolean }) {
  return (
    <div className="space-y-8" role="status" aria-label="Loading">
      <Sk className="h-4 w-20" />
      <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
        {artwork && <Sk className="w-[240px] h-[240px] shrink-0 rounded-lg" />}
        <div className="flex-1 w-full flex flex-col items-center md:items-start space-y-3">
          <Sk className="h-3 w-14" />
          <Sk className="h-8 w-2/3 max-w-sm" />
          <Sk className="h-5 w-44" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-3 pt-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col items-center md:items-start gap-1.5">
                <Sk className="h-5 w-16" />
                <Sk className="h-3 w-12" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <Sk className="h-56 rounded-lg" />
      <Sk className="h-44 rounded-lg" />
    </div>
  );
}

/** One list row, same box as the real rows: 40px art, title + subtitle, value on the right. */
export function RowSkeleton({ shape = "square" }: { shape?: "square" | "circle" }) {
  return (
    <li className="flex items-center gap-3 py-2.5" aria-hidden>
      <Sk className={`size-10 shrink-0 ${shape === "circle" ? "rounded-full" : "rounded"}`} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Sk className="h-3.5 w-1/2 max-w-56" />
        <Sk className="h-3 w-1/3 max-w-40" />
      </div>
      <Sk className="h-3.5 w-14 shrink-0" />
    </li>
  );
}

/** A list in either of the two list-page views (grid of cards or rows). */
export function ListSkeleton({
  rows = 8,
  shape = "square",
  view = "list",
}: {
  rows?: number;
  shape?: "square" | "circle";
  view?: "grid" | "list";
}) {
  if (view === "grid") {
    return (
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4" role="status" aria-label="Loading">
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} className="flex flex-col gap-3 p-3 rounded-lg border border-card-border bg-card">
            <Sk className={`w-full aspect-square ${shape === "circle" ? "rounded-full" : "rounded-md"}`} />
            <Sk className="h-3.5 w-3/4" />
            <Sk className="h-3 w-1/2" />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-border" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <RowSkeleton key={i} shape={shape} />)}
    </ul>
  );
}

/** Placeholder for a row of <StatTile>s. */
export function StatTilesSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Sk key={i} className="h-16 sm:h-24 rounded-lg" />
      ))}
    </div>
  );
}

/** The value-over-label stat row used on detail headers. */
export function StatRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-3 md:flex md:flex-wrap md:gap-x-8 md:gap-y-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Sk className="h-5 w-12" />
          <Sk className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Search box + view toggle placeholder for the list-page header row. */
export function ControlsSkeleton() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <Sk className="h-9 w-56" />
      <Sk className="h-9 w-20" />
    </div>
  );
}
