// app/_landing/useLiveListens.ts
"use client";
import { useEffect, useRef } from "react";
import { fetchListensSince, fetchPlayingNow, nextDelay, type LBListen, type PlayingNow } from "@/lib/live/lbBrowser";

// Same guard as the profile's NowPlaying: Navidrome briefly reports an album's first track
// when you jump to another one on it, so a change only counts once a second read agrees.
const CONFIRM_MS = 2_000;
const songKey = (artist: string, track: string) => `${artist}|${track}`;

/**
 * Polls ListenBrainz (directly, from the browser) for the showcase user's listens newer
 * than the payload's last one, and for what's playing now: a new song goes on the mountain as
 * soon as it starts, and its scrobble (about halfway in) is then absorbed instead of added
 * twice. A skipped song keeps its point until reload. `quiet` is true only for the first catch-up (the payload can be
 * up to an hour old). Listens missed while the tab was hidden come in loud on return: on macOS
 * a tab counts as hidden whenever its window is covered, e.g. by the music player.
 */
export function useLiveListens(user: string, lastTs: number | null, onListens: (listens: LBListen[], quiet: boolean) => void) {
  const cb = useRef(onListens);
  useEffect(() => { cb.current = onListens; });

  useEffect(() => {
    if (lastTs == null) return;
    let since = lastTs, quiet = true, failures = 0, timer = 0, cancelled = false, ticking = false;
    const seen = new Set<string>();
    // Songs already placed from now-playing, waiting for their scrobble (a count: repeats happen).
    const pending = new Map<string, number>();
    let playingShown = "";

    async function confirmPlaying(p: PlayingNow): Promise<PlayingNow> {
      if (!p || songKey(p.artist_name, p.track_name) === playingShown) return p;
      await new Promise((r) => setTimeout(r, CONFIRM_MS));
      return fetchPlayingNow(user);
    }

    async function tick() {
      if (ticking || document.visibilityState !== "visible") return;
      ticking = true;
      try {
        const [listens, rawPlaying] = await Promise.all([fetchListensSince(user, since), fetchPlayingNow(user)]);
        if (cancelled) return;
        const playing = await confirmPlaying(rawPlaying);
        if (cancelled) return;
        failures = 0;
        let started: LBListen | null = null;
        const pk = playing ? songKey(playing.artist_name, playing.track_name) : "";
        if (playing && pk !== playingShown) {
          pending.set(pk, (pending.get(pk) ?? 0) + 1);
          started = {
            listened_at: Math.floor(Date.now() / 1000),
            track_metadata: { track_name: playing.track_name, artist_name: playing.artist_name, mbid_mapping: { recording_mbid: playing.recording_mbid } },
          };
        }
        playingShown = pk;
        // LB's min_ts is exclusive, but a re-poll can still overlap; oldest first so they fly in order.
        const fresh = listens.filter((l) => {
          const k = `${l.listened_at}|${l.track_metadata.track_name}`;
          if (seen.has(k)) return false;
          seen.add(k);
          const sk = songKey(l.track_metadata.artist_name, l.track_metadata.track_name), c = pending.get(sk) ?? 0;
          if (!c) return true;
          if (c > 1) pending.set(sk, c - 1); else pending.delete(sk);
          return false;
        }).reverse();
        if (started) fresh.push(started);
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
      if (document.visibilityState === "visible") void tick(); else window.clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => { cancelled = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [user, lastTs]);
}
