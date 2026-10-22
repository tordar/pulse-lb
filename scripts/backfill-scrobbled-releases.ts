// Re-derive release, release group and cover for existing listens now that
// listenToRow prefers the scrobbled release over LB's mapper. Re-paginates
// each user's listens from ListenBrainz (the only place additional_info
// lives) and updates rows by primary key. Re-runnable. Rebuild aggregates
// afterwards (scripts/bootstrap-aggregates.ts).
// Run: npx tsx scripts/backfill-scrobbled-releases.ts [--dry-run]
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { getListens } from "@/lib/listenbrainz/client";
import { listensToRows } from "@/lib/sync/syncUser";

const DRY = process.argv.includes("--dry-run");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function backfillUser(username: string) {
  let maxTs: number | undefined;
  let pages = 0;
  let changed = 0;
  const lookups = new Set<string>();

  while (true) {
    let listens;
    try {
      listens = await getListens({ username, count: 1000, maxTs });
    } catch (e) {
      console.error(`[${username}] page ${pages}: ${e} — retrying in 10s`);
      await sleep(10_000);
      continue;
    }
    if (listens.length === 0) break;
    pages++;

    const rows = await listensToRows(username, listens, {
      maxLookups: DRY ? 0 : Infinity,
    });
    if (DRY) for (const r of rows) if (r.caaId == null && r.releaseMbid) lookups.add(r.releaseMbid);

    const values = rows.map((r) => sql`(
      to_timestamp(${r.listenedAt.getTime() / 1000}), ${r.trackName}::text,
      ${r.releaseMbid}::uuid, ${r.releaseGroupMbid}::uuid, ${r.caaId}::bigint, ${r.caaReleaseMbid}::uuid
    )`);
    const data = sql`(VALUES ${sql.join(values, sql`, `)})
      AS d(listened_at, track_name, release_mbid, release_group_mbid, caa_id, caa_release_mbid)`;
    const match = sql`listens.user_name = ${username}
      AND listens.listened_at = d.listened_at
      AND listens.track_name = d.track_name
      AND (listens.release_mbid IS DISTINCT FROM d.release_mbid
        OR listens.release_group_mbid IS DISTINCT FROM d.release_group_mbid
        OR (${!DRY} AND listens.caa_id IS DISTINCT FROM d.caa_id))`;
    const res = (await withRetry(() => db.execute(DRY
      ? sql`SELECT 1 AS one FROM listens JOIN ${data} ON ${match}`
      : sql`UPDATE listens SET
          release_mbid = d.release_mbid, release_group_mbid = d.release_group_mbid,
          caa_id = d.caa_id, caa_release_mbid = d.caa_release_mbid
        FROM ${data} WHERE ${match} RETURNING 1 AS one`,
    )));
    changed += res.length;

    if (pages % 20 === 0) console.log(`[${username}] ${pages} pages, ${changed} ${DRY ? "would change" : "updated"}`);
    maxTs = listens[listens.length - 1].listened_at;
    await sleep(1_100);
  }
  console.log(`[${username}] done: ${pages} pages, ${changed} rows ${DRY ? "would change" : "updated"}` +
    (DRY ? `, ${lookups.size} releases need a cover lookup (some already cached)` : ""));
}

async function main() {
  const users = (await sqlClient<{ user_name: string }[]>`SELECT DISTINCT user_name FROM listens`).map(
    (r) => r.user_name,
  );
  for (const u of users) await backfillUser(u);
  await sqlClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
