"use client";

import { useEffect, useState } from "react";
import { Music2 } from "lucide-react";

type PlayingNow = {
  track_name: string;
  artist_name: string;
  release_name?: string | null;
  caa_id?: number | null;
  caa_release_mbid?: string | null;
} | null;

const POLL_MS = 30_000;

export function NowPlaying({ username }: { username: string }) {
  const [np, setNp] = useState<PlayingNow>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch(`/api/lb/playing-now/${encodeURIComponent(username)}`, {
          cache: "no-store",
        });
        if (!r.ok) return;
        const data = (await r.json()) as { listen: PlayingNow };
        if (!cancelled) setNp(data.listen);
      } catch {
        /* swallow — keep polling */
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [username]);

  const coverUrl =
    np?.caa_id && np.caa_release_mbid
      ? `https://archive.org/download/mbid-${np.caa_release_mbid}/mbid-${np.caa_release_mbid}-${np.caa_id}_thumb250.jpg`
      : null;

  return (
    <div className="hidden md:inline-flex items-center gap-2 bg-card border border-card-border rounded-full pl-1 pr-3 py-1 max-w-xs">
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
      ) : (
        <span className="w-7 h-7 rounded-full bg-muted grid place-items-center">
          <Music2 size={13} className={np ? "text-primary" : "text-subtle-foreground"} />
        </span>
      )}
      <span className="flex items-center gap-2 min-w-0">
        {np ? (
          <span className="relative w-2 h-2 shrink-0">
            <span className="absolute inset-0 rounded-full bg-primary animate-ping opacity-60" />
            <span className="absolute inset-0 rounded-full bg-primary" />
          </span>
        ) : (
          <span className="w-2 h-2 rounded-full bg-subtle-foreground/40 shrink-0" />
        )}
        {np ? (
          <span className="text-xs min-w-0 leading-tight">
            <span className="block truncate font-medium">{np.track_name}</span>
            <span className="block truncate text-muted-foreground">{np.artist_name}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground whitespace-nowrap">Nothing playing</span>
        )}
      </span>
    </div>
  );
}
