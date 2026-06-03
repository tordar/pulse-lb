import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { revalidateTag } from "next/cache";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { syncUser } from "@/lib/sync/syncUser";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";
import { getSession } from "@/lib/auth/session";
import { getUserByMbId, isAllowedToSync } from "@/lib/auth/users";

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

  const session = await getSession();
  const isSelfTriggeredHeader = (req.headers.get("x-pulse-chain") ?? "0") !== "0";

  // The self-continuation chain re-POSTs to the same route from inside Vercel's
  // after() block. Those re-entrant calls don't carry a session cookie; we
  // identify them by the chain header and let them through. User-initiated
  // POSTs (chain header missing or "0") MUST be authenticated and authorized.
  if (!isSelfTriggeredHeader) {
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (session.lbUsername !== username) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const user = await getUserByMbId(session.mbAccountId);
    if (!isAllowedToSync(user)) {
      return NextResponse.json({ error: "subscription_required" }, { status: 402 });
    }
  }

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
        // Budget syncUser at 40s — that leaves ~20s of headroom under Vercel's
        // 60s Hobby cap for: end-of-sync sync_state UPSERT, sync_jobs "done"
        // write, the self-trigger fetch, and any retry budget.
        maxDurationMs: 40_000,
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

      // End-of-chain rebuild: if no new data was found this hop AND the sync
      // is complete (both passes reached origin), and our aggregates are
      // behind the latest listen, rebuild aggregates atomically. Stamp
      // last_aggregated_at so a subsequent no-op resync skips this work.
      const isChainTerminal = result.completed && result.added === 0;
      if (isChainTerminal) {
        const state = await withRetry(() =>
          db.query.syncState.findFirst({
            where: eq(schema.syncState.userName, username),
          }),
        );
        const stale =
          !state?.lastAggregatedAt ||
          (state.lastListenedAt != null &&
            state.lastAggregatedAt < state.lastListenedAt);
        if (stale) {
          await rebuildAll(username);
          await withRetry(() =>
            db
              .update(schema.syncState)
              .set({ lastAggregatedAt: new Date() })
              .where(eq(schema.syncState.userName, username)),
          );
          // Drop the per-user query cache so stats/list pages pick up new
          // aggregates on next render instead of serving the previous snapshot.
          revalidateTag(`user:${username}`, "default");
        }
      }

      // Self-continuation: if this pass timed out (more work remains) OR if
      // it completed naturally but added something, keep going. Chain ends
      // only when a pass completes with added=0 (fully synced).
      const elapsed = Date.now() - startedAt;
      void elapsed;
      const moreWorkRemaining = !result.completed || result.added > 0;
      const shouldContinue =
        moreWorkRemaining && chainDepth < MAX_CHAIN_DEPTH;
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

type RecentInsert = {
  listened_at: string;
  track_name: string;
  artist_name: string;
  release_name: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const [latest, state, countRes] = await Promise.all([
    withRetry(() =>
      db.query.syncJobs.findFirst({
        where: eq(schema.syncJobs.userName, username),
        orderBy: desc(schema.syncJobs.startedAt),
      }),
    ),
    withRetry(() =>
      db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
    ),
    // Source of truth for dbCount: actual row count. state.totalListens is
    // only written at start/end of sync, so it goes stale during a chain.
    withRetry(() =>
      db.execute<{ c: number }>(sql`
        SELECT COUNT(*)::int AS c FROM ${schema.listens} WHERE user_name = ${username}
      `),
    ),
  ]);
  const dbCount = (countRes as unknown as { rows: { c: number }[] }).rows[0]?.c ?? 0;

  // Only stream rows inserted DURING THE CURRENT JOB — otherwise re-clicking
  // Sync after a backfill replays the tail of historical 2009 inserts. When
  // there's no active job (done/error/never), return an empty stream.
  let recent: RecentInsert[] = [];
  if (latest && (latest.status === "queued" || latest.status === "running")) {
    const recentRes = await withRetry(() =>
      db.execute<RecentInsert>(sql`
        SELECT
          listened_at::text AS listened_at,
          track_name,
          artist_name,
          release_name,
          caa_id,
          caa_release_mbid::text AS caa_release_mbid
        FROM ${schema.listens}
        WHERE user_name = ${username}
          AND inserted_at IS NOT NULL
          AND inserted_at >= ${latest.startedAt}
        ORDER BY inserted_at DESC, listened_at DESC
        LIMIT 40
      `),
    );
    recent = (recentRes as unknown as { rows: RecentInsert[] }).rows ?? [];
  }

  if (!latest) {
    return NextResponse.json({
      status: "never",
      target: state?.targetListens ?? null,
      dbCount,
      recent,
    });
  }

  // Detect zombie jobs: if a "running" or "queued" row hasn't moved in 90s,
  // Vercel killed the function. Report it as effectively dead so the UI can
  // stop polling and surface a retry option. We don't write to the DB here —
  // the next POST will sweep it.
  const ageMs = Date.now() - latest.startedAt.getTime();
  const ZOMBIE_THRESHOLD_MS = 90_000;
  const isZombie =
    (latest.status === "running" || latest.status === "queued") &&
    ageMs > ZOMBIE_THRESHOLD_MS;

  return NextResponse.json({
    ...latest,
    status: isZombie ? "error" : latest.status,
    errorMessage: isZombie
      ? "function timed out — click Sync again to continue"
      : latest.errorMessage,
    target: state?.targetListens ?? null,
    dbCount,
    recent,
  });
}
