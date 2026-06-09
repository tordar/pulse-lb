import "dotenv/config";
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [r] = await sql`
    WITH per_album AS (
      SELECT artist_name, release_name, COUNT(*)::int AS plays,
             MAX(release_group_mbid IS NOT NULL::int)::int AS has_rgid
      FROM listens
      WHERE user_name='tordar' AND release_name IS NOT NULL
      GROUP BY artist_name, release_name
    )
    SELECT
      COUNT(*)::int AS unique_albums,
      SUM(CASE WHEN has_rgid = 1 THEN 1 ELSE 0 END)::int AS covered_albums,
      SUM(plays)::int AS total_plays,
      SUM(CASE WHEN has_rgid = 1 THEN plays ELSE 0 END)::int AS covered_plays,
      ROUND(100.0 * SUM(CASE WHEN has_rgid = 1 THEN plays ELSE 0 END) / SUM(plays), 2) AS pct_plays_covered,
      ROUND(100.0 * SUM(CASE WHEN has_rgid = 1 THEN 1 ELSE 0 END) / COUNT(*), 2) AS pct_albums_covered
    FROM per_album
  `;
  console.log(r);
  // Distribution of uncovered albums
  const dist = await sql`
    SELECT
      CASE WHEN plays < 5 THEN '<5'
           WHEN plays < 10 THEN '5-9'
           WHEN plays < 25 THEN '10-24'
           WHEN plays < 50 THEN '25-49'
           ELSE '50+' END AS bucket,
      COUNT(*)::int AS albums,
      SUM(plays)::int AS plays
    FROM (
      SELECT artist_name, release_name, COUNT(*)::int AS plays,
             MAX((release_group_mbid IS NOT NULL)::int)::int AS has_rgid
      FROM listens WHERE user_name='tordar' AND release_name IS NOT NULL
      GROUP BY artist_name, release_name
    ) p
    WHERE has_rgid = 0
    GROUP BY bucket ORDER BY MIN(plays)
  `;
  console.log("Uncovered album distribution:");
  for (const r of dist) console.log(' ', r);
  await sql.end();
}
main();
