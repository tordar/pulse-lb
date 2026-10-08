import type { TransactionSql } from "postgres";
import { buildAlbum, buildArtist, buildSong } from "./rebuild";
import { withArtistSetAlbumClusters } from "./albumCluster";

// Live ingest's replacement for rebuildAll(): recompute only the agg_* rows a
// batch of new listens can change. Exact, not an estimate: scripts/
// check-incremental.ts asserts every table matches a full rebuild.
//
// What each table depends on, and so what has to be re-read:
//  - agg_hour: plain counts, so add to them.
//  - agg_day: the days the new listens fall on.
//  - agg_year: derived from agg_day (same sums, same rounding as the rebuild).
//  - agg_song: grouped by verbatim artist_name, so that artist's songs.
//  - agg_artist: distinct_albums counts album clusters, and cluster name keys
//    are lower-cased, so every spelling of the artist.
//  - agg_album: a cluster can span artists through a shared release group
//    (112 do in production). Re-read every artist that shares a cluster with
//    the new listens' artists (agg_album.member_artists), and rebuild exactly
//    the clusters those listens were in before or are in after.
//  - agg_alltime: derived from the other tables plus covered_plays.

export type NewListenKey = {
  // sqlClient hands timestamps back as strings (drizzle installs pass-through
  // date serializers on it), so accept either. Strings keep microseconds.
  listenedAt: Date | string;
  trackName: string;
  artistName: string | null;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
};

export type IncrementalPlan = {
  songArtists: string[];
  artistVariants: string[];
  loweredArtists: string[];
  expandedArtists: string[];
  beforeClusterKeys: string[];
};

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

async function spellings(tx: TransactionSql, username: string, lowered: string[], extra: string[]) {
  const rows = await tx<{ artist_name: string }[]>`
    SELECT artist_name FROM agg_artist
    WHERE user_name = ${username} AND scope = 0 AND lower(artist_name) = ANY(${lowered}::text[])`;
  return uniq([...extra, ...rows.map((r) => r.artist_name)]);
}

async function clusterKeysOf(tx: TransactionSql, username: string, expanded: string[], lowered: string[]) {
  const rows = (await tx.unsafe(
    withArtistSetAlbumClusters(
      `SELECT DISTINCT cluster_key FROM clustered WHERE lower(artist_name) = ANY($3::text[])`,
    ),
    [username, expanded, lowered],
  )) as unknown as { cluster_key: string }[];
  return rows.map((r) => r.cluster_key);
}

export async function planIncremental(
  tx: TransactionSql,
  username: string,
  rows: NewListenKey[],
): Promise<IncrementalPlan> {
  const songArtists = uniq(rows.map((r) => r.artistName).filter((a): a is string => a != null));
  const loweredArtists = uniq(songArtists.map((a) => a.toLowerCase()));
  const artistVariants = await spellings(tx, username, loweredArtists, songArtists);

  // Release groups any of these artists' listens (stored or incoming) vote for.
  // A cluster can only be shared through one of them.
  const rgRows = await tx<{ rg: string }[]>`
    SELECT DISTINCT COALESCE(l.release_group_mbid, rel.release_group_mbid)::text AS rg
    FROM listens l LEFT JOIN releases rel ON rel.mbid = l.release_mbid
    WHERE l.user_name = ${username} AND l.artist_name = ANY(${artistVariants}::text[])
      AND l.release_name IS NOT NULL
      AND COALESCE(l.release_group_mbid, rel.release_group_mbid) IS NOT NULL
    UNION
    SELECT DISTINCT COALESCE(x.rg, rel.release_group_mbid)::text
    FROM unnest(${rows.map((r) => r.releaseGroupMbid)}::uuid[], ${rows.map((r) => r.releaseMbid)}::uuid[]) AS x(rg, rel_mbid)
    LEFT JOIN releases rel ON rel.mbid = x.rel_mbid
    WHERE COALESCE(x.rg, rel.release_group_mbid) IS NOT NULL`;
  const partners = await tx<{ a: string }[]>`
    SELECT DISTINCT unnest(member_artists) AS a FROM agg_album
    WHERE user_name = ${username} AND scope = 0
      AND group_key = ANY(${rgRows.map((r) => r.rg)}::text[])`;
  const expandedLowered = uniq([...loweredArtists, ...partners.map((p) => p.a)]);
  const expandedArtists = await spellings(tx, username, expandedLowered, artistVariants);

  const beforeClusterKeys = await clusterKeysOf(tx, username, expandedArtists, loweredArtists);
  return { songArtists, artistVariants, loweredArtists, expandedArtists, beforeClusterKeys };
}

export async function applyIncremental(
  tx: TransactionSql,
  username: string,
  plan: IncrementalPlan,
  inserted: NewListenKey[],
): Promise<void> {
  if (inserted.length === 0) return;
  // Sent as text: the shared client cannot serialize Date parameters.
  const ts = inserted.map((r) => (typeof r.listenedAt === "string" ? r.listenedAt : r.listenedAt.toISOString()));
  const tracks = inserted.map((r) => r.trackName);

  // agg_hour: additive.
  await tx`
    UPDATE agg_hour h SET plays = h.plays + n.c
    FROM (SELECT EXTRACT(HOUR FROM t)::int AS hour, COUNT(*)::int AS c
          FROM unnest(${ts}::text[]::timestamptz[]) AS t GROUP BY 1) n
    WHERE h.user_name = ${username} AND h.hour = n.hour`;

  // agg_day: recompute the touched days. Range first so the PK index is used.
  await tx`
    WITH d AS (SELECT DISTINCT t::date AS day FROM unnest(${ts}::text[]::timestamptz[]) AS t)
    DELETE FROM agg_day WHERE user_name = ${username} AND date IN (SELECT day FROM d)`;
  await tx`
    WITH d AS (SELECT DISTINCT t::date AS day FROM unnest(${ts}::text[]::timestamptz[]) AS t)
    INSERT INTO agg_day (user_name, date, plays, effective_ms)
    SELECT ${username}::text, l.listened_at::date, COUNT(*)::int,
           COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint
    FROM listens l LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username}
      AND l.listened_at >= (SELECT MIN(day) FROM d)
      AND l.listened_at < (SELECT MAX(day) FROM d) + 1
      AND l.listened_at::date IN (SELECT day FROM d)
    GROUP BY l.listened_at::date`;

  // agg_year: from agg_day — same per-listen sums, same rounding as buildYear.
  await tx`
    WITH y AS (SELECT DISTINCT EXTRACT(YEAR FROM t)::int AS year FROM unnest(${ts}::text[]::timestamptz[]) AS t)
    DELETE FROM agg_year WHERE user_name = ${username} AND year IN (SELECT year FROM y)`;
  await tx`
    WITH y AS (SELECT DISTINCT EXTRACT(YEAR FROM t)::int AS year FROM unnest(${ts}::text[]::timestamptz[]) AS t)
    INSERT INTO agg_year (user_name, year, plays, hours)
    SELECT ${username}::text, EXTRACT(YEAR FROM date)::int, SUM(plays)::int,
           ROUND(COALESCE(SUM(effective_ms), 0) / 1000.0 / 3600, 2)::float8
    FROM agg_day
    WHERE user_name = ${username} AND EXTRACT(YEAR FROM date)::int IN (SELECT year FROM y)
    GROUP BY EXTRACT(YEAR FROM date)::int`;

  // agg_song: grouped by verbatim artist name.
  await tx`DELETE FROM agg_song WHERE user_name = ${username} AND artist_name = ANY(${plan.songArtists}::text[])`;
  await buildSong(tx, username, plan.songArtists);

  // agg_artist: every spelling (shared lower-cased name keys).
  await tx`DELETE FROM agg_artist WHERE user_name = ${username} AND artist_name = ANY(${plan.artistVariants}::text[])`;
  await buildArtist(tx, username, plan.artistVariants);

  // agg_album: clusters the new listens' artists were in before or are in now.
  const after = await clusterKeysOf(tx, username, plan.expandedArtists, plan.loweredArtists);
  const keys = uniq([...plan.beforeClusterKeys, ...after]);
  await tx`DELETE FROM agg_album WHERE user_name = ${username} AND group_key = ANY(${keys}::text[])`;
  await buildAlbum(tx, username, { artists: plan.expandedArtists, clusterKeys: keys });

  // agg_alltime: derived. distinct_songs identity mirrors buildAlltime's
  // COALESCE(recording_mbid::text, track_name): '~' groups are mbid-less.
  await tx`
    UPDATE agg_alltime a SET
      total_plays      = d.plays,
      effective_ms     = d.ms,
      distinct_artists = (SELECT COUNT(*)::int FROM agg_artist WHERE user_name = ${username} AND scope = 0),
      distinct_albums  = (SELECT COUNT(*)::int FROM agg_album  WHERE user_name = ${username} AND scope = 0),
      distinct_songs   = (SELECT COUNT(DISTINCT CASE WHEN group_key LIKE '~%' THEN track_name ELSE recording_mbid::text END)::int
                          FROM agg_song WHERE user_name = ${username} AND scope = 0),
      first_played     = b.first_played,
      last_played      = b.last_played,
      covered_plays    = a.covered_plays + c.covered,
      duration_coverage_pct = ROUND(100.0 * (a.covered_plays + c.covered) / NULLIF(d.plays, 0), 1)::float8,
      computed_at      = now()
    FROM
      (SELECT COALESCE(SUM(plays), 0)::int AS plays, COALESCE(SUM(effective_ms), 0)::bigint AS ms
         FROM agg_day WHERE user_name = ${username}) d,
      (SELECT MIN(listened_at) AS first_played, MAX(listened_at) AS last_played
         FROM listens WHERE user_name = ${username}) b,
      (SELECT COUNT(*)::int AS covered
         FROM unnest(${ts}::text[]::timestamptz[], ${tracks}::text[]) AS n(ts, track)
         JOIN listens l ON l.user_name = ${username} AND l.listened_at = n.ts AND l.track_name = n.track
         LEFT JOIN recordings r ON r.mbid = l.recording_mbid
         WHERE l.duration_ms IS NOT NULL OR r.length_ms IS NOT NULL) c
    WHERE a.user_name = ${username}`;
}
