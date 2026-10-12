// Pull a time window of listens from ListenBrainz into our table. Live sync
// only fetches listens newer than the newest one we hold, so anything that
// lands in LB *behind* that cursor — a resubmitted scrobble, an import of
// plays a player failed to send — never arrives on its own.
// Inserts are ON CONFLICT DO NOTHING, so overlapping windows are harmless.
// Run: npx tsx scripts/fill-gap.ts <username> <from ISO> [to ISO]
import "dotenv/config";
import { db, schema, sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { getListens } from "@/lib/listenbrainz/client";
import { listenToRow } from "@/lib/sync/syncUser";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";

// LB answers the odd 500 on otherwise fine requests; a retry gets through.
async function withAttempts<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === 8) throw e;
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 10_000)));
    }
  }
}

async function main() {
  const [username, from, to] = process.argv.slice(2);
  if (!username || !from) throw new Error("usage: fill-gap.ts <username> <from ISO> [to ISO]");
  const floor = Math.floor(new Date(from).getTime() / 1000);
  let maxTs = Math.floor((to ? new Date(to).getTime() : Date.now()) / 1000) + 1;

  let seen = 0;
  let added = 0;
  while (maxTs > floor) {
    const page = await withAttempts(() => getListens({ username, count: 1000, maxTs }));
    const inWindow = page.filter((l) => l.listened_at >= floor);
    if (inWindow.length > 0) {
      seen += inWindow.length;
      const inserted = await withRetry(() =>
        db
          .insert(schema.listens)
          .values(inWindow.map((l) => listenToRow(username, l)))
          .onConflictDoNothing()
          .returning({ ts: schema.listens.listenedAt }),
      );
      added += inserted.length;
    }
    // Only an empty page or crossing the floor ends it: LB returns short
    // pages mid-history, so a page under 1000 doesn't mean we're done.
    if (page.length === 0 || inWindow.length < page.length) break;
    maxTs = page[page.length - 1].listened_at;
  }
  console.log(`[${username}] ${seen} listens in window, ${added} new`);
  if (added > 0) {
    await rebuildAll(username);
    console.log(`[${username}] aggregates rebuilt`);
  }
  await sqlClient.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
