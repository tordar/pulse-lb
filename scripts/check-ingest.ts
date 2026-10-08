import "dotenv/config";
import assert from "node:assert/strict";
import { sqlClient as sql } from "@/lib/db/client";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";
import { ingestUser } from "@/lib/sync/ingest";
import type { ListenRow } from "@/lib/sync/syncUser";
import { snapshot, diff } from "./agg-snapshot";

if (!/localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local DB only");
const USER = process.argv[2] ?? "tordar";

// listened_at stays the string postgres-js hands back (microseconds intact).
const toRow = (r: Record<string, any>): ListenRow => ({
  userName: r.user_name, listenedAt: r.listened_at, trackName: r.track_name, artistName: r.artist_name,
  releaseName: r.release_name, recordingMbid: r.recording_mbid, releaseMbid: r.release_mbid,
  releaseGroupMbid: r.release_group_mbid, artistMbids: r.artist_mbids ?? [], caaId: r.caa_id,
  caaReleaseMbid: r.caa_release_mbid, durationMs: r.duration_ms, source: r.source,
});

async function main() {
  // Withhold the newest 30, plus a same-second twin (Review Focus 3).
  const withheld = await sql`SELECT * FROM listens WHERE user_name = ${USER} ORDER BY listened_at DESC LIMIT 30`;
  const twin = { ...withheld[0], track_name: withheld[0].track_name + " (twin)" };
  const rows = [...withheld, twin].map(toRow);
  // postgres-js can't bind an array of tuples for IN (...), so match via unnest.
  await sql`DELETE FROM listens l USING unnest(${withheld.map((r) => r.listened_at)}::text[]::timestamptz[],
      ${withheld.map((r) => r.track_name)}::text[]) AS w(ts, track)
    WHERE l.user_name = ${USER} AND l.listened_at = w.ts AND l.track_name = w.track`;
  await rebuildAll(USER);
  await sql`UPDATE sync_state SET last_synced_at = NULL, backfill_completed_at = now() WHERE user_name = ${USER}`;

  const fetchNewer = async () => ({ rows, more: false });
  const [a, b] = await Promise.all([ingestUser(USER, { fetchNewer }), ingestUser(USER, { fetchNewer })]);
  const modes = [a.mode, b.mode].sort();
  assert.deepEqual(modes, ["busy", "live"], `concurrent: ${modes}`);
  const live = (a.mode === "live" ? a : b) as { added: number };
  assert.equal(live.added, 31, "all 31 rows inserted, twin included");

  assert.equal((await ingestUser(USER, { fetchNewer })).mode, "skipped", "throttled within 10s");

  // Import mode: a slice already holding the import lock turns others away.
  await sql`UPDATE sync_state SET backfill_completed_at = NULL WHERE user_name = ${USER}`;
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${"import:" + USER}))`;
      assert.equal((await ingestUser(USER, { fetchNewer })).mode, "busy", "import lock held");
    });
  } finally {
    await sql`UPDATE sync_state SET backfill_completed_at = now() WHERE user_name = ${USER}`;
  }

  const inc = await snapshot(sql, USER);
  await rebuildAll(USER);
  assert.deepEqual(diff(inc, await snapshot(sql, USER)), []);
  await sql`DELETE FROM listens WHERE user_name = ${USER} AND track_name = ${twin.track_name}`;
  await rebuildAll(USER);
  console.log("PASS check-ingest");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
