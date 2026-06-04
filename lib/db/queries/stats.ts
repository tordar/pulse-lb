import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";

type Row<T> = { rows: T[] };

// Cache aggregate reads behind a per-user tag. Invalidated by the sync route
// after rebuildAll completes, so year tabs hit cache between syncs instead
// of re-running 8 sequential Neon HTTP round trips per click.
function userCached<T>(
  username: string,
  keys: (string | number)[],
  fn: () => Promise<T>,
): Promise<T> {
  return unstable_cache(fn, keys.map(String), {
    tags: [`user:${username}`],
    revalidate: false,
  })();
}

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
  return userCached(username, ["allTimeStats", username], async () => {
    const res = await withRetry(() =>
      db.execute<AllTimeStats>(sql`
        SELECT
          total_plays,
          effective_ms,
          distinct_artists,
          distinct_albums,
          distinct_songs,
          first_played,
          last_played,
          duration_coverage_pct
        FROM ${schema.aggAlltime}
        WHERE user_name = ${username}
      `),
    );
    const row = (res as unknown as Row<AllTimeStats>).rows[0];
    return row ?? {
      total_plays: 0,
      effective_ms: 0,
      distinct_artists: 0,
      distinct_albums: 0,
      distinct_songs: 0,
      first_played: null,
      last_played: null,
      duration_coverage_pct: 0,
    };
  });
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
  return userCached(username, ["yearlyListening", username], async () => {
    const res = await withRetry(() =>
      db.execute<YearlyPoint>(sql`
        SELECT year, plays, hours
        FROM ${schema.aggYear}
        WHERE user_name = ${username}
        ORDER BY year
      `),
    );
    return (res as unknown as Row<YearlyPoint>).rows;
  });
}

export type HourlyPoint = { hour: number; plays: number };

export async function hourlyDistribution(username: string): Promise<HourlyPoint[]> {
  return userCached(username, ["hourlyDistribution", username], async () => {
    const res = await withRetry(() =>
      db.execute<HourlyPoint>(sql`
        SELECT hour, plays
        FROM ${schema.aggHour}
        WHERE user_name = ${username}
        ORDER BY hour
      `),
    );
    return (res as unknown as Row<HourlyPoint>).rows;
  });
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
  return userCached(username, ["availableYears", username], async () => {
    const res = await withRetry(() =>
      db.execute<{ year: number }>(sql`
        SELECT year FROM ${schema.aggYear}
        WHERE user_name = ${username}
        ORDER BY year DESC
      `),
    );
    return (res as unknown as Row<{ year: number }>).rows.map((r) => r.year);
  });
}

export async function topSongsByYear(
  username: string,
  year: number,
  limit = 5,
): Promise<TopSongInYear[]> {
  return userCached(username, ["topSongsByYear", username, year, limit], async () => {
    const res = await withRetry(() =>
      db.execute<TopSongInYear>(sql`
        SELECT track_name, artist_name, plays, effective_ms,
               caa_id, caa_release_mbid, recording_mbid
        FROM ${schema.aggSong}
        WHERE user_name = ${username} AND scope = ${year}
        ORDER BY plays DESC, track_name
        LIMIT ${limit}
      `),
    );
    return (res as unknown as Row<TopSongInYear>).rows;
  });
}

export async function topAlbumsByYear(
  username: string,
  year: number,
  limit = 5,
): Promise<TopAlbumInYear[]> {
  return userCached(username, ["topAlbumsByYear", username, year, limit], async () => {
    const res = await withRetry(() =>
      db.execute<TopAlbumInYear>(sql`
        SELECT release_name, artist_name, plays, effective_ms,
               caa_id, caa_release_mbid, release_mbid
        FROM ${schema.aggAlbum}
        WHERE user_name = ${username} AND scope = ${year}
        ORDER BY plays DESC, release_name
        LIMIT ${limit}
      `),
    );
    return (res as unknown as Row<TopAlbumInYear>).rows;
  });
}

export async function topArtistsByYear(
  username: string,
  year: number,
  limit = 5,
): Promise<TopArtistInYear[]> {
  return userCached(username, ["topArtistsByYear", username, year, limit], async () => {
    const res = await withRetry(() =>
      db.execute<TopArtistInYear>(sql`
        SELECT artist_name, plays, effective_ms, distinct_songs,
               artist_mbid, caa_id, caa_release_mbid
        FROM ${schema.aggArtist}
        WHERE user_name = ${username} AND scope = ${year}
        ORDER BY plays DESC, artist_name
        LIMIT ${limit}
      `),
    );
    return (res as unknown as Row<TopArtistInYear>).rows;
  });
}

export type DailyPoint = { date: string; plays: number };

/**
 * One row per day Jan 1 → Dec 31 of `year`. Future days return 0 plays so the
 * heatmap can still render the full year grid.
 */
export async function dailyListeningByYear(
  username: string,
  year: number,
): Promise<DailyPoint[]> {
  return userCached(username, ["dailyListeningByYear", username, year], async () => {
    const res = await withRetry(() =>
      db.execute<DailyPoint>(sql`
        SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
               COALESCE(a.plays, 0)::int AS plays
        FROM generate_series(
          make_date(${year}, 1, 1),
          make_date(${year}, 12, 31),
          '1 day'::interval
        ) d(day)
        LEFT JOIN ${schema.aggDay} a
          ON a.user_name = ${username} AND a.date = d.day::date
        ORDER BY d.day
      `),
    );
    return (res as unknown as Row<DailyPoint>).rows;
  });
}

export type DayListen = {
  listened_at: string;
  track_name: string;
  artist_name: string;
  release_name: string | null;
  recording_mbid: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
  source: string | null;
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
        caa_release_mbid::text AS caa_release_mbid,
        source
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
