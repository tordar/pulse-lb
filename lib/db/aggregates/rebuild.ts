import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { withRetry } from "@/lib/db/retry";

// We use the raw neon client (not drizzle) for two reasons:
//   1. drizzle-orm/neon-http does not support db.transaction().
//   2. neon's HTTP transaction([...]) API bundles multiple statements
//      into one HTTP round trip with BEGIN/COMMIT. That's how we get
//      atomicity for the multi-table rebuild.
const sql = neon(process.env.DATABASE_URL!) as NeonQueryFunction<false, false>;

export async function rebuildAll(username: string): Promise<void> {
  await withRetry(() =>
    sql.transaction([
      sql`DELETE FROM agg_alltime WHERE user_name = ${username}`,
      sql`DELETE FROM agg_year    WHERE user_name = ${username}`,
      sql`DELETE FROM agg_hour    WHERE user_name = ${username}`,
      sql`DELETE FROM agg_day     WHERE user_name = ${username}`,
      sql`DELETE FROM agg_song    WHERE user_name = ${username}`,
      sql`DELETE FROM agg_artist  WHERE user_name = ${username}`,
      sql`DELETE FROM agg_album   WHERE user_name = ${username}`,

      buildAlltime(username),
      buildYear(username),
      buildHour(username),
      buildDay(username),
      buildSong(username),
      buildArtist(username),
      buildAlbum(username),
    ]),
  );
}

function buildAlltime(username: string) {
  return sql`
    INSERT INTO agg_alltime (
      user_name, total_plays, effective_ms,
      distinct_artists, distinct_albums, distinct_songs,
      first_played, last_played, duration_coverage_pct
    )
    SELECT
      ${username}::text,
      COUNT(*)::int,
      COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint,
      COUNT(DISTINCT l.artist_name)::int,
      COUNT(DISTINCT l.release_name)::int,
      COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int,
      MIN(l.listened_at),
      MAX(l.listened_at),
      ROUND(
        100.0 * COUNT(*) FILTER (
          WHERE l.duration_ms IS NOT NULL OR r.length_ms IS NOT NULL
        ) / NULLIF(COUNT(*), 0),
        1
      )::float8
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username}
    HAVING COUNT(*) > 0
  `;
}

function buildYear(username: string) {
  return sql`
    INSERT INTO agg_year (user_name, year, plays, hours)
    SELECT
      ${username}::text,
      EXTRACT(YEAR FROM l.listened_at)::int,
      COUNT(*)::int,
      ROUND(
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0) / 1000.0 / 3600,
        2
      )::float8
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username}
    GROUP BY EXTRACT(YEAR FROM l.listened_at)::int
  `;
}

function buildHour(username: string) {
  return sql`
    INSERT INTO agg_hour (user_name, hour, plays)
    SELECT
      ${username}::text,
      h.hour,
      COALESCE(c.plays, 0)::int
    FROM generate_series(0, 23) AS h(hour)
    LEFT JOIN (
      SELECT EXTRACT(HOUR FROM listened_at)::int AS hour, COUNT(*)::int AS plays
      FROM listens
      WHERE user_name = ${username}
      GROUP BY hour
    ) c USING (hour)
  `;
}

function buildDay(username: string) {
  return sql`
    INSERT INTO agg_day (user_name, date, plays)
    SELECT
      ${username}::text,
      listened_at::date,
      COUNT(*)::int
    FROM listens
    WHERE user_name = ${username}
    GROUP BY listened_at::date
  `;
}

function buildSong(username: string) {
  // UNION ALL of year-scoped rows (scope = year) and all-time rows (scope = 0).
  // Same SELECT shape; the only differences are the scope expression and the
  // GROUP BY columns.
  return sql`
    INSERT INTO agg_song (
      user_name, scope, group_key, track_name, artist_name,
      plays, effective_ms, caa_id, caa_release_mbid, recording_mbid
    )
    -- Year-scoped
    SELECT
      ${username}::text,
      EXTRACT(YEAR FROM l.listened_at)::int,
      COALESCE(l.recording_mbid::text, '~' || l.track_name) || '|' || COALESCE(l.artist_name, ''),
      (array_agg(l.track_name ORDER BY l.listened_at DESC))[1],
      l.artist_name,
      COUNT(*)::int,
      COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint,
      (array_agg(l.caa_id ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_id IS NOT NULL))[1],
      (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1],
      mode() WITHIN GROUP (ORDER BY l.recording_mbid)
        FILTER (WHERE l.recording_mbid IS NOT NULL)
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username}
    GROUP BY
      EXTRACT(YEAR FROM l.listened_at)::int,
      COALESCE(l.recording_mbid::text, '~' || l.track_name) || '|' || COALESCE(l.artist_name, ''),
      l.artist_name

    UNION ALL

    -- All-time (scope = 0 (all-time sentinel))
    SELECT
      ${username}::text,
      0::int,
      COALESCE(l.recording_mbid::text, '~' || l.track_name) || '|' || COALESCE(l.artist_name, ''),
      (array_agg(l.track_name ORDER BY l.listened_at DESC))[1],
      l.artist_name,
      COUNT(*)::int,
      COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint,
      (array_agg(l.caa_id ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_id IS NOT NULL))[1],
      (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1],
      mode() WITHIN GROUP (ORDER BY l.recording_mbid)
        FILTER (WHERE l.recording_mbid IS NOT NULL)
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username}
    GROUP BY
      COALESCE(l.recording_mbid::text, '~' || l.track_name) || '|' || COALESCE(l.artist_name, ''),
      l.artist_name
  `;
}

function buildArtist(username: string) {
  return sql`
    INSERT INTO agg_artist (
      user_name, scope, artist_name, plays, effective_ms,
      distinct_songs, distinct_albums,
      artist_mbid, caa_id, caa_release_mbid
    )
    -- Year-scoped
    SELECT
      ${username}::text,
      EXTRACT(YEAR FROM l.listened_at)::int,
      l.artist_name,
      COUNT(*)::int,
      COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint,
      COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int,
      COUNT(DISTINCT l.release_name)::int,
      mode() WITHIN GROUP (ORDER BY l.artist_mbids[1])
        FILTER (WHERE l.artist_mbids[1] IS NOT NULL),
      (array_agg(l.caa_id ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_id IS NOT NULL))[1],
      (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1]
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username} AND l.artist_name IS NOT NULL
    GROUP BY EXTRACT(YEAR FROM l.listened_at)::int, l.artist_name

    UNION ALL

    -- All-time (scope = 0 (all-time sentinel))
    SELECT
      ${username}::text,
      0::int,
      l.artist_name,
      COUNT(*)::int,
      COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint,
      COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int,
      COUNT(DISTINCT l.release_name)::int,
      mode() WITHIN GROUP (ORDER BY l.artist_mbids[1])
        FILTER (WHERE l.artist_mbids[1] IS NOT NULL),
      (array_agg(l.caa_id ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_id IS NOT NULL))[1],
      (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1]
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username} AND l.artist_name IS NOT NULL
    GROUP BY l.artist_name
  `;
}

function buildAlbum(username: string) {
  return sql`
    INSERT INTO agg_album (
      user_name, scope, group_key, release_name, artist_name,
      plays, effective_ms, caa_id, caa_release_mbid, release_mbid
    )
    -- Year-scoped
    SELECT
      ${username}::text,
      EXTRACT(YEAR FROM l.listened_at)::int,
      l.release_name || '|' || COALESCE(l.artist_name, ''),
      l.release_name,
      l.artist_name,
      COUNT(*)::int,
      COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint,
      (array_agg(l.caa_id ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_id IS NOT NULL))[1],
      (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1],
      mode() WITHIN GROUP (ORDER BY l.release_mbid)
        FILTER (WHERE l.release_mbid IS NOT NULL)
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username} AND l.release_name IS NOT NULL
    GROUP BY EXTRACT(YEAR FROM l.listened_at)::int, l.release_name, l.artist_name

    UNION ALL

    -- All-time (scope = 0 (all-time sentinel))
    SELECT
      ${username}::text,
      0::int,
      l.release_name || '|' || COALESCE(l.artist_name, ''),
      l.release_name,
      l.artist_name,
      COUNT(*)::int,
      COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint,
      (array_agg(l.caa_id ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_id IS NOT NULL))[1],
      (array_agg(l.caa_release_mbid ORDER BY l.listened_at DESC)
        FILTER (WHERE l.caa_release_mbid IS NOT NULL))[1],
      mode() WITHIN GROUP (ORDER BY l.release_mbid)
        FILTER (WHERE l.release_mbid IS NOT NULL)
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username} AND l.release_name IS NOT NULL
    GROUP BY l.release_name, l.artist_name
  `;
}
