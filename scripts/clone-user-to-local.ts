import "dotenv/config";
import postgres from "postgres";

const USER = process.argv[2];
if (!USER) throw new Error("usage: tsx scripts/clone-user-to-local.ts <username>");
const dst = process.env.DATABASE_URL!;
if (!/localhost|127\.0\.0\.1/.test(dst)) throw new Error("DATABASE_URL must be local");
const src = postgres(process.env.SOURCE_DATABASE_URL!, { max: 1, prepare: false });
const out = postgres(dst, { max: 1, prepare: false });

async function copy(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    if (chunk.length) await out`INSERT INTO ${out(table)} ${out(chunk)} ON CONFLICT DO NOTHING`;
  }
  console.log(`${table}: ${rows.length}`);
}

async function main() {
  await out`DELETE FROM listens WHERE user_name = ${USER}`;
  const listens = await src`SELECT * FROM listens WHERE user_name = ${USER}`;
  await copy("listens", listens);
  await copy("recordings", await src`
    SELECT r.* FROM recordings r WHERE r.mbid IN (
      SELECT DISTINCT recording_mbid FROM listens WHERE user_name = ${USER} AND recording_mbid IS NOT NULL)`);
  await copy("releases", await src`
    SELECT r.* FROM releases r WHERE r.mbid IN (
      SELECT DISTINCT release_mbid FROM listens WHERE user_name = ${USER} AND release_mbid IS NOT NULL)`);
  await copy("release_groups", await src`
    SELECT g.* FROM release_groups g WHERE g.mbid IN (
      SELECT release_group_mbid FROM listens WHERE user_name = ${USER} AND release_group_mbid IS NOT NULL
      UNION
      SELECT rel.release_group_mbid FROM releases rel JOIN listens l ON l.release_mbid = rel.mbid
      WHERE l.user_name = ${USER} AND rel.release_group_mbid IS NOT NULL)`);
  await out`INSERT INTO sync_state (user_name, last_listened_at, total_listens)
            SELECT ${USER}, MAX(listened_at), COUNT(*)::int FROM listens WHERE user_name = ${USER}
            ON CONFLICT (user_name) DO UPDATE SET last_listened_at = EXCLUDED.last_listened_at`;
  await src.end(); await out.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
