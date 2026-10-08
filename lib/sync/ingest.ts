import { eq } from "drizzle-orm";
import { db, schema, sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";
import { tryLockUser } from "@/lib/db/aggregates/lock";
import { planIncremental, applyIncremental, type NewListenKey } from "@/lib/db/aggregates/incremental";
import { syncUser, fetchNewerListens } from "@/lib/sync/syncUser";
import { countListens } from "@/lib/db/queries/listenCount";

// Replaces the Sync button. Browsers call this when they see listens on LB
// that the page doesn't show yet. Two modes:
//  - import: the user's history hasn't been fully pulled yet. Same work the
//    old sync chain did, one 40s slice per call; the client loops on `more`.
//  - live: fetch what's newer than our newest listen, insert it and update
//    only the affected aggregate rows, all in one transaction.
const THROTTLE_MS = 10_000;
const FETCH_BUDGET_MS = 20_000;
const MAX_ROWS = 5_000;

export type IngestResult =
  | { mode: "live"; added: number; more: boolean }
  | { mode: "import"; added: number; more: boolean; imported: number; target: number | null }
  | { mode: "busy" }
  | { mode: "skipped" };

// sqlClient shares drizzle's pass-through date serializers, so Date params
// fail. Timestamps go in as ISO strings.
const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());

export async function ingestUser(
  username: string,
  deps: { fetchNewer?: typeof fetchNewerListens; now?: () => number } = {},
): Promise<IngestResult> {
  const now = deps.now ?? Date.now;
  const fetchNewer = deps.fetchNewer ?? fetchNewerListens;
  const state = await withRetry(() =>
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
  );

  if (!state?.backfillCompletedAt) return importSlice(username);

  if (state.lastSyncedAt && now() - new Date(state.lastSyncedAt).getTime() < THROTTLE_MS) {
    return { mode: "skipped" };
  }

  const since = state.lastListenedAt ? Math.floor(new Date(state.lastListenedAt).getTime() / 1000) : 0;
  const { rows, more } = await fetchNewer(username, since, {
    deadline: now() + FETCH_BUDGET_MS,
    maxRows: MAX_ROWS,
  });

  const outcome = await withRetry(() =>
    sqlClient.begin(async (tx) => {
      if (!(await tryLockUser(tx, username))) return { kind: "busy" as const, added: 0 };
      // Re-check under the lock: a concurrent caller may have just finished.
      const [s] = await tx`SELECT last_synced_at FROM sync_state WHERE user_name = ${username}`;
      if (s?.last_synced_at && now() - new Date(s.last_synced_at).getTime() < THROTTLE_MS) {
        return { kind: "skipped" as const, added: 0 };
      }
      let added = 0;
      if (rows.length > 0) {
        const keys: NewListenKey[] = rows.map((r) => ({
          listenedAt: iso(r.listenedAt), trackName: r.trackName, artistName: r.artistName,
          releaseMbid: r.releaseMbid ?? null, releaseGroupMbid: r.releaseGroupMbid ?? null,
        }));
        const plan = await planIncremental(tx, username, keys);
        const values = rows.map((r) => ({
          user_name: r.userName, listened_at: iso(r.listenedAt), track_name: r.trackName,
          artist_name: r.artistName, release_name: r.releaseName, recording_mbid: r.recordingMbid,
          release_mbid: r.releaseMbid, release_group_mbid: r.releaseGroupMbid,
          artist_mbids: r.artistMbids, caa_id: r.caaId, caa_release_mbid: r.caaReleaseMbid,
          duration_ms: r.durationMs, source: r.source,
        }));
        const inserted = await tx`
          INSERT INTO listens ${tx(values)} ON CONFLICT DO NOTHING
          RETURNING listened_at, track_name, artist_name, release_mbid, release_group_mbid`;
        added = inserted.length;
        // RETURNING values pass through unchanged: converting to Date would
        // drop microseconds and miss the rows applyIncremental re-reads.
        await applyIncremental(tx, username, plan, inserted.map((r) => ({
          listenedAt: r.listened_at, trackName: r.track_name, artistName: r.artist_name,
          releaseMbid: r.release_mbid, releaseGroupMbid: r.release_group_mbid,
        })));
      }
      await tx`
        UPDATE sync_state SET
          last_synced_at = now(),
          last_listened_at = GREATEST(last_listened_at, (SELECT MAX(listened_at) FROM listens WHERE user_name = ${username})),
          total_listens = total_listens + ${added},
          last_aggregated_at = now()
        WHERE user_name = ${username}`;
      return { kind: "done" as const, added };
    }),
  );

  if (outcome.kind !== "done") return { mode: outcome.kind };
  return { mode: "live", added: outcome.added, more };
}

async function importSlice(username: string): Promise<IngestResult> {
  const result = await syncUser(username, { maxDurationMs: 40_000 });
  if (result.completed) {
    await rebuildAll(username);
    await withRetry(() =>
      db.update(schema.syncState)
        .set({ backfillCompletedAt: new Date(), lastAggregatedAt: new Date() })
        .where(eq(schema.syncState.userName, username)),
    );
  }
  const state = await withRetry(() =>
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
  );
  return {
    mode: "import",
    added: result.added,
    more: !result.completed,
    imported: await countListens(username),
    target: state?.targetListens ?? null,
  };
}
