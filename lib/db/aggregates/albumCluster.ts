// Single source of truth for album clustering.
//
// Problem: the same album appears under several keys — case variants
// ("In The Aeroplane…" / "In the Aeroplane…"), reissue suffixes ("On Avery
// Island (2011)"), and LB's MBID mapper sometimes attaches the wrong edition
// entirely (studio scrobbles matched to live bootleg releases).
//
// Rule: each listen gets a normalized name key (lower-cased release + artist).
// A name key adopts a release group as its cluster ONLY when that RG wins a
// real majority of the name's plays (≥50%, ≥2 plays). Name keys sharing a
// winning RG merge into one cluster; everything else stays on its own name
// key. Majority voting means minority mis-mappings can neither split an album
// nor pull a small album into a big one. This is a pure coarsening of the old
// exact-name grouping — it can merge groups but never split one.
//
// The CTE text below is shared by the aggregate rebuild, runtime queries and
// the analysis script; keep it in one place so list totals, artist pages and
// detail pages can never disagree about what "an album" is.
//
// $1 = username.
// Normalisation used when comparing a scrobbled name with an RG's canonical
// title: lower-case, unify curly apostrophes, collapse whitespace.
const NORM = (col: string) =>
  `regexp_replace(replace(replace(lower(btrim(${col})), '’', ''''), '‘', ''''), '\\s+', ' ', 'g')`;

// A scrobbled name "matches" the RG title when equal after normalisation, or
// when one extends the other by an edition-style suffix: "(2011)", "(Deluxe
// Remastered Edition)", ": Life House", "- 30th Anniversary". A bare word
// suffix ("…Demos") does NOT match — that's a different album, not an
// edition. Slash and comma extensions of the scrobbled name ("London Calling
// / Combat Rock", "The Sickness, Believe, …") are 2-for-1 / box-set names
// and deliberately stay separate; comma is allowed only in the other
// direction, where the RG title extends the name ("Bon Iver, Bon Iver").
const NAME_EXTENDS_RG_SUFFIX = `'^\\s*[(\\[:–—-]'`;
const RG_EXTENDS_NAME_SUFFIX = `'^\\s*[,(\\[:–—-]'`;
const NAME_MATCHES_RG = `(
    v.name_norm = rgm.name_norm
    OR (left(v.name_norm, char_length(rgm.name_norm)) = rgm.name_norm
        AND substring(v.name_norm FROM char_length(rgm.name_norm) + 1) ~ ${NAME_EXTENDS_RG_SUFFIX})
    OR (left(rgm.name_norm, char_length(v.name_norm)) = v.name_norm
        AND substring(rgm.name_norm FROM char_length(v.name_norm) + 1) ~ ${RG_EXTENDS_NAME_SUFFIX})
  )`;

/** Per-listen normalized name key — must stay in sync with nameKey() below. */
export const nameKeyExpr = (alias: string) =>
  `lower(btrim(${alias}.release_name)) || '|' || lower(COALESCE(${alias}.artist_name, ''))`;

/** TS mirror of nameKeyExpr for resolving a clicked album into its cluster. */
export function nameKey(releaseName: string, artistName: string): string {
  return `${releaseName.trim().toLowerCase()}|${artistName.toLowerCase()}`;
}

export const ALBUM_CLUSTER_CTE = `
  base AS (
    SELECT l.listened_at, l.track_name, l.release_name, l.artist_name, l.caa_id, l.caa_release_mbid,
           l.release_mbid, l.recording_mbid, l.duration_ms,
           COALESCE(l.release_group_mbid, rel.release_group_mbid) AS rg,
           ${nameKeyExpr("l")} AS name_key,
           ${NORM("l.release_name")} AS name_norm
    FROM listens l
    LEFT JOIN releases rel ON rel.mbid = l.release_mbid
    WHERE l.user_name = $1 AND l.release_name IS NOT NULL
  ),
  votes AS (
    SELECT name_key, MIN(name_norm) AS name_norm, rg, COUNT(*)::int AS c
    FROM base
    WHERE rg IS NOT NULL
    GROUP BY name_key, rg
  ),
  totals AS (
    SELECT name_key, COUNT(*)::int AS total FROM base GROUP BY name_key
  ),
  canon AS (
    -- A name key adopts an RG only when (a) that RG wins a real majority of
    -- the name's plays AND (b) the RG's canonical title resembles the
    -- scrobbled name. (a) stops minority mis-mappings (bootlegs); (b) stops
    -- LB's album-canonicalisation from folding singles/EPs/live albums into
    -- the studio album they share recordings with.
    SELECT DISTINCT ON (v.name_key) v.name_key, v.rg AS canon_rg
    FROM votes v
    JOIN totals t USING (name_key)
    JOIN (SELECT mbid, ${NORM("name")} AS name_norm FROM release_groups WHERE name IS NOT NULL) rgm
      ON rgm.mbid = v.rg
    WHERE v.c * 2 >= t.total
      AND ${NAME_MATCHES_RG}
    ORDER BY v.name_key, v.c DESC, v.rg
  ),
  clustered AS (
    SELECT b.*, c.canon_rg, COALESCE(c.canon_rg::text, b.name_key) AS cluster_key
    FROM base b
    LEFT JOIN canon c USING (name_key)
  )
`;

/** Wrap a query tail in the cluster CTE. Tail references `clustered`. */
export function withAlbumClusters(tail: string): string {
  return `WITH ${ALBUM_CLUSTER_CTE} ${tail}`;
}

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { withRetry } from "@/lib/db/retry";

// Shared raw client for cluster queries (drizzle's neon-http wrapper can't
// run the $1-parameterised CTE text directly).
export const csql = neon(process.env.DATABASE_URL!) as NeonQueryFunction<false, false>;

export type AlbumCluster = {
  cluster_key: string;
  members: { release_name: string; artist_name: string }[];
  rg_name: string | null;
  first_release_date: string | null;
};

/**
 * Resolve a clicked album (by release_mbid, with a name-key fallback) to its
 * full cluster: every (release_name, artist_name) variant that belongs to it,
 * plus the release group's canonical title and date when adopted.
 */
export async function resolveAlbumCluster(
  username: string,
  releaseMbid: string | null,
  fallbackNameKey: string | null,
): Promise<AlbumCluster | null> {
  const keyRows = (await withRetry(() =>
    csql.query(
      withAlbumClusters(`
        SELECT cluster_key, COUNT(*)::int AS c
        FROM clustered
        WHERE ($2::uuid IS NOT NULL AND release_mbid = $2::uuid)
           OR ($2::uuid IS NULL AND name_key = $3)
        GROUP BY cluster_key
        ORDER BY c DESC
        LIMIT 1
      `),
      [username, releaseMbid, fallbackNameKey],
    ),
  )) as { cluster_key: string }[];
  const cluster_key = keyRows[0]?.cluster_key ?? null;
  if (!cluster_key) return null;

  const rows = (await withRetry(() =>
    csql.query(
      withAlbumClusters(`
        SELECT DISTINCT cl.release_name, cl.artist_name, rgm.name AS rg_name, rgm.first_release_date
        FROM clustered cl
        LEFT JOIN release_groups rgm ON rgm.mbid = cl.canon_rg
        WHERE cl.cluster_key = $2
      `),
      [username, cluster_key],
    ),
  )) as { release_name: string; artist_name: string; rg_name: string | null; first_release_date: string | null }[];
  if (rows.length === 0) return null;

  return {
    cluster_key,
    members: rows.map((r) => ({ release_name: r.release_name, artist_name: r.artist_name })),
    rg_name: rows[0].rg_name,
    first_release_date: rows[0].first_release_date,
  };
}

export type ClusteredArtistAlbum = {
  release_name: string;
  release_mbid: string | null;
  plays: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
};

/** Clustered top-albums for an artist page (replaces raw release_name grouping). */
export async function artistClusteredAlbums(
  username: string,
  artistName: string,
  limit: number,
): Promise<ClusteredArtistAlbum[]> {
  return (await withRetry(() =>
    csql.query(
      withAlbumClusters(`
        SELECT
          COALESCE(MIN(rgm.name), mode() WITHIN GROUP (ORDER BY cl.release_name)) AS release_name,
          mode() WITHIN GROUP (ORDER BY cl.release_mbid)
            FILTER (WHERE cl.release_mbid IS NOT NULL)::text AS release_mbid,
          COUNT(*)::int AS plays,
          (array_agg(cl.caa_id ORDER BY cl.listened_at DESC)
            FILTER (WHERE cl.caa_id IS NOT NULL))[1] AS caa_id,
          (array_agg(cl.caa_release_mbid ORDER BY cl.listened_at DESC)
            FILTER (WHERE cl.caa_release_mbid IS NOT NULL))[1]::text AS caa_release_mbid
        FROM clustered cl
        LEFT JOIN release_groups rgm ON rgm.mbid = cl.canon_rg
        WHERE cl.artist_name = $2
        GROUP BY cl.cluster_key, rgm.name
        ORDER BY plays DESC, release_name
        LIMIT $3
      `),
      [username, artistName, limit],
    ),
  )) as ClusteredArtistAlbum[];
}

/** Distinct cluster count for an artist (the artist page's "albums" stat). */
export async function artistClusterCount(username: string, artistName: string): Promise<number> {
  const rows = (await withRetry(() =>
    csql.query(
      withAlbumClusters(
        `SELECT COUNT(DISTINCT cluster_key)::int AS c FROM clustered WHERE artist_name = $2`,
      ),
      [username, artistName],
    ),
  )) as { c: number }[];
  return rows[0]?.c ?? 0;
}

// The agg_album INSERT used by the rebuild. Display name prefers the release
// group's canonical MB title (constant within an adopted cluster), falling
// back to the most-played scrobbled name.
export const ALBUM_AGG_INSERT = withAlbumClusters(`
  INSERT INTO agg_album (
    user_name, scope, group_key, release_name, artist_name,
    plays, effective_ms, caa_id, caa_release_mbid, release_mbid
  )
  SELECT
    $1::text,
    EXTRACT(YEAR FROM cl.listened_at)::int,
    cl.cluster_key,
    COALESCE(MIN(rgm.name), mode() WITHIN GROUP (ORDER BY cl.release_name)),
    mode() WITHIN GROUP (ORDER BY cl.artist_name),
    COUNT(*)::int,
    COALESCE(SUM(COALESCE(cl.duration_ms, rec.length_ms)), 0)::bigint,
    (array_agg(cl.caa_id ORDER BY cl.listened_at DESC)
      FILTER (WHERE cl.caa_id IS NOT NULL))[1],
    (array_agg(cl.caa_release_mbid ORDER BY cl.listened_at DESC)
      FILTER (WHERE cl.caa_release_mbid IS NOT NULL))[1],
    mode() WITHIN GROUP (ORDER BY cl.release_mbid)
      FILTER (WHERE cl.release_mbid IS NOT NULL)
  FROM clustered cl
  LEFT JOIN recordings rec ON rec.mbid = cl.recording_mbid
  LEFT JOIN release_groups rgm ON rgm.mbid = cl.canon_rg
  GROUP BY EXTRACT(YEAR FROM cl.listened_at)::int, cl.cluster_key

  UNION ALL

  SELECT
    $1::text,
    0::int,
    cl.cluster_key,
    COALESCE(MIN(rgm.name), mode() WITHIN GROUP (ORDER BY cl.release_name)),
    mode() WITHIN GROUP (ORDER BY cl.artist_name),
    COUNT(*)::int,
    COALESCE(SUM(COALESCE(cl.duration_ms, rec.length_ms)), 0)::bigint,
    (array_agg(cl.caa_id ORDER BY cl.listened_at DESC)
      FILTER (WHERE cl.caa_id IS NOT NULL))[1],
    (array_agg(cl.caa_release_mbid ORDER BY cl.listened_at DESC)
      FILTER (WHERE cl.caa_release_mbid IS NOT NULL))[1],
    mode() WITHIN GROUP (ORDER BY cl.release_mbid)
      FILTER (WHERE cl.release_mbid IS NOT NULL)
  FROM clustered cl
  LEFT JOIN recordings rec ON rec.mbid = cl.recording_mbid
  LEFT JOIN release_groups rgm ON rgm.mbid = cl.canon_rg
  GROUP BY cl.cluster_key
`);
