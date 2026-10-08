"use client";

import { useState, useSyncExternalStore } from "react";
import { albumKey, artistKey, songKey } from "@/lib/sync/keys";

/**
 * A client-side projection of listens the server has not aggregated yet.
 *
 * Every figure on the stats page is read from the `agg_*` tables, and those are
 * written after listens land. So between a listen happening and the server
 * folding it in, the server has nothing new to tell us however often we ask.
 *
 * Rather than refresh aggregates on a timer, the live poller in
 * `NowPlaying.tsx` reports the listens it just fetched from ListenBrainz and
 * we add them up here. Tiles and top lists
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
  listened_at: string;
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
// The rows themselves, newest first, for the "Recent listens" list. Capped:
// only the top few are ever shown, and a tab can stay open for days.
let recent: LiveListen[] = [];
const RECENT_MAX = 50;
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
  recent = [...rows].sort((a, b) => b.listened_at.localeCompare(a.listened_at)).concat(recent).slice(0, RECENT_MAX);
  emit();
}

/** Drop the projection — called when a sync starts and once it has settled. */
export function resetLive() {
  counters = empty();
  recent = [];
  generation++;
  emit();
}

export function useLiveRecent(): LiveListen[] {
  return useSyncExternalStore(subscribe, () => recent, () => EMPTY);
}
const EMPTY: LiveListen[] = [];

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
export function useProjected(rawBase: number, read: (c: Counters) => number): number {
  // Coerced because bigint columns (effective_ms) arrive from postgres-js as
  // STRINGS. `"40328388000" + 0` concatenates rather than adds, which silently
  // multiplied listening time by ten.
  const base = Number(rawBase);
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
