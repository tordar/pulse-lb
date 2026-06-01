import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { getListens, LBError, type Listen } from "@/lib/listenbrainz/client";

const PAGE_SIZES = [1000, 500, 200, 100];
const MAX_RETRIES_PER_SIZE = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SyncResult = { added: number; pages: number; mode: "backfill" | "incremental" };

export async function syncUser(
  username: string,
  opts: { token?: string; onProgress?: (added: number, pages: number) => void } = {},
): Promise<SyncResult> {
  const state = await withRetry(() =>
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
  );

  const mode: "backfill" | "incremental" = state?.lastListenedAt ? "incremental" : "backfill";
  let cursor: number | null = state?.lastListenedAt
    ? Math.floor(state.lastListenedAt.getTime() / 1000)
    : null;

  let added = 0;
  let pages = 0;
  let newestSeen = cursor ?? 0;

  while (true) {
    const listens = await fetchPageWithFallback({ username, mode, cursor, token: opts.token });
    if (listens.length === 0) break;

    const rows = listens.map((l) => listenToRow(username, l));
    const inserted = await withRetry(() =>
      db
        .insert(schema.listens)
        .values(rows)
        .onConflictDoNothing()
        .returning({ ts: schema.listens.listenedAt }),
    );

    added += inserted.length;
    pages++;

    newestSeen = Math.max(newestSeen, listens[0].listened_at);

    if (mode === "incremental") {
      cursor = listens[0].listened_at;
    } else {
      cursor = listens.at(-1)!.listened_at - 1;
    }

    opts.onProgress?.(added, pages);

    if (listens.length < 1000) break;
  }

  const newLastListenedAt = newestSeen ? new Date(newestSeen * 1000) : state?.lastListenedAt ?? null;
  const newTotal = (state?.totalListens ?? 0) + added;
  const now = new Date();

  await withRetry(() =>
    db
      .insert(schema.syncState)
      .values({
        userName: username,
        lastSyncedAt: now,
        lastListenedAt: newLastListenedAt,
        totalListens: newTotal,
      })
      .onConflictDoUpdate({
        target: schema.syncState.userName,
        set: { lastSyncedAt: now, lastListenedAt: newLastListenedAt, totalListens: newTotal },
      }),
  );

  return { added, pages, mode };
}

async function fetchPageWithFallback(opts: {
  username: string;
  mode: "backfill" | "incremental";
  cursor: number | null;
  token?: string;
}): Promise<Listen[]> {
  let lastErr: unknown;
  for (const size of PAGE_SIZES) {
    for (let attempt = 1; attempt <= MAX_RETRIES_PER_SIZE; attempt++) {
      try {
        return await getListens({
          username: opts.username,
          count: size,
          minTs: opts.mode === "incremental" ? opts.cursor ?? undefined : undefined,
          maxTs: opts.mode === "backfill" ? opts.cursor ?? undefined : undefined,
          token: opts.token,
        });
      } catch (e) {
        lastErr = e;
        if (e instanceof LBError && e.isRateLimit && e.rateLimitResetIn) {
          await sleep((e.rateLimitResetIn + 1) * 1000);
          continue;
        }
        await sleep(Math.min(30_000, 2 ** attempt * 1000));
      }
    }
  }
  throw lastErr;
}

function listenToRow(username: string, l: Listen) {
  const a = l.track_metadata.additional_info ?? {};
  const m = l.track_metadata.mbid_mapping ?? {};
  return {
    userName: username,
    listenedAt: new Date(l.listened_at * 1000),
    trackName: l.track_metadata.track_name,
    artistName: l.track_metadata.artist_name,
    releaseName: l.track_metadata.release_name ?? null,
    recordingMbid: m.recording_mbid ?? a.recording_mbid ?? null,
    releaseMbid: m.release_mbid ?? a.release_mbid ?? null,
    releaseGroupMbid: m.release_group_mbid ?? a.release_group_mbid ?? null,
    artistMbids: m.artist_mbids ?? a.artist_mbids ?? [],
    caaId: m.caa_id ?? null,
    caaReleaseMbid: m.caa_release_mbid ?? null,
    durationMs: a.duration_ms ?? null,
  };
}
