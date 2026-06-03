import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { syncUser } from "@/lib/sync/syncUser";

export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const jobId = randomUUID();

  // Vercel's function timeout can kill a sync mid-flight, leaving rows stuck
  // in "running"/"queued" forever. Sweep those to "interrupted" before
  // starting a new job so the dashboard reflects reality.
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

  await withRetry(() =>
    db.insert(schema.syncJobs).values({ id: jobId, userName: username, status: "queued" }),
  );

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

  return NextResponse.json({ jobId });
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
