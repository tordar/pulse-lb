"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Music2 } from "lucide-react";
import { fetchListensSince, fetchPlayingNow, mergeNew, nextDelay, toLiveListen, type PlayingNow } from "@/lib/live/lbBrowser";
import { recordListens } from "@/lib/sync/liveDelta";
import { setImportStatus } from "@/lib/live/importStatus";
import type { IngestResult } from "@/lib/sync/ingest";

// The one live loop on every profile page. Every 15s while the tab is visible
// it asks ListenBrainz (directly, from the browser) for what's playing and for
// listens newer than the newest one this page has seen. New listens go on
// screen immediately via liveDelta; then the server is nudged to store them.
// A hidden tab stops entirely.
export function NowPlaying({ username, cursor }: { username: string; cursor: number | null }) {
  const [np, setNp] = useState<PlayingNow>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let since = cursor;
    let ingesting = false;
    let ingestAllowed = true;
    const seen = new Set<string>();

    async function ingest() {
      if (ingesting || !ingestAllowed) return;
      ingesting = true;
      try {
        while (!cancelled) {
          const r = await fetch(`/api/listens/ingest/${encodeURIComponent(username)}`, { method: "POST" });
          if (r.status === 402 || r.status === 404) { ingestAllowed = false; return; }
          if (!r.ok) return;
          const res = (await r.json()) as IngestResult;
          if (res.mode === "import") setImportStatus(res.more ? { imported: res.imported, target: res.target } : null);
          // "skipped" means another tab or viewer just stored them: refresh too.
          if (res.mode !== "busy") router.refresh();
          if (!("more" in res) || !res.more) return;
        }
      } catch {
        /* next new listen retries */
      } finally {
        ingesting = false;
      }
    }

    async function tick() {
      if (document.visibilityState !== "visible") return;
      try {
        const [playing, listens] = await Promise.all([
          fetchPlayingNow(username),
          since == null ? Promise.resolve([]) : fetchListensSince(username, since),
        ]);
        if (cancelled) return;
        setNp(playing);
        failures = 0;
        if (since == null) {
          void ingest(); // no aggregates yet: first import
        } else if (listens.length > 0) {
          since = listens[0].listened_at;
          const fresh = mergeNew(seen, listens.map(toLiveListen));
          if (fresh.length > 0) recordListens(fresh);
          void ingest();
        }
      } catch {
        failures++;
      }
      schedule();
    }

    function schedule() {
      if (cancelled || document.visibilityState !== "visible") return;
      timer = setTimeout(tick, nextDelay(failures));
    }
    function onVisibility() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (document.visibilityState === "visible") void tick();
    }

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [username, cursor, router]);

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
