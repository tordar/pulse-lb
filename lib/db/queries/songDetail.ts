import { eq, sql } from "drizzle-orm";
import { db, schema, execute } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { ensureRecordingLengths } from "@/lib/listenbrainz/metadata";

export type SongHeader = {
  track_name: string;
  artist_name: string;
  caa_id: number | null;
  caa_release_mbid: string | null;
  total_plays: number;
  total_minutes: number;
  first_played: string;
  last_played: string;
};

export type SongYear = { year: number; plays: number; hours: number };

export type SongAlbum = {
  release_name: string;
  release_mbid: string | null;
  plays: number;
};

export type SongListen = {
  listened_at: string;
  release_name: string | null;
  source: string | null;
};

export type SongDetail = {
  recording_mbid: string;
  track_name: string;
  artist_name: string;
  header: SongHeader;
  years: SongYear[];
  albums: SongAlbum[];
  recent: SongListen[];
};

type Row<T> = { rows: T[] };

async function resolveSongKey(
  username: string,
  recordingMbid: string,
): Promise<{ track_name: string; artist_name: string } | null> {
  const res = await withRetry(() =>
    execute<{ track_name: string; artist_name: string }>(sql`
      SELECT track_name, artist_name
      FROM ${schema.listens}
      WHERE user_name = ${username} AND recording_mbid = ${recordingMbid}::uuid
      LIMIT 1
    `),
  );
  return (res as unknown as Row<{ track_name: string; artist_name: string }>).rows[0] ?? null;
}

export async function songDetail(
  username: string,
  recordingMbid: string,
  hints: { trackName?: string; artistName?: string } = {},
): Promise<SongDetail | null> {
  let track_name: string | undefined = hints.trackName;
  let artist_name: string | undefined = hints.artistName;
  if (!track_name || !artist_name) {
    const key = await resolveSongKey(username, recordingMbid);
    if (!key) return null;
    track_name = key.track_name;
    artist_name = key.artist_name;
  }

  // The song's identity is the recording MBID — different players spell the
  // same track differently ("Self Control" vs "Self Control Feat. Yung
  // Lean"), so name equality alone splits plays. Match every listen mapped
  // to this recording, plus name-matched listens that have no mapping.
  const songFilter = sql`(
    recording_mbid = ${recordingMbid}::uuid
    OR (recording_mbid IS NULL AND track_name = ${track_name} AND artist_name = ${artist_name})
  )`;

  // Prefer the canonical MB title (cached in recordings) over whichever
  // spelling happened to be in the clicked URL.
  const canonical = await withRetry(() =>
    db.query.recordings.findFirst({ where: eq(schema.recordings.mbid, recordingMbid) }),
  ).catch(() => null);
  if (canonical?.name) track_name = canonical.name;

  const headerRes = await withRetry(() =>
    execute<SongHeader & { plays_with_duration: number; sum_duration_ms: number }>(sql`
      SELECT
        ${track_name}::text AS track_name,
        ${artist_name}::text AS artist_name,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1] AS caa_release_mbid,
        COUNT(*)::int AS total_plays,
        0::float8 AS total_minutes,
        COUNT(*) FILTER (WHERE duration_ms IS NOT NULL)::int AS plays_with_duration,
        COALESCE(SUM(duration_ms), 0)::bigint AS sum_duration_ms,
        MIN(listened_at) AS first_played,
        MAX(listened_at) AS last_played
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND ${songFilter}
    `),
  );
  const header = (headerRes as unknown as Row<SongHeader & { plays_with_duration: number; sum_duration_ms: number }>).rows[0];
  if (!header || !header.total_plays) return null;

  const lengths = await ensureRecordingLengths([recordingMbid]);
  const canonicalMs = lengths.get(recordingMbid) ?? 0;
  const playsMissing = header.total_plays - header.plays_with_duration;
  header.total_minutes = (Number(header.sum_duration_ms) + canonicalMs * playsMissing) / 1000 / 60;

  const yearsRes = await withRetry(() =>
    execute<SongYear>(sql`
      SELECT
        EXTRACT(YEAR FROM listened_at)::int AS year,
        COUNT(*)::int AS plays,
        ROUND(COALESCE(SUM(duration_ms),0)/1000.0/3600, 2)::float8 AS hours
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND ${songFilter}
      GROUP BY year ORDER BY year
    `),
  );

  const albumsRes = await withRetry(() =>
    execute<SongAlbum>(sql`
      SELECT
        release_name,
        mode() WITHIN GROUP (ORDER BY release_mbid) FILTER (WHERE release_mbid IS NOT NULL)::text AS release_mbid,
        COUNT(*)::int AS plays
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND ${songFilter}
        AND release_name IS NOT NULL
      GROUP BY release_name
      ORDER BY plays DESC
    `),
  );

  const recentRes = await withRetry(() =>
    execute<SongListen>(sql`
      SELECT listened_at, release_name, source
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND ${songFilter}
      ORDER BY listened_at DESC
      LIMIT 20
    `),
  );

  return {
    recording_mbid: recordingMbid,
    track_name,
    artist_name,
    header,
    years: (yearsRes as unknown as Row<SongYear>).rows,
    albums: (albumsRes as unknown as Row<SongAlbum>).rows,
    recent: (recentRes as unknown as Row<SongListen>).rows,
  };
}
