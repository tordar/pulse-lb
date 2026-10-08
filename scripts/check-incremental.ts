import "dotenv/config";
import { sqlClient } from "@/lib/db/client";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";
import { lockUser } from "@/lib/db/aggregates/lock";
import { planIncremental, applyIncremental, type NewListenKey } from "@/lib/db/aggregates/incremental";
import { snapshot, diff } from "./agg-snapshot";

if (!/localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local DB only");
const USER = process.argv[2] ?? "tordar";
const sql = sqlClient;

type Row = Record<string, unknown> & { listened_at: string; track_name: string; artist_name: string | null;
  release_mbid: string | null; release_group_mbid: string | null };

const key = (r: Row): NewListenKey => ({
  listenedAt: r.listened_at, trackName: r.track_name, artistName: r.artist_name,
  releaseMbid: r.release_mbid, releaseGroupMbid: r.release_group_mbid,
});

async function withhold(rows: Row[]) {
  await sql`DELETE FROM listens l USING unnest(${rows.map((r) => r.listened_at)}::text[]::timestamptz[],
      ${rows.map((r) => r.track_name)}::text[]) AS w(ts, track)
    WHERE l.user_name = ${USER} AND l.listened_at = w.ts AND l.track_name = w.track`;
}

async function scenario(name: string, pick: () => Promise<Row[]>, synthetic = false) {
  const rows = await pick();
  if (rows.length === 0) throw new Error(`${name}: picked no rows`);
  if (!synthetic) {
    await withhold(rows);
  }
  await rebuildAll(USER);
  await sql.begin(async (tx) => {
    await lockUser(tx, USER);
    const plan = await planIncremental(tx, USER, rows.map(key));
    const inserted = (await tx`INSERT INTO listens ${tx(rows)} ON CONFLICT DO NOTHING
      RETURNING listened_at, track_name, artist_name, release_mbid, release_group_mbid`) as unknown as Row[];
    await applyIncremental(tx, USER, plan, inserted.map(key));
  });
  const inc = await snapshot(sql, USER);
  await rebuildAll(USER);
  const full = await snapshot(sql, USER);
  const problems = diff(inc, full);
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name} (${rows.length} listens)`);
  problems.forEach((p) => console.log("   " + p));
  if (synthetic) {
    await withhold(rows);
    await rebuildAll(USER);
  }
  return problems.length === 0;
}

const newest = (n: number) => () => sql<Row[]>`
  SELECT * FROM listens WHERE user_name = ${USER} ORDER BY listened_at DESC LIMIT ${n}`;

async function main() {
  const results = [
    await scenario("newest 1", newest(1)),
    await scenario("newest 25", newest(25)),
    await scenario("newest 400 (spans days)", newest(400)),
    // Review Focus 2: a listen from an artist inside a cross-artist cluster.
    await scenario("cross-artist cluster", () => sql<Row[]>`
      SELECT l.* FROM listens l
      WHERE l.user_name = ${USER} AND lower(l.artist_name) IN (
        SELECT unnest(member_artists) FROM agg_album
        WHERE user_name = ${USER} AND scope = 0 AND array_length(member_artists, 1) > 1 LIMIT 3)
      ORDER BY l.listened_at DESC LIMIT 10`),
    // Review Focus 1: a re-spelled copy of a real listen, one second later.
    await scenario("case variant", async () => {
      const [r] = await sql<Row[]>`SELECT * FROM listens WHERE user_name = ${USER}
        AND release_name IS NOT NULL ORDER BY listened_at DESC LIMIT 1`;
      return [{ ...r, listened_at: new Date(new Date(r.listened_at).getTime() + 1000).toISOString(),
        artist_name: r.artist_name!.toUpperCase() === r.artist_name ? r.artist_name!.toLowerCase() : r.artist_name!.toUpperCase() }];
    }, true),
    // Review Focus 5: brand-new artist, new day, new year.
    await scenario("new artist / new day / new year", async () => [{
      user_name: USER, listened_at: "2031-01-01T00:30:00Z", track_name: "Zz Test Track",
      artist_name: "Zz Test Artist", release_name: "Zz Test Album", recording_mbid: null,
      release_mbid: null, release_group_mbid: null, artist_mbids: [], caa_id: null,
      caa_release_mbid: null, duration_ms: 123000, source: null, inserted_at: new Date().toISOString(),
    } as Row], true),
  ];
  await sql.end();
  if (results.includes(false)) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
