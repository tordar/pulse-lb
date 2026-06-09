import "dotenv/config";
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const [cov] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE release_group_mbid IS NOT NULL)::int AS have_rgid,
      COUNT(*) FILTER (WHERE release_mbid       IS NOT NULL)::int AS have_rel,
      COUNT(*) FILTER (WHERE recording_mbid     IS NOT NULL)::int AS have_rec,
      ROUND(100.0 * COUNT(*) FILTER (WHERE release_group_mbid IS NOT NULL) / COUNT(*), 2) AS pct_rgid,
      ROUND(100.0 * COUNT(*) FILTER (WHERE release_mbid       IS NOT NULL) / COUNT(*), 2) AS pct_rel
    FROM listens WHERE user_name='tordar'
  `;
  console.log("DB coverage:", cov);
  await sql.end();
}
main();
