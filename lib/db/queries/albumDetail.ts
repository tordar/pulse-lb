import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { ensureRecordingLengths } from "@/lib/listenbrainz/metadata";
import { nameKey, resolveAlbumCluster } from "@/lib/db/aggregates/albumCluster";

export type AlbumHeader = {
  release_name: string;
  artist_name: string;
  caa_id: number | null;
  caa_release_mbid: string | null;
  canonical_release_mbid: string | null;
  release_group_mbid: string | null;
  total_plays: number;
  total_minutes: number;
  distinct_recordings: number;
  first_played: string;
  last_played: string;
  first_release_date: string | null;
};

export type AlbumYear = { year: number; plays: number; hours: number };

export type AlbumTrack = {
  recording_mbid: string | null;
  track_name: string;
  plays: number;
  plays_with_duration: number;
  sum_duration_ms: number;
  minutes: number;
  first_played: string;
};

type Row<T> = { rows: T[] };

/**
 * Look up the (release_name, artist_name) for a given release_mbid so that we
 * can drill into ALL plays under that album name (Spotify-imported listens
 * often share a release_name but split across multiple release_mbids — we want
 * the union, matching what the legacy modal showed).
 */
async function resolveAlbumKey(
  username: string,
  releaseMbid: string,
): Promise<{ release_name: string; artist_name: string } | null> {
  const res = await withRetry(() =>
    db.execute<{ release_name: string; artist_name: string }>(sql`
      SELECT release_name, artist_name
      FROM ${schema.listens}
      WHERE user_name = ${username} AND release_mbid = ${releaseMbid}::uuid AND release_name IS NOT NULL
      LIMIT 1
    `),
  );
  return (res as unknown as Row<{ release_name: string; artist_name: string }>).rows[0] ?? null;
}

export type AlbumDetail = {
  release_mbid: string;
  release_name: string;
  artist_name: string;
  header: AlbumHeader;
  years: AlbumYear[];
  tracks: AlbumTrack[];
};

export async function albumDetail(
  username: string,
  releaseMbid: string,
  hints: { releaseName?: string; artistName?: string } = {},
): Promise<AlbumDetail | null> {
  // Trust caller-supplied (releaseName, artistName) over the release_mbid → name
  // resolution. Why: LB sometimes maps multiple listens of the SAME album to
  // different release_mbids (e.g. some Bowie "Low" plays got rewritten to a
  // box-set release_mbid). Falling back to the MBID resolution alone would
  // navigate users to the box set instead of the album they clicked.
  let release_name: string | undefined = hints.releaseName;
  let artist_name: string | undefined = hints.artistName;
  if (!release_name || !artist_name) {
    const key = await resolveAlbumKey(username, releaseMbid);
    if (!key) return null;
    release_name = key.release_name;
    artist_name = key.artist_name;
  }

  // Pull in the whole cluster (case variants, reissues — see albumCluster.ts)
  // so the detail totals match the clustered albums list. Falls back to the
  // exact name pair when the cluster can't be resolved.
  const cluster = await resolveAlbumCluster(
    username,
    releaseMbid,
    nameKey(release_name, artist_name),
  ).catch(() => null);
  const memberFilter = cluster
    ? sql`(release_name, artist_name) IN (${sql.join(
        cluster.members.map((m) => sql`(${m.release_name}, ${m.artist_name})`),
        sql`, `,
      )})`
    : sql`release_name = ${release_name} AND artist_name = ${artist_name}`;

  const headerRes = await withRetry(() =>
    db.execute<AlbumHeader>(sql`
      SELECT
        ${release_name}::text AS release_name,
        ${artist_name}::text AS artist_name,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1] AS caa_release_mbid,
        mode() WITHIN GROUP (ORDER BY release_mbid) FILTER (WHERE release_mbid IS NOT NULL)::text AS canonical_release_mbid,
        mode() WITHIN GROUP (ORDER BY release_group_mbid) FILTER (WHERE release_group_mbid IS NOT NULL)::text AS release_group_mbid,
        COUNT(*)::int AS total_plays,
        0::float8 AS total_minutes,
        COUNT(DISTINCT COALESCE(recording_mbid::text, track_name))::int AS distinct_recordings,
        MIN(listened_at) AS first_played,
        MAX(listened_at) AS last_played
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND ${memberFilter}
    `),
  );
  const header = (headerRes as unknown as Row<AlbumHeader>).rows[0];
  if (!header || !header.total_plays) return null;

  // Canonical display name + first release date come straight from the
  // cluster's adopted release group when there is one.
  if (cluster?.rg_name) {
    header.release_name = cluster.rg_name;
    release_name = cluster.rg_name;
  }
  header.first_release_date = cluster?.first_release_date ?? null;

  const yearsRes = await withRetry(() =>
    db.execute<AlbumYear>(sql`
      SELECT
        EXTRACT(YEAR FROM listened_at)::int AS year,
        COUNT(*)::int AS plays,
        ROUND(COALESCE(SUM(duration_ms),0)/1000.0/3600, 2)::float8 AS hours
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND ${memberFilter}
      GROUP BY year ORDER BY year
    `),
  );

  const tracksRes = await withRetry(() =>
    db.execute<AlbumTrack>(sql`
      SELECT
        mode() WITHIN GROUP (ORDER BY recording_mbid) FILTER (WHERE recording_mbid IS NOT NULL)::text AS recording_mbid,
        (array_agg(track_name ORDER BY listened_at DESC))[1] AS track_name,
        COUNT(*)::int AS plays,
        COUNT(*) FILTER (WHERE duration_ms IS NOT NULL)::int AS plays_with_duration,
        COALESCE(SUM(duration_ms), 0)::bigint AS sum_duration_ms,
        0::float8 AS minutes,
        MIN(listened_at) AS first_played
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND ${memberFilter}
      GROUP BY COALESCE(recording_mbid::text, '~' || track_name)
      ORDER BY plays DESC, track_name
    `),
  );
  const rawTracks = (tracksRes as unknown as Row<AlbumTrack>).rows;

  // Enrich with canonical recording lengths from LB, then fold them into
  // per-track and total minutes so listens without duration_ms still count.
  const recIds = rawTracks.map((t) => t.recording_mbid).filter((x): x is string => !!x);
  const lengths = await ensureRecordingLengths(recIds);

  const tracks: AlbumTrack[] = rawTracks.map((t) => {
    const canonicalMs = t.recording_mbid ? (lengths.get(t.recording_mbid) ?? 0) : 0;
    const playsMissing = t.plays - t.plays_with_duration;
    const effectiveMs = Number(t.sum_duration_ms) + canonicalMs * playsMissing;
    return { ...t, minutes: effectiveMs / 1000 / 60 };
  });

  const totalMinutes = tracks.reduce((s, t) => s + t.minutes, 0);
  header.total_minutes = totalMinutes;

  return {
    release_mbid: releaseMbid,
    release_name,
    artist_name,
    header,
    years: (yearsRes as unknown as Row<AlbumYear>).rows,
    tracks,
  };
}
