// Read-only before/after analysis of the album clustering — run BEFORE
// switching the aggregates over. Uses the exact ALBUM_CLUSTER_CTE that the
// rebuild will use, so what this reports is what ships.
// Run: npx tsx scripts/analyze-album-clusters.ts [username]
import "dotenv/config";
import postgres from "postgres";
import { withAlbumClusters } from "@/lib/db/aggregates/albumCluster";

const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

async function analyzeUser(username: string) {
  console.log(`\n===== ${username} =====`);

  const counts = (await sql.unsafe(
    withAlbumClusters(`
      SELECT
        COUNT(DISTINCT release_name || '|' || COALESCE(artist_name, ''))::int AS before_groups,
        COUNT(DISTINCT cluster_key)::int AS after_clusters,
        COUNT(DISTINCT release_name)::int AS before_distinct_albums
      FROM clustered
    `),
    [username],
  )) as { before_groups: number; after_clusters: number; before_distinct_albums: number }[];
  const c = counts[0];
  console.log(
    `album groups: ${c.before_groups} -> ${c.after_clusters} ` +
      `(${c.before_groups - c.after_clusters} merged away)`,
  );
  console.log(
    `"albums" stat tile would go: ${c.before_distinct_albums} -> ${c.after_clusters}`,
  );

  // Every cluster that merged >1 raw release_name, biggest first — this is
  // the list to eyeball for wrong merges.
  const merges = (await sql.unsafe(
    withAlbumClusters(`
      SELECT
        COALESCE(rgm.name, mode() WITHIN GROUP (ORDER BY cl.release_name)) AS display_name,
        mode() WITHIN GROUP (ORDER BY cl.artist_name) AS artist,
        COUNT(*)::int AS plays,
        COUNT(DISTINCT cl.release_name)::int AS n_names,
        array_agg(DISTINCT cl.release_name) AS member_names
      FROM clustered cl
      LEFT JOIN release_groups rgm ON rgm.mbid = cl.canon_rg
      GROUP BY cl.cluster_key, rgm.name
      HAVING COUNT(DISTINCT cl.release_name) > 1
      ORDER BY plays DESC
    `),
    [username],
  )) as { display_name: string; artist: string; plays: number; n_names: number; member_names: string[] }[];

  console.log(`\nmerged clusters: ${merges.length}`);
  for (const m of merges.slice(0, 40)) {
    console.log(`\n  "${m.display_name}" — ${m.artist} (${m.plays} plays, ${m.n_names} variants)`);
    for (const name of m.member_names) console.log(`     · ${name}`);
  }
  if (merges.length > 40) console.log(`\n  … and ${merges.length - 40} more merged clusters`);
}

async function main() {
  const arg = process.argv[2];
  const users = arg
    ? [arg]
    : ((await sql.unsafe(`SELECT DISTINCT user_name FROM listens`, [])) as { user_name: string }[]).map(
        (r) => r.user_name,
      );
  for (const u of users) await analyzeUser(u);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
