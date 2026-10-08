import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { getUserByLbUsername, isAllowedToSync } from "@/lib/auth/users";
import { ingestUser } from "@/lib/sync/ingest";

export const maxDuration = 60;

// Any viewer may nudge this: the server only ever pulls the owner's public
// listens from ListenBrainz, never data from the request. The paywall is the
// owner's subscription, not the caller's.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const owner = await getUserByLbUsername(username);
  // Only pages that exist get ingested. Without this, self-host (where
  // isAllowedToSync(null) is true) would import any LB username a visitor names.
  if (!owner) return NextResponse.json({ error: "unknown_user" }, { status: 404 });
  if (!isAllowedToSync(owner)) {
    return NextResponse.json({ error: "subscription_required" }, { status: 402 });
  }
  const result = await ingestUser(username);
  if ((result.mode === "live" && result.added > 0) || result.mode === "import") {
    revalidateTag(`user:${username}`, "default");
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
