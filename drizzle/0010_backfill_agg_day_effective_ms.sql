-- 0009 added agg_day.effective_ms with DEFAULT 0, so every pre-existing row
-- reads as "no listening time" until that user's aggregates are rebuilt. The
-- year heatmap and day-bar chart both shade by listening time, so an unbackfilled
-- row renders as silence.
--
-- A full rebuildAll() would fix it, but it rewrites agg_song/agg_album too
-- (~190 MB), which does not fit inside the storage headroom on a small Postgres.
-- This touches only agg_day (~2 MB) and is idempotent: days that genuinely have
-- no duration coverage stay at 0 and are simply recomputed on a re-run.
UPDATE agg_day a
SET effective_ms = s.ms
FROM (
  SELECT l.user_name,
         l.listened_at::date AS date,
         COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS ms
  FROM listens l
  LEFT JOIN recordings r ON r.mbid = l.recording_mbid
  GROUP BY l.user_name, l.listened_at::date
) s
WHERE a.user_name = s.user_name
  AND a.date = s.date
  AND a.effective_ms = 0
  AND s.ms > 0;
