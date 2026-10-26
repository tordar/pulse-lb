import { eq, sql } from "drizzle-orm";
import { db, schema, execute, sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { getListens, getListenCount, normalizeSource, LBError, type Listen } from "@/lib/listenbrainz/client";
import { fetchCaaCover, type CoverArtRef } from "@/lib/listenbrainz/coverArt";
import { searchReleaseRGs } from "@/lib/musicbrainz/client";

const PAGE_SIZES = [1000, 500, 200, 100];
const MAX_RETRIES_PER_SIZE = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type SyncResult = {
  added: number;
  pages: number;
  mode: "backfill" | "incremental";
  /** False when we bailed out because the time budget ran out; more work may remain. */
  completed: boolean;
};

/**
 * Sync semantics, one rule:
 *   "Fill in whatever listens LB has that aren't in our DB yet."
 *
 * Every click does the same thing:
 *   1. Ask LB for anything newer than MAX(listened_at) in the DB
 *   2. Ask LB for anything older than MIN(listened_at) in the DB
 *
 * Both passes walk LB pagination until they hit an empty page. For a fully
 * synced user, both passes are one cheap probe each (~1 second). For a
 * user mid-backfill, the backward pass continues from where the previous
 * (possibly interrupted) sync stopped — no re-paging of data we already
 * have, and no need for any "is the backfill complete" flag.
 */
export async function syncUser(
  username: string,
  opts: {
    token?: string;
    onProgress?: (added: number, pages: number) => void;
    /** Hard time budget for this invocation. Default 40s leaves headroom under
     *  Vercel Hobby's 60s function timeout for the route's post-sync writes
     *  and self-trigger fetch. */
    maxDurationMs?: number;
  } = {},
): Promise<SyncResult> {
  const deadline = Date.now() + (opts.maxDurationMs ?? 40_000);
  const outOfTime = () => Date.now() >= deadline;
  const state = await withRetry(() =>
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
  );

  // Source of truth for resume cursors: the listens table itself.
  const boundsRes = await withRetry(() =>
    execute<{ oldest: number | null; newest: number | null }>(sql`
      SELECT
        EXTRACT(EPOCH FROM MIN(listened_at))::bigint AS oldest,
        EXTRACT(EPOCH FROM MAX(listened_at))::bigint AS newest
      FROM ${schema.listens} WHERE user_name = ${username}
    `),
  );
  const bounds = (boundsRes as unknown as { rows: { oldest: number | null; newest: number | null }[] })
    .rows[0] ?? { oldest: null, newest: null };
  const hasData = bounds.newest != null;

  // Fetch LB's current listen-count for this user so the UI can show a
  // progress percentage. Best-effort: if LB is unreachable, leave the
  // existing value in sync_state alone.
  const lbTotal = await getListenCount(username).catch(() => null);

  // Write sync_state NOW (start of sync) so the UI immediately sees
  // targetListens + lastSyncedAt + a current totalListens, even if Vercel
  // kills the function before we reach the end-of-sync write. totalListens
  // is best-effort here: use COUNT(*) from listens, the source of truth.
  const dbCountRes = await withRetry(() =>
    execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c FROM ${schema.listens} WHERE user_name = ${username}
    `),
  );
  const currentDbCount = (dbCountRes as unknown as { rows: { c: number }[] }).rows[0]?.c ?? 0;
  const syncStartedAt = new Date();
  await withRetry(() =>
    db
      .insert(schema.syncState)
      .values({
        userName: username,
        lastSyncedAt: syncStartedAt,
        lastListenedAt: state?.lastListenedAt ?? null,
        totalListens: currentDbCount,
        targetListens: lbTotal ?? state?.targetListens ?? null,
      })
      .onConflictDoUpdate({
        target: schema.syncState.userName,
        set: {
          lastSyncedAt: syncStartedAt,
          totalListens: currentDbCount,
          ...(lbTotal != null ? { targetListens: lbTotal } : {}),
        },
      }),
  );

  let totalAdded = 0;
  let totalPages = 0;
  let newestSeen = bounds.newest ?? 0;
  const onInserted = (n: number, newestInPage: number) => {
    totalAdded += n;
    totalPages++;
    if (newestInPage > newestSeen) newestSeen = newestInPage;
    opts.onProgress?.(totalAdded, totalPages);
  };

  let fwd = { reachedOrigin: true, firstNewest: 0, timedOut: false };
  let back = { reachedOrigin: true, firstNewest: 0, timedOut: false };

  // Forward pass: pick up anything newer than what we have. Skipped only
  // when the table is completely empty (nothing to start from).
  if (hasData) {
    fwd = await paginate({
      username,
      mode: "incremental",
      cursor: bounds.newest!,
      token: opts.token,
      outOfTime,
      onInserted,
    });
  }

  // Backward pass: continue from one second before our oldest listen
  // (or from "now" if the table is empty). Stops as soon as LB returns
  // an empty/short page, OR when our time budget runs out — the chain
  // will spawn another invocation to keep going.
  if (!outOfTime()) {
    back = await paginate({
      username,
      mode: "backfill",
      cursor: hasData ? bounds.oldest! - 1 : null,
      token: opts.token,
      outOfTime,
      onInserted,
    });
  } else {
    back.timedOut = true;
  }
  if (back.firstNewest > newestSeen) newestSeen = back.firstNewest;

  const completed = !fwd.timedOut && !back.timedOut;

  const newLastListenedAt = newestSeen ? new Date(newestSeen * 1000) : state?.lastListenedAt ?? null;
  const newTotal = (state?.totalListens ?? 0) + totalAdded;
  const now = new Date();

  await withRetry(() =>
    db
      .insert(schema.syncState)
      .values({
        userName: username,
        lastSyncedAt: now,
        lastListenedAt: newLastListenedAt,
        totalListens: newTotal,
        targetListens: lbTotal ?? state?.targetListens ?? null,
      })
      .onConflictDoUpdate({
        target: schema.syncState.userName,
        set: {
          lastSyncedAt: now,
          lastListenedAt: newLastListenedAt,
          totalListens: newTotal,
          // Only overwrite when we successfully fetched; keep the previous
          // value if LB was unreachable this round.
          ...(lbTotal != null ? { targetListens: lbTotal } : {}),
        },
      }),
  );

  return {
    added: totalAdded,
    pages: totalPages,
    mode: hasData ? "incremental" : "backfill",
    completed,
  };
}

/**
 * Walk LB listens in one direction until the API gives us nothing more.
 * Inserts each page idempotently into the listens table.
 */
async function paginate(args: {
  username: string;
  mode: "backfill" | "incremental";
  cursor: number | null;
  token?: string;
  onInserted: (n: number, newestSeenInPage: number) => void;
  outOfTime: () => boolean;
}): Promise<{ reachedOrigin: boolean; firstNewest: number; timedOut: boolean }> {
  let { cursor } = args;
  let reachedOrigin = false;
  let firstNewest = 0;
  let timedOut = false;

  while (true) {
    if (args.outOfTime()) {
      timedOut = true;
      break;
    }
    const listens = await fetchPageWithFallback({
      username: args.username,
      mode: args.mode,
      cursor,
      token: args.token,
    });
    if (listens.length === 0) {
      reachedOrigin = true;
      break;
    }

    const rows = await listensToRows(args.username, listens);
    const inserted = await withRetry(() =>
      db
        .insert(schema.listens)
        .values(rows)
        .onConflictDoNothing()
        .returning({ ts: schema.listens.listenedAt }),
    );

    if (firstNewest === 0) firstNewest = listens[0].listened_at;
    args.onInserted(inserted.length, listens[0].listened_at);

    if (args.mode === "incremental") {
      cursor = listens[0].listened_at;
    } else {
      cursor = listens.at(-1)!.listened_at - 1;
    }

    if (listens.length < 1000) {
      reachedOrigin = true;
      break;
    }
  }

  return { reachedOrigin, firstNewest, timedOut };
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

export type ListenRow = ReturnType<typeof listenToRow>;

/**
 * Live ingest's fetch: every listen strictly newer than `sinceTs`, oldest page
 * last, without touching the database — the caller inserts and updates
 * aggregates in one transaction. `more` means the deadline or row cap cut it
 * short and the caller should come back.
 */
export async function fetchNewerListens(
  username: string,
  sinceTs: number,
  opts: { deadline: number; maxRows: number },
): Promise<{ rows: ListenRow[]; more: boolean }> {
  const rows: ListenRow[] = [];
  let cursor = sinceTs;
  while (true) {
    if (Date.now() >= opts.deadline || rows.length >= opts.maxRows) return { rows, more: true };
    const page = await fetchPageWithFallback({ username, mode: "incremental", cursor });
    if (page.length === 0) return { rows, more: false };
    rows.push(...(await listensToRows(username, page)));
    cursor = page[0].listened_at;
    if (page.length < 1000) return { rows, more: false };
  }
}

export function listenToRow(username: string, l: Listen) {
  const a = l.track_metadata.additional_info ?? {};
  const m = l.track_metadata.mbid_mapping ?? {};
  // The release the player scrobbled beats LB's mapper, which can pick any
  // release containing the recording (Into the Wild songs → a 2022 Earthling
  // Expansion). The mapper's cover only counts when it's for the same album;
  // otherwise listensToRows looks up the scrobbled release's own.
  const sameRelease = !a.release_mbid || a.release_mbid === m.release_mbid;
  const releaseGroupMbid = sameRelease
    ? (m.release_group_mbid ?? a.release_group_mbid ?? null)
    : (a.release_group_mbid ?? null);
  const coverFits = sameRelease || (!!releaseGroupMbid && releaseGroupMbid === m.release_group_mbid);
  return {
    userName: username,
    listenedAt: new Date(l.listened_at * 1000),
    trackName: l.track_metadata.track_name,
    artistName: l.track_metadata.artist_name,
    releaseName: l.track_metadata.release_name ?? null,
    recordingMbid: m.recording_mbid ?? a.recording_mbid ?? null,
    releaseMbid: a.release_mbid ?? m.release_mbid ?? null,
    releaseGroupMbid,
    artistMbids: m.artist_mbids ?? a.artist_mbids ?? [],
    caaId: coverFits ? (m.caa_id ?? null) : null,
    caaReleaseMbid: coverFits ? (m.caa_release_mbid ?? null) : null,
    durationMs: a.duration_ms ?? null,
    source: normalizeSource(a),
  };
}

type ResolveOpts = { fetchCover?: typeof fetchCaaCover; maxLookups?: number };

/** listenToRow plus the lookups it can't do inline: release groups, then covers. */
export async function listensToRows(username: string, listens: Listen[], opts: ResolveOpts = {}): Promise<ListenRow[]> {
  const rows = listens.map((l) => listenToRow(username, l));
  await fillReleaseGroups(rows, listens);
  const resolved = await resolveCovers(username, rows, opts);
  // No cover for the scrobbled release anywhere: the mapper's, even for
  // another album, beats an empty tile.
  return resolved.map((r, i) => {
    const m = listens[i].track_metadata.mbid_mapping;
    return r.caaId == null && m?.caa_id ? { ...r, caaId: m.caa_id, caaReleaseMbid: m.caa_release_mbid ?? null } : r;
  });
}

/**
 * Spotify scrobbles name a release but no release group. Find it (releases
 * table, then MusicBrainz) so albums still cluster. Another edition of the
 * mapper's album keeps the mapper's cover; a release MB can't place (merged
 * ids, mostly) falls back to the mapper entirely, as before.
 */
async function fillReleaseGroups(rows: ListenRow[], listens: Listen[]) {
  const need = [...new Set(rows.filter((r) => r.releaseMbid && !r.releaseGroupMbid).map((r) => r.releaseMbid!))];
  if (need.length === 0) return;

  // A cached row with a null group is a release MB couldn't place: don't ask again.
  const groups = new Map<string, string | null>();
  const cached = await withRetry(() => sqlClient<{ mbid: string; release_group_mbid: string | null }[]>`
    SELECT mbid, release_group_mbid FROM releases WHERE mbid = ANY(${need}::uuid[])`);
  for (const c of cached) groups.set(c.mbid, c.release_group_mbid);

  const unknown = need.filter((m) => !groups.has(m));
  for (let i = 0; i < unknown.length; i += 100) {
    if (i > 0) await sleep(1_100);
    const batch = unknown.slice(i, i + 100);
    const found = await searchReleaseRGs(batch).catch(() => null);
    if (!found) continue;
    const byId = new Map(found.map((f) => [f.mbid, f]));
    const values = batch.map((mbid) => ({
      mbid, name: byId.get(mbid)?.name ?? null, release_group_mbid: byId.get(mbid)?.releaseGroupMbid ?? null,
    }));
    for (const v of values) groups.set(v.mbid, v.release_group_mbid);
    await withRetry(() => sqlClient`
      INSERT INTO releases ${sqlClient(values)} ON CONFLICT (mbid) DO UPDATE
      SET release_group_mbid = COALESCE(releases.release_group_mbid, EXCLUDED.release_group_mbid),
          name = COALESCE(releases.name, EXCLUDED.name)`);
  }

  rows.forEach((r, i) => {
    if (r.releaseGroupMbid || !r.releaseMbid) return;
    const m = listens[i].track_metadata.mbid_mapping ?? {};
    const group = groups.get(r.releaseMbid) ?? null;
    if (group && group !== m.release_group_mbid) {
      r.releaseGroupMbid = group;
      return;
    }
    if (!group && m.release_mbid) r.releaseMbid = m.release_mbid;
    r.releaseGroupMbid = m.release_group_mbid ?? group;
    r.caaId = m.caa_id ?? null;
    r.caaReleaseMbid = m.caa_release_mbid ?? null;
  });
}

// Bounds the CAA round-trips one call can add; a release left without a cover
// keeps the song's older one until a later ingest or the backfill fills it.
const MAX_CAA_LOOKUPS = 25;

/**
 * Fill covers listenToRow dropped. A release we already hold a cover for
 * reuses it; anything else asks the Cover Art Archive.
 */
async function resolveCovers<R extends ListenRow>(
  username: string,
  rows: R[],
  { fetchCover = fetchCaaCover, maxLookups = MAX_CAA_LOOKUPS }: ResolveOpts = {},
): Promise<R[]> {
  const missing = new Map<string, string | null>();
  for (const r of rows) {
    if (r.caaId == null && r.releaseMbid) missing.set(r.releaseMbid, r.releaseGroupMbid);
  }
  if (missing.size === 0) return rows;

  const known = await withRetry(() => sqlClient<{ release_mbid: string; caa_id: string; caa_release_mbid: string }[]>`
    SELECT DISTINCT ON (release_mbid) release_mbid, caa_id, caa_release_mbid
    FROM listens
    WHERE user_name = ${username} AND release_mbid = ANY(${[...missing.keys()]}::uuid[]) AND caa_id IS NOT NULL
    ORDER BY release_mbid, listened_at DESC`);
  const covers = new Map<string, CoverArtRef>(
    known.map((k) => [k.release_mbid, { caaId: Number(k.caa_id), caaReleaseMbid: k.caa_release_mbid }]),
  );

  let lookups = 0;
  for (const [release, group] of missing) {
    if (covers.has(release) || lookups >= maxLookups) continue;
    lookups++;
    const c = await fetchCover(release, group);
    if (c) covers.set(release, c);
  }

  return rows.map((r) => {
    const c = r.caaId == null && r.releaseMbid ? covers.get(r.releaseMbid) : undefined;
    return c ? { ...r, ...c } : r;
  });
}
