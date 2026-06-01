import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";

export type ArtistHeader = {
  artist_name: string;
  total_plays: number;
  total_minutes: number;
  distinct_tracks: number;
  distinct_albums: number;
  first_played: string;
  last_played: string;
};

export type ArtistYear = { year: number; plays: number; hours: number };

export type ArtistSong = {
  recording_mbid: string | null;
  track_name: string;
  plays: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
};

export type ArtistAlbum = {
  release_name: string;
  release_mbid: string | null;
  plays: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
};

export type ArtistListen = {
  listened_at: string;
  track_name: string;
  release_name: string | null;
};

export type ArtistDetail = {
  artist_mbid: string;
  artist_name: string;
  header: ArtistHeader;
  years: ArtistYear[];
  topSongs: ArtistSong[];
  topAlbums: ArtistAlbum[];
  recent: ArtistListen[];
};

type Row<T> = { rows: T[] };

async function resolveArtistName(
  username: string,
  artistMbid: string,
): Promise<string | null> {
  const res = await withRetry(() =>
    db.execute<{ artist_name: string }>(sql`
      SELECT artist_name
      FROM ${schema.listens}
      WHERE user_name = ${username} AND ${artistMbid}::uuid = ANY(artist_mbids)
      LIMIT 1
    `),
  );
  return (res as unknown as Row<{ artist_name: string }>).rows[0]?.artist_name ?? null;
}

export async function artistDetail(
  username: string,
  artistMbid: string,
): Promise<ArtistDetail | null> {
  const artist_name = await resolveArtistName(username, artistMbid);
  if (!artist_name) return null;

  const headerRes = await withRetry(() =>
    db.execute<ArtistHeader>(sql`
      SELECT
        ${artist_name}::text AS artist_name,
        COUNT(*)::int AS total_plays,
        ROUND(COALESCE(SUM(duration_ms),0)/1000.0/60, 1)::float8 AS total_minutes,
        COUNT(DISTINCT track_name)::int AS distinct_tracks,
        COUNT(DISTINCT release_name)::int AS distinct_albums,
        MIN(listened_at) AS first_played,
        MAX(listened_at) AS last_played
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name}
    `),
  );
  const header = (headerRes as unknown as Row<ArtistHeader>).rows[0];
  if (!header || !header.total_plays) return null;

  const yearsRes = await withRetry(() =>
    db.execute<ArtistYear>(sql`
      SELECT
        EXTRACT(YEAR FROM listened_at)::int AS year,
        COUNT(*)::int AS plays,
        ROUND(COALESCE(SUM(duration_ms),0)/1000.0/3600, 2)::float8 AS hours
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name}
      GROUP BY year ORDER BY year
    `),
  );

  const songsRes = await withRetry(() =>
    db.execute<ArtistSong>(sql`
      SELECT
        (array_agg(recording_mbid ORDER BY listened_at DESC) FILTER (WHERE recording_mbid IS NOT NULL))[1]::text AS recording_mbid,
        track_name,
        COUNT(*)::int AS plays,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1]::text AS caa_release_mbid
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name}
      GROUP BY track_name
      ORDER BY plays DESC, track_name
      LIMIT 20
    `),
  );

  const albumsRes = await withRetry(() =>
    db.execute<ArtistAlbum>(sql`
      SELECT
        release_name,
        (array_agg(release_mbid ORDER BY listened_at DESC) FILTER (WHERE release_mbid IS NOT NULL))[1]::text AS release_mbid,
        COUNT(*)::int AS plays,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1]::text AS caa_release_mbid
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name} AND release_name IS NOT NULL
      GROUP BY release_name
      ORDER BY plays DESC, release_name
      LIMIT 12
    `),
  );

  const recentRes = await withRetry(() =>
    db.execute<ArtistListen>(sql`
      SELECT listened_at, track_name, release_name
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name}
      ORDER BY listened_at DESC
      LIMIT 20
    `),
  );

  return {
    artist_mbid: artistMbid,
    artist_name,
    header,
    years: (yearsRes as unknown as Row<ArtistYear>).rows,
    topSongs: (songsRes as unknown as Row<ArtistSong>).rows,
    topAlbums: (albumsRes as unknown as Row<ArtistAlbum>).rows,
    recent: (recentRes as unknown as Row<ArtistListen>).rows,
  };
}
