import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { schema, execute } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";

/**
 * Exact stored-listen count, for the sync progress bar.
 *
 * This is the most expensive query on the poll path by some margin: a parallel
 * index-only scan over half a million rows, ~40ms and ~900 buffers across three
 * processes every time it runs. The poll used to fire it every second for the
 * length of a chain, and Neon bills that time.
 *
 * Time-cached rather than tag-cached on purpose. The number has to keep moving
 * while a sync inserts rows, so it can't sit behind a revalidateTag that only
 * fires when the chain ends — but a progress bar does not need it fresher than
 * this. Combined with the poll's own backoff, the count now runs a handful of
 * times a minute instead of sixty.
 */
const COUNT_TTL_SECONDS = 10;

export function countListens(username: string): Promise<number> {
  return unstable_cache(
    async () => {
      const res = await withRetry(() =>
        execute<{ c: number }>(sql`
          SELECT COUNT(*)::int AS c FROM ${schema.listens} WHERE user_name = ${username}
        `),
      );
      return res.rows[0]?.c ?? 0;
    },
    ["listenCount", username],
    { revalidate: COUNT_TTL_SECONDS },
  )();
}
