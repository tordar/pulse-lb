// app/_landing/useLiveListens.ts
"use client";
import { useEffect, useRef } from "react";
import { fetchListensSince, nextDelay, type LBListen } from "@/lib/live/lbBrowser";

/**
 * Polls ListenBrainz (directly, from the browser) for the showcase user's listens newer
 * than the payload's last one. `quiet` is true for the first catch-up (the payload can be
 * up to an hour old) and for whatever piled up while the tab was hidden.
 */
export function useLiveListens(user: string, lastTs: number | null, onListens: (listens: LBListen[], quiet: boolean) => void) {
  const cb = useRef(onListens);
  useEffect(() => { cb.current = onListens; });

  useEffect(() => {
    if (lastTs == null) return;
    let since = lastTs, quiet = true, failures = 0, timer = 0, cancelled = false, ticking = false;
    const seen = new Set<string>();

    async function tick() {
      if (ticking || document.visibilityState !== "visible") return;
      ticking = true;
      try {
        const listens = await fetchListensSince(user, since);
        if (cancelled) return;
        failures = 0;
        // LB's min_ts is exclusive, but a re-poll can still overlap; oldest first so they fly in order.
        const fresh = listens.filter((l) => {
          const k = `${l.listened_at}|${l.track_metadata.track_name}`;
          if (seen.has(k)) return false;
          seen.add(k); return true;
        }).reverse();
        if (listens.length) since = Math.max(since, listens[0].listened_at);
        if (fresh.length) cb.current(fresh, quiet);
        quiet = false;
      } catch {
        failures++;
      } finally {
        ticking = false;
      }
      schedule();
    }
    function schedule() {
      window.clearTimeout(timer);
      if (!cancelled && document.visibilityState === "visible") timer = window.setTimeout(tick, nextDelay(failures));
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") { quiet = true; void tick(); } else window.clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => { cancelled = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [user, lastTs]);
}
