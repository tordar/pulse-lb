import { sql } from "drizzle-orm";
import { db, schema, execute } from "@/lib/db/client";
import { userCached } from "./cache";
import { withRetry } from "@/lib/db/retry";
import { ensureRecordingLengths } from "@/lib/listenbrainz/metadata";
import { artistClusteredAlbums, artistKeyExpr } from "@/lib/db/aggregates/albumCluster";

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
  recording_mbid: string | null;
  track_name: string;
  release_name: string | null;
  source: string | null;
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

type ArtistIdentity = { artist_name: string; artist_key: string; artist_names: string[] };

async function resolveArtist(
  username: string,
  artistMbid: string,
): Promise<ArtistIdentity | null> {
  // The aggregate holds the artist this mbid identifies. Prefer the row keyed
  // by the mbid itself; name-keyed rows (multi-artist credits) also carry
  // their lead artist's mbid and only stand in when no single-artist row
  // exists.
  const agg = await withRetry(() =>
    execute<ArtistIdentity>(sql`
      SELECT artist_name, artist_key, artist_names
      FROM ${schema.aggArtist}
      WHERE user_name = ${username} AND scope = 0 AND artist_mbid = ${artistMbid}::uuid
      ORDER BY (artist_key = ${artistMbid}) DESC, plays DESC
      LIMIT 1
    `),
  );
  const row = (agg as unknown as Row<ArtistIdentity>).rows[0];
  if (row) return row;

  // Not aggregated yet (fresh sync): fall back to the listens. Containment rather than "= ANY(...)": only @> can use the GIN index on
  // artist_mbids. Same result, but a miss costs one index probe instead of a
  // full scan of the table (see the index in lib/db/schema.ts).
  const res = await withRetry(() =>
    execute<{ artist_name: string | null; artist_names: string[] | null }>(sql`
      SELECT mode() WITHIN GROUP (ORDER BY artist_name) AS artist_name,
             array_agg(DISTINCT artist_name) AS artist_names
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_mbids @> ARRAY[${artistMbid}::uuid]
        AND cardinality(artist_mbids) = 1 AND artist_name IS NOT NULL
    `),
  );
  const fallback = (res as unknown as Row<{ artist_name: string | null; artist_names: string[] | null }>).rows[0];
  if (!fallback?.artist_name || !fallback.artist_names) return null;
  return { artist_name: fallback.artist_name, artist_key: artistMbid, artist_names: fallback.artist_names };
}

async function artistDetailUncached(
  username: string,
  artistMbid: string,
): Promise<ArtistDetail | null> {
  const artist = await resolveArtist(username, artistMbid);
  if (!artist) return null;
  const { artist_name } = artist;
  // Every listen under this artist's key, across all its spellings. The name
  // list lets the (user_name, artist_name) index narrow the scan first.
  const ofArtist = sql`artist_name IN ${artist.artist_names}
    AND ${sql.raw(artistKeyExpr("listens"))} = ${artist.artist_key}`;

  const headerRes = await withRetry(() =>
    execute<ArtistHeader & { plays_with_duration: number; sum_duration_ms: number }>(sql`
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
      WHERE user_name = ${username} AND ${ofArtist}
    `),
  );
  const header = (headerRes as unknown as Row<ArtistHeader & { plays_with_duration: number; sum_duration_ms: number }>).rows[0];
  if (!header || !header.total_plays) return null;

  // Everything below only needs the artist's listens — run in parallel.
  const [yearsRes, songsRes, clustered, recentRes, allRecIdsRes] = await Promise.all([
  withRetry(() =>
    execute<ArtistYear>(sql`
      SELECT
        EXTRACT(YEAR FROM listened_at)::int AS year,
        COUNT(*)::int AS plays,
        ROUND(COALESCE(SUM(duration_ms),0)/1000.0/3600, 2)::float8 AS hours
      FROM ${schema.listens}
      WHERE user_name = ${username} AND ${ofArtist}
      GROUP BY year ORDER BY year
    `),
  ),
  withRetry(() =>
    execute<ArtistSong>(sql`
      SELECT
        mode() WITHIN GROUP (ORDER BY recording_mbid) FILTER (WHERE recording_mbid IS NOT NULL)::text AS recording_mbid,
        (array_agg(track_name ORDER BY listened_at DESC))[1] AS track_name,
        COUNT(*)::int AS plays,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1]::text AS caa_release_mbid
      FROM ${schema.listens}
      WHERE user_name = ${username} AND ${ofArtist}
      GROUP BY COALESCE(recording_mbid::text, '~' || track_name)
      ORDER BY plays DESC, track_name
      LIMIT 20
    `),
  ),
  // Clustered album grouping (case variants / reissues merged) — same
  // definition the albums list uses. Also fixes the header's album count.
  artistClusteredAlbums(username, artist.artist_names, artist.artist_key, 12),
  withRetry(() =>
    execute<ArtistListen>(sql`
      SELECT listened_at, recording_mbid::text AS recording_mbid, track_name, release_name, source
      FROM ${schema.listens}
      WHERE user_name = ${username} AND ${ofArtist}
      ORDER BY listened_at DESC
      LIMIT 20
    `),
  ),
  // Fold canonical recording lengths into the total listening time, since
  // most listens (LB-imported from Spotify) carry no duration_ms.
  withRetry(() =>
    execute<{ recording_mbid: string; plays: number; plays_with_duration: number }>(sql`
      SELECT
        recording_mbid::text AS recording_mbid,
        COUNT(*)::int AS plays,
        COUNT(*) FILTER (WHERE duration_ms IS NOT NULL)::int AS plays_with_duration
      FROM ${schema.listens}
      WHERE user_name = ${username} AND ${ofArtist} AND recording_mbid IS NOT NULL
      GROUP BY recording_mbid
    `),
  ),
  ]);
  header.distinct_albums = clustered.clusterCount;
  const clusteredAlbums = clustered.albums;
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

/** Cached entry point — see ./cache and songDetail for why. */
export function artistDetail(
  username: string,
  artistMbid: string,
): Promise<ArtistDetail | null> {
  return userCached(username, ["artistDetail:v3", username, artistMbid], () =>
    artistDetailUncached(username, artistMbid),
  );
}
