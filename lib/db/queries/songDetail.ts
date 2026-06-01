import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";

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
    db.execute<{ track_name: string; artist_name: string }>(sql`
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
): Promise<SongDetail | null> {
  const key = await resolveSongKey(username, recordingMbid);
  if (!key) return null;
  const { track_name, artist_name } = key;

  const headerRes = await withRetry(() =>
    db.execute<SongHeader>(sql`
      SELECT
        ${track_name}::text AS track_name,
        ${artist_name}::text AS artist_name,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1] AS caa_release_mbid,
        COUNT(*)::int AS total_plays,
        ROUND(COALESCE(SUM(duration_ms),0)/1000.0/60, 1)::float8 AS total_minutes,
        MIN(listened_at) AS first_played,
        MAX(listened_at) AS last_played
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND track_name = ${track_name}
        AND artist_name = ${artist_name}
    `),
  );
  const header = (headerRes as unknown as Row<SongHeader>).rows[0];
  if (!header || !header.total_plays) return null;

  const yearsRes = await withRetry(() =>
    db.execute<SongYear>(sql`
      SELECT
        EXTRACT(YEAR FROM listened_at)::int AS year,
        COUNT(*)::int AS plays,
        ROUND(COALESCE(SUM(duration_ms),0)/1000.0/3600, 2)::float8 AS hours
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND track_name = ${track_name}
        AND artist_name = ${artist_name}
      GROUP BY year ORDER BY year
    `),
  );

  const albumsRes = await withRetry(() =>
    db.execute<SongAlbum>(sql`
      SELECT
        release_name,
        (array_agg(release_mbid ORDER BY listened_at DESC) FILTER (WHERE release_mbid IS NOT NULL))[1]::text AS release_mbid,
        COUNT(*)::int AS plays
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND track_name = ${track_name}
        AND artist_name = ${artist_name}
        AND release_name IS NOT NULL
      GROUP BY release_name
      ORDER BY plays DESC
    `),
  );

  const recentRes = await withRetry(() =>
    db.execute<SongListen>(sql`
      SELECT listened_at, release_name
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND track_name = ${track_name}
        AND artist_name = ${artist_name}
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
