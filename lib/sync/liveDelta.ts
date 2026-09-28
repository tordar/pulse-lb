"use client";

import { useState, useSyncExternalStore } from "react";

/**
 * A client-side projection of a sync that is still running.
 *
 * Every figure on the stats page is read from the `agg_*` tables, and those are
 * only written by `rebuildAll()` at the very end of a sync chain. So between
 * clicking Sync and the chain terminating, the server has nothing new to tell
 * us however often we ask — the rows are in `listens`, but no aggregate reflects
 * them yet.
 *
 * Rather than rebuild aggregates on a timer (a full DELETE + re-INSERT of the
 * user's whole history, the most expensive thing in the app), the sync poller
 * reports the rows it just saw land and we add them up here. Tiles and top lists
 * read the running total and show it on top of their server value, so the page
 * moves as the listens arrive. The authoritative refresh then overwrites it.
 *
 * This is a display estimate, deliberately. What it cannot know:
 *  - whether a new listen's artist/album/song is one the user already had, so
 *    the distinct_* tiles are left alone entirely;
 *  - anything about an entry outside the rendered top 5, so a song climbing in
 *    from #9 only appears on the next real refresh;
 *  - `recordings.length_ms`, the server's fallback when a listen has no
 *    duration of its own, so projected listening time runs slightly short.
 */

type Tally = { plays: number; ms: number };

export type Counters = {
  total: Tally;
  song: Map<string, Tally>;
  artist: Map<string, Tally>;
  album: Map<string, Tally>;
};

export type LiveListen = {
  track_name: string;
  artist_name: string;
  release_name: string | null;
  recording_mbid: string | null;
  duration_ms: number | null;
};

function empty(): Counters {
  return {
    total: { plays: 0, ms: 0 },
    song: new Map(),
    artist: new Map(),
    album: new Map(),
  };
}

let counters: Counters = empty();
// Bumped on every change: the counters object is mutated in place, so identity
// alone can't tell subscribers anything.
let version = 0;
// Bumped only by resetLive(). Consumers hold a zero point for what the server
// already counted; when the projection is thrown away that zero point is stale
// too, and without this they'd silently swallow the next sync's first plays.
let generation = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  for (const fn of listeners) fn();
}

function bump(map: Map<string, Tally>, key: string, ms: number) {
  const cur = map.get(key);
  if (cur) {
    cur.plays += 1;
    cur.ms += ms;
  } else {
    map.set(key, { plays: 1, ms });
  }
}

// Mirrors agg_song.group_key in lib/db/aggregates/rebuild.ts, so a projected
// row lands on the same bucket the server will eventually report.
export function songKey(
  recordingMbid: string | null,
  trackName: string,
  artistName: string,
): string {
  return `${recordingMbid ?? `~${trackName}`}|${artistName ?? ""}`;
}

// agg_artist groups on artist_name verbatim.
export function artistKey(artistName: string): string {
  return artistName ?? "";
}

// Approximate: agg_album groups on album CLUSTERS (reissues and case variants
// merged — see albumCluster.ts), which can't be reproduced client-side. Casefold
// is the cheap half of it and covers the common variant.
export function albumKey(releaseName: string | null, artistName: string): string {
  return `${(releaseName ?? "").toLowerCase()}|${(artistName ?? "").toLowerCase()}`;
}

/** Fold freshly-inserted listens into the running projection. */
export function recordListens(rows: LiveListen[]) {
  if (rows.length === 0) return;
  for (const r of rows) {
    const ms = r.duration_ms ?? 0;
    counters.total.plays += 1;
    counters.total.ms += ms;
    bump(counters.song, songKey(r.recording_mbid, r.track_name, r.artist_name), ms);
    bump(counters.artist, artistKey(r.artist_name), ms);
    if (r.release_name) bump(counters.album, albumKey(r.release_name, r.artist_name), ms);
  }
  emit();
}

/** Drop the projection — called when a sync starts and once it has settled. */
export function resetLive() {
  counters = empty();
  generation++;
  emit();
}

export function getGeneration(): number {
  return generation;
}

export function getCounters(): Counters {
  return counters;
}

/**
 * Re-renders the caller whenever the projection changes. For a component
 * projecting many values at once — a whole top list — this beats a hook per
 * value, which the rules of hooks wouldn't allow inside a map anyway.
 */
export function useLiveVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Adds the projection to a server-rendered figure.
 *
 * `base` is the authoritative value. Each time it changes — i.e. a real refresh
 * landed — we re-zero against the projection as it stands at that moment, so
 * whatever the server has already counted is never added a second time, and the
 * number never dips backwards between a refresh firing and its data arriving.
 */
export function useProjected(base: number, read: (c: Counters) => number): number {
  const delta = useSyncExternalStore(
    subscribe,
    () => read(counters),
    () => 0,
  );
  // React's documented way to adjust state when a prop changes: compare against
  // the previous value during render and re-set immediately, no effect involved.
  const mark = `${base}|${getGeneration()}`;
  const [prevMark, setPrevMark] = useState(mark);
  const [zero, setZero] = useState(delta);
  if (mark !== prevMark) {
    setPrevMark(mark);
    setZero(delta);
  }
  // Clamped because resetLive() drops the projection below an old zero point.
  return base + Math.max(0, delta - zero);
}

export const readTotalPlays = (c: Counters) => c.total.plays;
export const readTotalMs = (c: Counters) => c.total.ms;

export function readTally(
  kind: "song" | "artist" | "album",
  key: string,
  field: "plays" | "ms",
): (c: Counters) => number {
  return (c) => c[kind].get(key)?.[field] ?? 0;
}
