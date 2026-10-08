import type { LiveListen } from "@/lib/sync/liveDelta";

// The browser talks to ListenBrainz directly: its API sends
// access-control-allow-origin: * and rate-limits per caller IP, so polling
// costs us no function invocations and no database time.
const LB = "https://api.listenbrainz.org";

export type LBListen = {
  listened_at: number;
  track_metadata: {
    track_name: string;
    artist_name: string;
    release_name?: string | null;
    additional_info?: { duration_ms?: number | null; recording_mbid?: string | null } | null;
    mbid_mapping?: { recording_mbid?: string | null; caa_id?: number | null; caa_release_mbid?: string | null } | null;
  };
};

export type PlayingNow = {
  track_name: string; artist_name: string; release_name?: string | null;
  caa_id?: number | null; caa_release_mbid?: string | null;
} | null;

export function toLiveListen(l: LBListen): LiveListen {
  const m = l.track_metadata;
  return {
    listened_at: new Date(l.listened_at * 1000).toISOString(),
    track_name: m.track_name,
    artist_name: m.artist_name,
    release_name: m.release_name ?? null,
    recording_mbid: m.mbid_mapping?.recording_mbid ?? m.additional_info?.recording_mbid ?? null,
    duration_ms: m.additional_info?.duration_ms ?? null,
  };
}

export function nextDelay(failures: number): number {
  return failures <= 0 ? 15_000 : failures === 1 ? 60_000 : 300_000;
}

export function mergeNew(seen: Set<string>, incoming: LiveListen[]): LiveListen[] {
  const fresh: LiveListen[] = [];
  for (const l of incoming) {
    const k = `${l.listened_at}|${l.track_name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(l);
  }
  return fresh;
}

export async function fetchListensSince(
  username: string,
  minTs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<LBListen[]> {
  const all: LBListen[] = [];
  let cursor = minTs;
  while (true) {
    const r = await fetchImpl(`${LB}/1/user/${encodeURIComponent(username)}/listens?min_ts=${cursor}&count=1000`);
    if (!r.ok) throw new Error(`LB ${r.status}`);
    const page = ((await r.json()) as { payload: { listens: LBListen[] } }).payload.listens;
    all.unshift(...page);
    if (page.length < 1000) return all;
    cursor = page[0].listened_at;
  }
}

export async function fetchPlayingNow(username: string, fetchImpl: typeof fetch = fetch): Promise<PlayingNow> {
  const r = await fetchImpl(`${LB}/1/user/${encodeURIComponent(username)}/playing-now`);
  if (!r.ok) throw new Error(`LB ${r.status}`);
  const l = ((await r.json()) as { payload: { listens: LBListen[] } }).payload.listens[0];
  if (!l) return null;
  const m = l.track_metadata;
  return {
    track_name: m.track_name, artist_name: m.artist_name, release_name: m.release_name ?? null,
    caa_id: m.mbid_mapping?.caa_id ?? null, caa_release_mbid: m.mbid_mapping?.caa_release_mbid ?? null,
  };
}

/** Identity of a now-playing reading, for telling a real change from a repeat. */
export function playingKey(p: PlayingNow): string {
  return p ? `${p.track_name}|${p.artist_name}|${p.release_name ?? ""}` : "";
}
