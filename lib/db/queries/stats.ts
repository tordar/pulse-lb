import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";

type Row<T> = { rows: T[] };

export type AllTimeStats = {
  total_plays: number;
  effective_ms: number;
  distinct_artists: number;
  distinct_albums: number;
  distinct_songs: number;
  first_played: string | null;
  last_played: string | null;
  duration_coverage_pct: number;
};

export async function allTimeStats(username: string): Promise<AllTimeStats> {
  const res = await withRetry(() =>
    db.execute<AllTimeStats>(sql`
      SELECT
        COUNT(*)::int AS total_plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms,
        COUNT(DISTINCT l.artist_name)::int AS distinct_artists,
        COUNT(DISTINCT l.release_name)::int AS distinct_albums,
        COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int AS distinct_songs,
        MIN(l.listened_at) AS first_played,
        MAX(l.listened_at) AS last_played,
        ROUND(100.0 * COUNT(*) FILTER (WHERE l.duration_ms IS NOT NULL OR r.length_ms IS NOT NULL) / NULLIF(COUNT(*), 0), 1)::float8 AS duration_coverage_pct
      FROM ${schema.listens} l
      LEFT JOIN ${schema.recordings} r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${username}
    `),
  );
  return (res as unknown as Row<AllTimeStats>).rows[0];
}

export type TodayStats = {
  plays: number;
  effective_ms: number;
};

export async function todayStats(username: string, tzOffsetMinutes = 0): Promise<TodayStats> {
  const res = await withRetry(() =>
    db.execute<TodayStats>(sql`
      SELECT
        COUNT(*)::int AS plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms
      FROM ${schema.listens} l
      LEFT JOIN ${schema.recordings} r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${username}
        AND (l.listened_at AT TIME ZONE 'UTC' + (${tzOffsetMinutes} || ' minutes')::interval)::date
          = (now() AT TIME ZONE 'UTC' + (${tzOffsetMinutes} || ' minutes')::interval)::date
    `),
  );
  return (res as unknown as Row<TodayStats>).rows[0] ?? { plays: 0, effective_ms: 0 };
}

export type YearlyPoint = { year: number; plays: number; hours: number };

export async function yearlyListening(username: string): Promise<YearlyPoint[]> {
  const res = await withRetry(() =>
    db.execute<YearlyPoint>(sql`
      SELECT
        EXTRACT(YEAR FROM l.listened_at)::int AS year,
        COUNT(*)::int AS plays,
        ROUND(COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)/1000.0/3600, 2)::float8 AS hours
      FROM ${schema.listens} l
      LEFT JOIN ${schema.recordings} r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${username}
      GROUP BY year ORDER BY year
    `),
  );
  return (res as unknown as Row<YearlyPoint>).rows;
}

export type HourlyPoint = { hour: number; plays: number };

export async function hourlyDistribution(
  username: string,
  tzOffsetMinutes = 0,
): Promise<HourlyPoint[]> {
  const res = await withRetry(() =>
    db.execute<HourlyPoint>(sql`
      WITH local AS (
        SELECT EXTRACT(HOUR FROM (listened_at + (${tzOffsetMinutes} || ' minutes')::interval))::int AS hour
        FROM ${schema.listens}
        WHERE user_name = ${username}
      )
      SELECT h.hour, COALESCE(c.plays, 0)::int AS plays
      FROM generate_series(0, 23) AS h(hour)
      LEFT JOIN (SELECT hour, COUNT(*)::int AS plays FROM local GROUP BY hour) c USING (hour)
      ORDER BY h.hour
    `),
  );
  return (res as unknown as Row<HourlyPoint>).rows;
}

export type TopSongInYear = {
  track_name: string;
  artist_name: string;
  plays: number;
  effective_ms: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
  recording_mbid: string | null;
};

export type TopAlbumInYear = {
  release_name: string;
  artist_name: string;
  plays: number;
  effective_ms: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
  release_mbid: string | null;
};

export type TopArtistInYear = {
  artist_name: string;
  plays: number;
  effective_ms: number;
  distinct_songs: number;
  artist_mbid: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
};

export async function availableYears(username: string): Promise<number[]> {
  const res = await withRetry(() =>
    db.execute<{ year: number }>(sql`
      SELECT DISTINCT EXTRACT(YEAR FROM listened_at)::int AS year
      FROM ${schema.listens}
      WHERE user_name = ${username}
      ORDER BY year DESC
    `),
  );
  return (res as unknown as Row<{ year: number }>).rows.map((r) => r.year);
}

export async function topSongsByYear(
  username: string,
  year: number,
  limit = 5,
): Promise<TopSongInYear[]> {
  const res = await withRetry(() =>
    db.execute<TopSongInYear>(sql`
      SELECT
        (array_agg(l.track_name ORDER BY l.listened_at DESC))[1] AS track_name,
        l.artist_name,
        COUNT(*)::int AS plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms,
        (array_agg(l.caa_id ORDER BY l.listened_at DESC) FILTER (WHERE l.caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC) FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1] AS caa_release_mbid,
        mode() WITHIN GROUP (ORDER BY l.recording_mbid) FILTER (WHERE l.recording_mbid IS NOT NULL)::text AS recording_mbid
      FROM ${schema.listens} l
      LEFT JOIN ${schema.recordings} r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${username}
        AND EXTRACT(YEAR FROM l.listened_at)::int = ${year}
      GROUP BY COALESCE(l.recording_mbid::text, '~' || l.track_name), l.artist_name
      ORDER BY plays DESC, track_name
      LIMIT ${limit}
    `),
  );
  return (res as unknown as Row<TopSongInYear>).rows;
}

export async function topAlbumsByYear(
  username: string,
  year: number,
  limit = 5,
): Promise<TopAlbumInYear[]> {
  const res = await withRetry(() =>
    db.execute<TopAlbumInYear>(sql`
      SELECT
        l.release_name,
        l.artist_name,
        COUNT(*)::int AS plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms,
        (array_agg(l.caa_id ORDER BY l.listened_at DESC) FILTER (WHERE l.caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC) FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1] AS caa_release_mbid,
        mode() WITHIN GROUP (ORDER BY l.release_mbid) FILTER (WHERE l.release_mbid IS NOT NULL)::text AS release_mbid
      FROM ${schema.listens} l
      LEFT JOIN ${schema.recordings} r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${username}
        AND l.release_name IS NOT NULL
        AND EXTRACT(YEAR FROM l.listened_at)::int = ${year}
      GROUP BY l.release_name, l.artist_name
      ORDER BY plays DESC, l.release_name
      LIMIT ${limit}
    `),
  );
  return (res as unknown as Row<TopAlbumInYear>).rows;
}

export async function topArtistsByYear(
  username: string,
  year: number,
  limit = 5,
): Promise<TopArtistInYear[]> {
  const res = await withRetry(() =>
    db.execute<TopArtistInYear>(sql`
      SELECT
        l.artist_name,
        COUNT(*)::int AS plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms,
        COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int AS distinct_songs,
        mode() WITHIN GROUP (ORDER BY l.artist_mbids[1]) FILTER (WHERE l.artist_mbids[1] IS NOT NULL)::text AS artist_mbid,
        (array_agg(l.caa_id ORDER BY l.listened_at DESC) FILTER (WHERE l.caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC) FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1] AS caa_release_mbid
      FROM ${schema.listens} l
      LEFT JOIN ${schema.recordings} r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${username}
        AND l.artist_name IS NOT NULL
        AND EXTRACT(YEAR FROM l.listened_at)::int = ${year}
      GROUP BY l.artist_name
      ORDER BY plays DESC, l.artist_name
      LIMIT ${limit}
    `),
  );
  return (res as unknown as Row<TopArtistInYear>).rows;
}

export type DailyPoint = { date: string; plays: number };

/**
 * One row per day Jan 1 → Dec 31 of `year`. Future days return 0 plays so the
 * heatmap can still render the full year grid.
 */
export async function dailyListeningByYear(
  username: string,
  year: number,
  tzOffsetMinutes = 0,
): Promise<DailyPoint[]> {
  const res = await withRetry(() =>
    db.execute<DailyPoint>(sql`
      WITH dates AS (
        SELECT generate_series(
          make_date(${year}, 1, 1),
          make_date(${year}, 12, 31),
          '1 day'::interval
        )::date AS day
      ),
      plays_by_day AS (
        SELECT (listened_at + (${tzOffsetMinutes} || ' minutes')::interval)::date AS day, COUNT(*)::int AS plays
        FROM ${schema.listens}
        WHERE user_name = ${username}
          AND listened_at >= make_date(${year}, 1, 1)
          AND listened_at <  make_date(${year} + 1, 1, 1)
        GROUP BY day
      )
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(p.plays, 0)::int AS plays
      FROM dates d LEFT JOIN plays_by_day p ON p.day = d.day
      ORDER BY d.day
    `),
  );
  return (res as unknown as Row<DailyPoint>).rows;
}

export type DayListen = {
  listened_at: string;
  track_name: string;
  artist_name: string;
  release_name: string | null;
  recording_mbid: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
};

export type DaySummary = {
  date: string;
  plays: number;
  effective_ms: number;
  distinct_tracks: number;
  distinct_artists: number;
  listens: DayListen[];
};

export async function dayDetail(
  username: string,
  date: string,
  tzOffsetMinutes = 0,
): Promise<DaySummary | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const summaryRes = await withRetry(() =>
    db.execute<Omit<DaySummary, "listens">>(sql`
      SELECT
        ${date}::text AS date,
        COUNT(*)::int AS plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms,
        COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int AS distinct_tracks,
        COUNT(DISTINCT l.artist_name)::int AS distinct_artists
      FROM ${schema.listens} l
      LEFT JOIN ${schema.recordings} r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${username}
        AND (l.listened_at + (${tzOffsetMinutes} || ' minutes')::interval)::date = ${date}::date
    `),
  );
  const summary = (summaryRes as unknown as Row<Omit<DaySummary, "listens">>).rows[0];

  const listensRes = await withRetry(() =>
    db.execute<DayListen>(sql`
      SELECT
        listened_at,
        track_name,
        artist_name,
        release_name,
        recording_mbid::text AS recording_mbid,
        caa_id,
        caa_release_mbid::text AS caa_release_mbid
      FROM ${schema.listens}
      WHERE user_name = ${username}
        AND (listened_at + (${tzOffsetMinutes} || ' minutes')::interval)::date = ${date}::date
      ORDER BY listened_at ASC
      LIMIT 200
    `),
  );

  return {
    ...summary,
    listens: (listensRes as unknown as Row<DayListen>).rows,
  };
}
