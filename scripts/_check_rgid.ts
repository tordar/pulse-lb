import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
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
}
main();
