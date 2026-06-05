// Backfill listens.source for existing rows by re-paginating each user's
// listens from ListenBrainz (the only place the source fields live) and
// updating rows by primary key. Newest-first so the visible recent rows get
// dots within the first pages. Re-runnable. ~1 page (1000 listens)/sec.
// Run: npx tsx scripts/backfill-sources.ts
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { getListens, normalizeSource } from "@/lib/listenbrainz/client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Rows<T> = { rows: T[] };

async function backfillUser(username: string) {
  let maxTs: number | undefined;
  let pages = 0;
  let updated = 0;
  let nullSource = 0;

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

    const values = listens.flatMap((l) => {
      const source = normalizeSource(l.track_metadata.additional_info ?? {});
      if (!source) {
        nullSource++;
        return [];
      }
      return [
        sql`(to_timestamp(${l.listened_at}), ${l.track_metadata.track_name}::text, ${source}::text)`,
      ];
    });
    if (values.length > 0) {
      const res = (await withRetry(() => db.execute(sql`
        UPDATE listens SET source = data.source
        FROM (VALUES ${sql.join(values, sql`, `)}) AS data(listened_at, track_name, source)
        WHERE listens.user_name = ${username}
          AND listens.listened_at = data.listened_at
          AND listens.track_name = data.track_name
          AND listens.source IS DISTINCT FROM data.source
        RETURNING 1 AS one
      `))) as unknown as Rows<unknown>;
      updated += res.rows.length;
    }

    if (pages % 20 === 0) console.log(`[${username}] ${pages} pages, ${updated} updated`);
    maxTs = listens[listens.length - 1].listened_at;
    await sleep(1_100);
  }
  console.log(
    `[${username}] done: ${pages} pages, ${updated} rows updated, ${nullSource} listens had no usable source`,
  );
}

async function main() {
  const users = (
    (await db.execute(sql`SELECT DISTINCT user_name FROM listens`)) as unknown as Rows<{
      user_name: string;
    }>
  ).rows.map((r) => r.user_name);
  for (const u of users) await backfillUser(u);

  const cov = (await db.execute(sql`
    SELECT user_name, COUNT(*)::int AS total,
           COUNT(source)::int AS with_source
    FROM listens GROUP BY user_name
  `)) as unknown as Rows<{ user_name: string; total: number; with_source: number }>;
  for (const r of cov.rows) {
    console.log(`[coverage] ${r.user_name}: ${r.with_source}/${r.total} listens have a source`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
