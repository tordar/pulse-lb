"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Music2 } from "lucide-react";
import { fetchListensSince, fetchPlayingNow, mergeNew, nextDelay, playingKey, toLiveListen, type PlayingNow } from "@/lib/live/lbBrowser";
import { recordListens } from "@/lib/sync/liveDelta";
import { setImportStatus } from "@/lib/live/importStatus";
import type { IngestResult } from "@/lib/sync/ingest";

// The one live loop on every profile page. Every 15s while the tab is visible
// it asks ListenBrainz (directly, from the browser) for what's playing and for
// listens newer than the newest one this page has seen. New listens go on
// screen immediately via liveDelta; then the server is nudged to store them.
// A hidden tab stops entirely.
const CONFIRM_MS = 2_000;

export function NowPlaying({ username, cursor }: { username: string; cursor: number | null }) {
  const [np, setNp] = useState<PlayingNow>(null);
  const router = useRouter();
  // Survive effect restarts: a refresh can hand back a server cursor that lags
  // what the browser has already seen (large catch-up cut short by the
  // throttle), and resetting these would count those listens twice.
  const sinceRef = useRef(cursor);
  const seenRef = useRef(new Set<string>());
  const userRef = useRef(username);
  const cursorRef = useRef(cursor);

  // The server cursor only wins when it is ahead of what we've seen.
  useEffect(() => {
    cursorRef.current = cursor;
    if (cursor != null && (sinceRef.current == null || cursor > sinceRef.current)) sinceRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    if (userRef.current !== username) {
      userRef.current = username;
      sinceRef.current = cursorRef.current;
      seenRef.current = new Set();
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let ticking = false;
    let ingesting = false;
    let ingestAllowed = true;
    const seen = seenRef.current;
    let shownKey = "";

    // Navidrome briefly reports an album's first track when you jump to another
    // track on it (seen as a ~1s blip on LB). A poll landing in that window used
    // to pin the wrong song for a whole interval, so a change is only shown once
    // a second read a moment later agrees.
    async function confirmPlaying(playing: PlayingNow): Promise<PlayingNow> {
      if (playingKey(playing) === shownKey) return playing;
      await new Promise((r) => setTimeout(r, CONFIRM_MS));
      return fetchPlayingNow(username);
    }

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
          // Nothing to import and nothing new: stop re-ingesting, let the
          // browser-side poll take over from now.
          if (sinceRef.current == null && res.mode !== "import" && res.mode !== "busy") {
            sinceRef.current = Math.floor(Date.now() / 1000);
          }
          // "skipped" means another tab or viewer just stored them: refresh too.
          if (res.mode === "import" || res.mode === "skipped" || (res.mode === "live" && res.added > 0)) router.refresh();
          if (!("more" in res) || !res.more) return;
        }
      } catch {
        /* next new listen retries */
      } finally {
        ingesting = false;
      }
    }

    async function tick() {
      if (ticking || document.visibilityState !== "visible") return;
      ticking = true;
      try {
        const since = sinceRef.current;
        const [playing, listens] = await Promise.all([
          fetchPlayingNow(username),
          since == null ? Promise.resolve([]) : fetchListensSince(username, since),
        ]);
        if (cancelled) return;
        const confirmed = await confirmPlaying(playing);
        if (cancelled) return;
        shownKey = playingKey(confirmed);
        setNp(confirmed);
        failures = 0;
        if (since == null) {
          void ingest(); // no aggregates yet: first import
        } else if (listens.length > 0) {
          if (sinceRef.current == null || listens[0].listened_at > sinceRef.current) sinceRef.current = listens[0].listened_at;
          const fresh = mergeNew(seen, listens.map(toLiveListen));
          if (fresh.length > 0) recordListens(fresh);
          void ingest();
        }
      } catch {
        failures++;
      }
      ticking = false;
      schedule();
    }

    function schedule() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (cancelled || document.visibilityState !== "visible") return;
      timer = setTimeout(tick, nextDelay(failures));
    }
    function onVisibility() {
      if (timer) { clearTimeout(timer); timer = null; }
      // An in-flight tick reschedules itself when it lands.
      if (document.visibilityState === "visible" && !ticking) void tick();
    }

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [username, router]);

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
