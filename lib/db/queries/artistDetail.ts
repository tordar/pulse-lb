import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { ensureRecordingLengths } from "@/lib/listenbrainz/metadata";
import { artistClusteredAlbums, artistClusterCount } from "@/lib/db/aggregates/albumCluster";

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
    db.execute<ArtistHeader & { plays_with_duration: number; sum_duration_ms: number }>(sql`
      SELECT
        ${artist_name}::text AS artist_name,
        COUNT(*)::int AS total_plays,
        0::float8 AS total_minutes,
        COUNT(DISTINCT COALESCE(recording_mbid::text, track_name))::int AS distinct_tracks,
        COUNT(DISTINCT release_name)::int AS distinct_albums,
        COUNT(*) FILTER (WHERE duration_ms IS NOT NULL)::int AS plays_with_duration,
        COALESCE(SUM(duration_ms), 0)::bigint AS sum_duration_ms,
        MIN(listened_at) AS first_played,
        MAX(listened_at) AS last_played
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name}
    `),
  );
  const header = (headerRes as unknown as Row<ArtistHeader & { plays_with_duration: number; sum_duration_ms: number }>).rows[0];
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
        mode() WITHIN GROUP (ORDER BY recording_mbid) FILTER (WHERE recording_mbid IS NOT NULL)::text AS recording_mbid,
        (array_agg(track_name ORDER BY listened_at DESC))[1] AS track_name,
        COUNT(*)::int AS plays,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1]::text AS caa_release_mbid
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name}
      GROUP BY COALESCE(recording_mbid::text, '~' || track_name)
      ORDER BY plays DESC, track_name
      LIMIT 20
    `),
  );

  // Clustered album grouping (case variants / reissues merged) — same
  // definition the albums list uses. Also fixes the header's album count.
  const [clusteredAlbums, clusterCount] = await Promise.all([
    artistClusteredAlbums(username, artist_name, 12),
    artistClusterCount(username, artist_name),
  ]);
  header.distinct_albums = clusterCount;

  const recentRes = await withRetry(() =>
    db.execute<ArtistListen>(sql`
      SELECT listened_at, track_name, release_name
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name}
      ORDER BY listened_at DESC
      LIMIT 20
    `),
  );

  // Fold canonical recording lengths into the total listening time, since
  // most listens (LB-imported from Spotify) carry no duration_ms.
  const allRecIdsRes = await withRetry(() =>
    db.execute<{ recording_mbid: string; plays: number; plays_with_duration: number }>(sql`
      SELECT
        recording_mbid::text AS recording_mbid,
        COUNT(*)::int AS plays,
        COUNT(*) FILTER (WHERE duration_ms IS NOT NULL)::int AS plays_with_duration
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name = ${artist_name} AND recording_mbid IS NOT NULL
      GROUP BY recording_mbid
    `),
  );
  const allRecs = (allRecIdsRes as unknown as Row<{ recording_mbid: string; plays: number; plays_with_duration: number }>).rows;
  const lengths = await ensureRecordingLengths(allRecs.map((r) => r.recording_mbid));
  let extraMs = 0;
  for (const r of allRecs) {
    const len = lengths.get(r.recording_mbid) ?? 0;
    extraMs += len * (r.plays - r.plays_with_duration);
  }
  header.total_minutes = (Number(header.sum_duration_ms) + extraMs) / 1000 / 60;

  return {
    artist_mbid: artistMbid,
    artist_name,
    header,
    years: (yearsRes as unknown as Row<ArtistYear>).rows,
    topSongs: (songsRes as unknown as Row<ArtistSong>).rows,
    topAlbums: clusteredAlbums,
    recent: (recentRes as unknown as Row<ArtistListen>).rows,
  };
}
