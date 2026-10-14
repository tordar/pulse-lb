import { sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { buildPayload } from "./build";
import { MAX_NAMED_ARTISTS, type LandingPayload } from "./payload";
import { showcaseTz, showcaseUser } from "./showcase";

export type ListenAt = { track: string; artist: string; recordingMbid: string | null; listenedAt: string };

export async function loadShowcasePayload(): Promise<LandingPayload | null> {
  const user = showcaseUser();
  const ranking = await withRetry(() => sqlClient<{ a: string }[]>`
    SELECT coalesce(artist_name, '') AS a FROM listens WHERE user_name = ${user}
    GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT ${MAX_NAMED_ARTISTS}`);
  const rows = await withRetry(() => sqlClient<{ ts: string; a: string }[]>`
    SELECT extract(epoch FROM listened_at)::bigint AS ts, coalesce(artist_name, '') AS a
    FROM listens WHERE user_name = ${user} ORDER BY listened_at`);
  return buildPayload(user, showcaseTz(), rows.map((r) => ({ ts: Number(r.ts), artist: r.a })), ranking.map((r) => r.a));
}

// drizzle's shared client returns timestamps as strings, so derive listenedAt from ts (the match is exact).
export async function loadListenAt(ts: number): Promise<ListenAt | null> {
  const user = showcaseUser();
  const rows = await withRetry(() => sqlClient<{ track_name: string; artist_name: string | null; recording_mbid: string | null }[]>`
    SELECT track_name, artist_name, recording_mbid FROM listens
    WHERE user_name = ${user} AND listened_at = to_timestamp(${ts}) ORDER BY track_name LIMIT 1`);
  const r = rows[0];
  return r ? { track: r.track_name, artist: r.artist_name ?? "", recordingMbid: r.recording_mbid, listenedAt: new Date(ts * 1000).toISOString() } : null;
}
