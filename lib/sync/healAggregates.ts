import { revalidateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { schema, execute } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";

/**
 * Self-heal stale aggregates: when listens are newer than the last rebuild
 * (e.g. a sync chain died before its terminal rebuild), rebuild them.
 * Claim-first stamp: the UPDATE only returns a row for whoever moves the stamp
 * forward, so concurrent callers don't all kick off their own rebuild.
 *
 * This used to run from the stats page render; it now runs from the owner's
 * sync-status probe so pages can be served from cache.
 */
export async function healStaleAggregates(username: string, previous: Date | null): Promise<void> {
  const claimed = await withRetry(() =>
    execute<{ user_name: string }>(sql`
      UPDATE ${schema.syncState}
      SET last_aggregated_at = NOW()
      WHERE user_name = ${username}
        AND last_listened_at IS NOT NULL
        AND (last_aggregated_at IS NULL OR last_aggregated_at < last_listened_at)
      RETURNING user_name
    `),
  );
  if ((claimed as unknown as { rows: unknown[] }).rows.length === 0) return;
  try {
    await rebuildAll(username);
    revalidateTag(`user:${username}`, "default");
  } catch (e) {
    // Put the old stamp back — otherwise a failed rebuild leaves the claim
    // committed and staleness permanently undetectable (the sync route's
    // terminal rebuild checks the same condition).
    await withRetry(() =>
      execute(sql`
        UPDATE ${schema.syncState}
        SET last_aggregated_at = ${previous}
        WHERE user_name = ${username}
      `),
    );
    throw e;
  }
}
