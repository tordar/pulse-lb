import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { syncUser } from "@/lib/sync/syncUser";

export const maxDuration = 300;

// Soft cap for one Vercel function invocation: leave headroom under the hard
// timeout so we have time to write the final sync_jobs row + self-trigger
// the next pass.
const SOFT_BUDGET_MS = 50_000;

// Hard cap on the self-continuation chain. Bounds runaway invocations if
// something keeps inserting rows (shouldn't happen with "fill in what's
// missing", but a safety net).
const MAX_CHAIN_DEPTH = 50;

function baseUrl(req: NextRequest): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return req.nextUrl.origin;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const jobId = randomUUID();
  const chainDepth = parseInt(req.headers.get("x-pulse-chain") ?? "0", 10) || 0;
  const isSelfTriggered = chainDepth > 0;

  // Sweep stale "running"/"queued" rows for THIS user — only when the click
  // came from a real user, not from our own self-continuation (those legitimate
  // running jobs are us). Without this, the chain would mark its own previous
  // job as "interrupted" on every hop.
  if (!isSelfTriggered) {
    await withRetry(() =>
      db
        .update(schema.syncJobs)
        .set({ status: "error", finishedAt: new Date(), errorMessage: "interrupted by next sync click" })
        .where(
          and(
            eq(schema.syncJobs.userName, username),
            inArray(schema.syncJobs.status, ["queued", "running"]),
          ),
        ),
    );
  }

  await withRetry(() =>
    db.insert(schema.syncJobs).values({ id: jobId, userName: username, status: "queued" }),
  );

  const startedAt = Date.now();
  const origin = baseUrl(req);

  after(async () => {
    try {
      await db
        .update(schema.syncJobs)
        .set({ status: "running" })
        .where(eq(schema.syncJobs.id, jobId));

      const result = await syncUser(username, {
        onProgress: async (added, pages) => {
          await db
            .update(schema.syncJobs)
            .set({ added, pagesFetched: pages })
            .where(eq(schema.syncJobs.id, jobId));
        },
      });

      await db
        .update(schema.syncJobs)
        .set({
          status: "done",
          finishedAt: new Date(),
          added: result.added,
          pagesFetched: result.pages,
        })
        .where(eq(schema.syncJobs.id, jobId));

      // Self-continuation: if this pass added anything, there's probably more
      // to fetch. Spawn a new POST to ourselves. The new function gets a
      // fresh 60s/300s budget; chain ends when a pass adds 0.
      const elapsed = Date.now() - startedAt;
      const shouldContinue =
        result.added > 0 && chainDepth < MAX_CHAIN_DEPTH;
      if (shouldContinue) {
        // Fire-and-forget — we don't await the response, just trigger it.
        fetch(`${origin}/api/sync/${encodeURIComponent(username)}`, {
          method: "POST",
          headers: {
            "x-pulse-chain": String(chainDepth + 1),
            "content-type": "application/json",
          },
          // node-fetch / undici will close on its own after a brief delay
          signal: AbortSignal.timeout(5_000),
        }).catch(() => {});
      }

      void elapsed;
    } catch (e) {
      await db
        .update(schema.syncJobs)
        .set({
          status: "error",
          finishedAt: new Date(),
          errorMessage: e instanceof Error ? e.message : String(e),
        })
        .where(eq(schema.syncJobs.id, jobId));
    }
  });

  return NextResponse.json({ jobId, chainDepth });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const latest = await withRetry(() =>
    db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.userName, username),
      orderBy: desc(schema.syncJobs.startedAt),
    }),
  );
  if (!latest) return NextResponse.json({ status: "never" });
  return NextResponse.json(latest);
}
