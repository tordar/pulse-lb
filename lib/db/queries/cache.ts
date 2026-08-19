import { unstable_cache } from "next/cache";

/**
 * Cache a per-user read behind the `user:<name>` tag.
 *
 * Neon bills compute *time*, not queries, and only scales its endpoint to zero
 * after ~5 idle minutes. One crawler walking one uncached detail page every few
 * minutes is therefore enough to hold the database awake around the clock and
 * spend the whole monthly quota on nobody — which is exactly how we started
 * serving 53000 ("exceeded the compute time quota") mid-page-render.
 *
 * So everything a logged-out visitor can reach goes through here: on a hit the
 * request never opens a connection, and the endpoint is free to suspend.
 *
 * `revalidate: false` — entries live until something calls revalidateTag for
 * this user. Aggregates only move when a sync lands (app/api/sync) or the user
 * changes a display setting (app/account/actions.ts), and both do.
 */
export function userCached<T>(
  username: string,
  keys: (string | number | undefined | null)[],
  fn: () => Promise<T>,
): Promise<T> {
  return unstable_cache(fn, keys.map((k) => String(k ?? "")), {
    tags: [`user:${username}`],
    revalidate: false,
  })();
}
