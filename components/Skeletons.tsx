function Sk({ className = "" }: { className?: string }) {
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Sk key={i} className="h-24 rounded-lg" />
        ))}
      </div>
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
