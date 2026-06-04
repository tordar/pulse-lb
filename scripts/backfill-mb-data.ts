// One-shot (re-runnable) backfill of MusicBrainz metadata via the batched
// search API: first-release-dates for every release group seen in listens,
// and lengths for every recording missing one. ~100 entities per request at
// ~1 req/s keeps us inside MB's rate limit while covering tens of thousands
// of entities in minutes. Run with: npx tsx scripts/backfill-mb-data.ts
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  searchReleaseGroupDates,
  searchRecordingLengths,
  searchReleaseRGs,
  yearOf,
} from "@/lib/musicbrainz/client";

const BATCH = 100;
const PACE_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Rows<T> = { rows: T[] };

async function withAttempts<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      console.error(`${label} attempt ${attempt}: ${e}`);
      await sleep(5_000 * attempt);
    }
  }
  return null;
}

// LB's listen payloads often carry a release_mbid but no release_group_mbid;
// resolve release → RG via MB so clustering and dates can reach those listens.
async function backfillReleaseRGs() {
  const res = (await db.execute(sql`
    SELECT DISTINCT l.release_mbid::text AS mbid
    FROM listens l
    LEFT JOIN releases rel ON rel.mbid = l.release_mbid
    WHERE l.release_mbid IS NOT NULL AND (rel.mbid IS NULL OR rel.release_group_mbid IS NULL)
  `)) as unknown as Rows<{ mbid: string }>;
  const ids = res.rows.map((r) => r.mbid);
  console.log(`[rel] missing rg mapping: ${ids.length}`);

  let resolved = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await withAttempts(() => searchReleaseRGs(batch), `[rel] batch ${i / BATCH}`);
    if (results === null) continue;
    const byId = new Map(results.map((r) => [r.mbid, r]));
    const values = batch.map((mbid) => {
      const hit = byId.get(mbid);
      if (hit?.releaseGroupMbid) resolved++;
      return sql`(${mbid}::uuid, ${hit?.name ?? null}::text, ${hit?.releaseGroupMbid ?? null}::uuid)`;
    });
    await db.execute(sql`
      INSERT INTO releases (mbid, name, release_group_mbid)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (mbid) DO UPDATE
        SET name = COALESCE(EXCLUDED.name, releases.name),
            release_group_mbid = COALESCE(EXCLUDED.release_group_mbid, releases.release_group_mbid)
    `);
    if ((i / BATCH) % 10 === 0) {
      console.log(`[rel] ${Math.min(i + BATCH, ids.length)}/${ids.length} processed, ${resolved} resolved`);
    }
    await sleep(PACE_MS);
  }
  console.log(`[rel] done: ${resolved}/${ids.length} resolved to a release group`);
}

async function backfillReleaseGroups() {
  // Union of RGs named directly on listens and RGs reachable via the
  // release → RG mapping (filled by backfillReleaseRGs above).
  const res = (await db.execute(sql`
    SELECT DISTINCT x.mbid::text AS mbid
    FROM (
      SELECT release_group_mbid AS mbid FROM listens WHERE release_group_mbid IS NOT NULL
      UNION
      SELECT rel.release_group_mbid
      FROM listens l JOIN releases rel ON rel.mbid = l.release_mbid
      WHERE rel.release_group_mbid IS NOT NULL
    ) x
    LEFT JOIN release_groups rg ON rg.mbid = x.mbid
    WHERE rg.mbid IS NULL
  `)) as unknown as Rows<{ mbid: string }>;
  const ids = res.rows.map((r) => r.mbid);
  console.log(`[rg] missing: ${ids.length}`);

  let dated = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await withAttempts(
      () => searchReleaseGroupDates(batch),
      `[rg] batch ${i / BATCH}`,
    );
    if (results === null) continue;
    const byId = new Map(results.map((r) => [r.mbid, r]));
    // Insert a row for every REQUESTED id (misses get null date) so re-runs
    // don't re-request release groups MB's index simply doesn't have.
    const values = batch.map((mbid) => {
      const hit = byId.get(mbid);
      if (hit?.firstReleaseDate) dated++;
      return sql`(${mbid}::uuid, ${hit?.name ?? null}::text, ${hit?.firstReleaseDate ?? null}::text, ${yearOf(hit?.firstReleaseDate ?? null)}::int)`;
    });
    await db.execute(sql`
      INSERT INTO release_groups (mbid, name, first_release_date, first_release_year)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (mbid) DO UPDATE
        SET name = COALESCE(EXCLUDED.name, release_groups.name),
            first_release_date = COALESCE(EXCLUDED.first_release_date, release_groups.first_release_date),
            first_release_year = COALESCE(EXCLUDED.first_release_year, release_groups.first_release_year)
    `);
    if ((i / BATCH) % 10 === 0) {
      console.log(`[rg] ${Math.min(i + BATCH, ids.length)}/${ids.length} processed, ${dated} dated`);
    }
    await sleep(PACE_MS);
  }
  console.log(`[rg] done: ${dated}/${ids.length} newly dated`);
}

async function backfillRecordingLengths() {
  const res = (await db.execute(sql`
    SELECT DISTINCT l.recording_mbid::text AS mbid
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.recording_mbid IS NOT NULL AND (r.mbid IS NULL OR r.length_ms IS NULL)
  `)) as unknown as Rows<{ mbid: string }>;
  const ids = res.rows.map((r) => r.mbid);
  console.log(`[rec] missing: ${ids.length}`);

  let withLength = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await withAttempts(
      () => searchRecordingLengths(batch),
      `[rec] batch ${i / BATCH}`,
    );
    if (results === null) continue;
    const byId = new Map(results.map((r) => [r.mbid, r]));
    const values = batch.map((mbid) => {
      const hit = byId.get(mbid);
      if (hit?.lengthMs != null) withLength++;
      return sql`(${mbid}::uuid, ${hit?.name ?? null}::text, ${hit?.lengthMs ?? null}::int)`;
    });
    await db.execute(sql`
      INSERT INTO recordings (mbid, name, length_ms)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (mbid) DO UPDATE
        SET name = COALESCE(EXCLUDED.name, recordings.name),
            length_ms = COALESCE(EXCLUDED.length_ms, recordings.length_ms)
    `);
    if ((i / BATCH) % 10 === 0) {
      console.log(`[rec] ${Math.min(i + BATCH, ids.length)}/${ids.length} processed, ${withLength} with length`);
    }
    await sleep(PACE_MS);
  }
  console.log(`[rec] done: ${withLength}/${ids.length} newly lengthed`);
}

async function report() {
  const rg = (await db.execute(sql`
    SELECT
      (SELECT COUNT(DISTINCT release_group_mbid)::int FROM listens WHERE release_group_mbid IS NOT NULL) AS total,
      (SELECT COUNT(*)::int FROM release_groups WHERE first_release_date IS NOT NULL) AS dated
  `)) as unknown as Rows<{ total: number; dated: number }>;
  const rec = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT l.recording_mbid)::int AS total,
      COUNT(DISTINCT l.recording_mbid) FILTER (WHERE r.length_ms IS NOT NULL)::int AS with_length
    FROM listens l LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.recording_mbid IS NOT NULL
  `)) as unknown as Rows<{ total: number; with_length: number }>;
  console.log(`[coverage] release groups dated: ${rg.rows[0].dated}/${rg.rows[0].total}`);
  console.log(`[coverage] recordings with length: ${rec.rows[0].with_length}/${rec.rows[0].total}`);
}

async function main() {
  await backfillReleaseRGs();
  await backfillReleaseGroups();
  await backfillRecordingLengths();
  // New durations change effective_ms; clearing the aggregate stamp lets the
  // stats page's self-heal rebuild each user's aggregates on next visit.
  await db.execute(sql`UPDATE sync_state SET last_aggregated_at = NULL`);
  console.log("[done] aggregate stamps cleared — dashboards rebuild on next visit");
  await report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
