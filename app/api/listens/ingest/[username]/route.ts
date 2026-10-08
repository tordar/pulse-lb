import { NextRequest, NextResponse, after } from "next/server";
import { revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getUserByLbUsername, isAllowedToSync } from "@/lib/auth/users";
import { ingestUser } from "@/lib/sync/ingest";
import { healStaleAggregates } from "@/lib/sync/healAggregates";

export const maxDuration = 60;

// Any viewer may nudge this: the server only ever pulls the owner's public
// listens from ListenBrainz, never data from the request. The paywall is the
// owner's subscription, not the caller's.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const owner = await getUserByLbUsername(username);
  if (!isAllowedToSync(owner)) {
    return NextResponse.json({ error: "subscription_required" }, { status: 402 });
  }
  const result = await ingestUser(username);
  if ((result.mode === "live" && result.added > 0) || result.mode === "import") {
    revalidateTag(`user:${username}`, "default");
  }
  if (result.mode === "live") {
    // Stale from a crash before this design (or a failed import rebuild).
    after(async () => {
      const s = await db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) });
      const stale = s?.lastListenedAt != null &&
        (s.lastAggregatedAt == null || s.lastAggregatedAt < s.lastListenedAt);
      if (stale) await healStaleAggregates(username, s.lastAggregatedAt ?? null);
    });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
