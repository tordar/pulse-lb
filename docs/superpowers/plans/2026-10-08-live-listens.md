# Live Listens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Sync button. The browser polls ListenBrainz directly, shows new listens instantly, and nudges a server ingest that saves them and updates only the affected aggregate rows.

**Architecture:** A client poller (inside `NowPlaying`) fetches `listens?min_ts=` straight from `api.listenbrainz.org` every 15s and feeds `lib/sync/liveDelta.ts`. When it sees something new it POSTs `/api/listens/ingest/[username]`. That route fetches the same listens from LB server-side, inserts them, and runs `applyIncremental()` in one transaction. A user who has never finished an import gets the existing `syncUser` + `rebuildAll()` path through the same endpoint, driven by a client loop.

**Tech Stack:** Next.js 16 App Router, postgres-js (`sqlClient.begin`), drizzle-kit migrations, `tsx --test` (node:test), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-live-listens-design.md`

## Global Constraints

- Never point a local dev server or local script that WRITES at the production `DATABASE_URL`. After this change, any page view triggers ingest writes. All local verification runs against the throwaway Docker Postgres from Task 1 (`postgres://pulse:pulse@localhost:55432/pulse`).
- Schema migrations against production run only after explicit user confirmation (Task 8).
- The `sync_jobs` table stays in `schema.ts` until Task 8 so `drizzle-kit generate` never emits a surprise DROP.
- UI copy and styling follow existing plain list/section styles: no new fonts, badges, or flair. The only new visible text is the import line `Importing history… {n} of {target}`.
- Client poll interval 15s while the tab is visible; backoff 15s → 60s → 300s on LB errors; polling stops while hidden.
- Ingest throttle: at most one ingest per user per 10s; per-user advisory lock; LB fetch budget 20s; at most 5,000 listens per ingest call (`more: true` beyond that).
- Commit format `<type>: <description>`, focused on why.

## Review Focus

1. **Artist name case variants** ("Radiohead" vs "radiohead"): album name keys are lowercased, so a listen under one spelling can change the other spelling's `distinct_albums`. Expect totals to match a full rebuild. Pinned in Task 3 (case-variant scenario).
2. **Album clusters spanning artists** (112 such clusters in production data): a new listen for artist A can change a cluster whose `agg_album.artist_name` is artist B. Expect the cluster row to match a full rebuild. Pinned in Task 3 (cross-artist scenario).
3. **Two listens in the same second** (different tracks): both must be stored and counted once each, and the client cursor must not drop or double-count either. Pinned in Task 4 (same-second scenario) and Task 5 (`mergeNew` test).
4. **Ingest failing while the tab stays open** (402 unpaid owner, 500): the screen keeps its projection, numbers never double-count after a later refresh, and a 402 stops further ingest calls. Pinned in Task 7 (e2e 402 test).
5. **Brand-new artist / first listen of a new year / new day**: no existing aggregate rows to update. Expect new rows to appear. Pinned in Task 3 (new-artist-new-day scenario).

Known limitation, unchanged from today: a scrobble submitted late with a `listened_at` older than the newest stored listen is never picked up by `min_ts` polling.

---

## File Map

| File | Responsibility |
|---|---|
| `lib/db/schema.ts` | +`aggAlltime.coveredPlays`, +`aggAlbum.memberArtists`, +`syncState.backfillCompletedAt` |
| `drizzle/0015_*.sql` | migration for the three columns + backfill stamp |
| `lib/db/aggregates/albumCluster.ts` | cluster CTE gets an "artist set" scope; `albumAggInsert()` gets optional cluster-key filter and writes `member_artists` |
| `lib/db/aggregates/rebuild.ts` | builders accept an optional artist filter; `rebuildAll` takes the per-user advisory lock; writes `covered_plays` |
| `lib/db/aggregates/lock.ts` | `lockUser(tx, username)` / `tryLockUser(tx, username)` |
| `lib/db/aggregates/incremental.ts` | `planIncremental()` (before insert) + `applyIncremental()` (after insert) |
| `lib/sync/syncUser.ts` | export `listenToRow`, add `fetchNewerListens()` |
| `lib/sync/ingest.ts` | `ingestUser()`: import mode vs live mode, the transaction |
| `app/api/listens/ingest/[username]/route.ts` | HTTP wrapper: paywall, revalidate, JSON |
| `lib/auth/users.ts` | +`getUserByLbUsername()` |
| `lib/live/lbBrowser.ts` | browser-side LB fetch, paging, `toLiveListen`, `nextDelay`, `mergeNew` |
| `lib/live/importStatus.ts` | tiny external store for import progress |
| `lib/sync/liveDelta.ts` | also keeps the list of live rows for "Recent listens" |
| `app/u/[username]/NowPlaying.tsx` | the single poller: playing-now + new listens + ingest loop |
| `app/u/[username]/layout.tsx` | passes `cursor` (agg last_played) to `NowPlaying` |
| `app/u/[username]/stats/LiveRecent.tsx` | prepends live rows to Recent listens |
| `app/u/[username]/stats/ImportStatus.tsx` | the one-line import progress |
| `scripts/clone-user-to-local.ts` | copy one user's data from prod (read-only) into the local test DB |
| `scripts/agg-snapshot.ts` | deterministic per-table dump of a user's `agg_*` rows |
| `scripts/check-incremental.ts` | equivalence harness: incremental vs `rebuildAll` |
| `scripts/check-ingest.ts` | `ingestUser` against local DB with a fake LB |
| Deleted | `SyncButton.tsx`, `app/api/sync/[username]/route.ts`, `lib/sync/chainToken.ts`, `app/api/lb/playing-now/[username]/route.ts` |

---

### Task 1: New columns, rebuild writes them, local test database

**Files:**
- Modify: `lib/db/schema.ts` (aggAlltime ~L89, aggAlbum ~L176, syncState ~L194)
- Create: `drizzle/0015_<generated>.sql` (generated, then hand-appended)
- Modify: `lib/db/aggregates/rebuild.ts` (`buildAlltime`)
- Modify: `lib/db/aggregates/albumCluster.ts` (`ALBUM_AGG_INSERT`)
- Create: `scripts/clone-user-to-local.ts`, `scripts/agg-snapshot.ts`

**Interfaces:**
- Produces: columns `agg_alltime.covered_plays int not null default 0`, `agg_album.member_artists text[]`, `sync_state.backfill_completed_at timestamptz`. Script `scripts/agg-snapshot.ts <user> [outfile]` printing/writing a JSON object `{ [table]: rows[] }`.

- [ ] **Step 1: Start the local test database**

```bash
docker run -d --name pulse-pg-test -p 55432:5432 \
  -e POSTGRES_USER=pulse -e POSTGRES_PASSWORD=pulse -e POSTGRES_DB=pulse postgres:17
export LOCAL_DB=postgres://pulse:pulse@localhost:55432/pulse
DATABASE_URL=$LOCAL_DB npm run db:migrate
```
Expected: `migrated`.

- [ ] **Step 2: Write `scripts/clone-user-to-local.ts`**

Reads from `SOURCE_DATABASE_URL` (prod, SELECT only) and writes to `DATABASE_URL` (must contain `localhost`, else abort).

```ts
import "dotenv/config";
import postgres from "postgres";

const USER = process.argv[2];
if (!USER) throw new Error("usage: tsx scripts/clone-user-to-local.ts <username>");
const dst = process.env.DATABASE_URL!;
if (!/localhost|127\.0\.0\.1/.test(dst)) throw new Error("DATABASE_URL must be local");
const src = postgres(process.env.SOURCE_DATABASE_URL!, { max: 1, prepare: false });
const out = postgres(dst, { max: 1, prepare: false });

async function copy(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    if (chunk.length) await out`INSERT INTO ${out(table)} ${out(chunk)} ON CONFLICT DO NOTHING`;
  }
  console.log(`${table}: ${rows.length}`);
}

async function main() {
  await out`DELETE FROM listens WHERE user_name = ${USER}`;
  const listens = await src`SELECT * FROM listens WHERE user_name = ${USER}`;
  await copy("listens", listens);
  await copy("recordings", await src`
    SELECT r.* FROM recordings r WHERE r.mbid IN (
      SELECT DISTINCT recording_mbid FROM listens WHERE user_name = ${USER} AND recording_mbid IS NOT NULL)`);
  await copy("releases", await src`
    SELECT r.* FROM releases r WHERE r.mbid IN (
      SELECT DISTINCT release_mbid FROM listens WHERE user_name = ${USER} AND release_mbid IS NOT NULL)`);
  await copy("release_groups", await src`
    SELECT g.* FROM release_groups g WHERE g.mbid IN (
      SELECT release_group_mbid FROM listens WHERE user_name = ${USER} AND release_group_mbid IS NOT NULL
      UNION
      SELECT rel.release_group_mbid FROM releases rel JOIN listens l ON l.release_mbid = rel.mbid
      WHERE l.user_name = ${USER} AND rel.release_group_mbid IS NOT NULL)`);
  await out`INSERT INTO sync_state (user_name, last_listened_at, total_listens)
            SELECT ${USER}, MAX(listened_at), COUNT(*)::int FROM listens WHERE user_name = ${USER}
            ON CONFLICT (user_name) DO UPDATE SET last_listened_at = EXCLUDED.last_listened_at`;
  await src.end(); await out.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Write `scripts/agg-snapshot.ts`**

Sorted, normalized dump of every `agg_*` row for a user; excludes `computed_at`.

```ts
import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const TABLES = ["agg_alltime", "agg_year", "agg_hour", "agg_day", "agg_song", "agg_artist", "agg_album"];

export async function snapshot(sql: postgres.Sql, user: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of TABLES) {
    const rows = await sql.unsafe(`SELECT * FROM ${t} WHERE user_name = $1`, [user]);
    out[t] = rows
      .map((r: Record<string, unknown>) => {
        const { computed_at: _, ...rest } = r;
        if (Array.isArray(rest.member_artists)) rest.member_artists = [...rest.member_artists].sort();
        return JSON.stringify(rest, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      })
      .sort();
  }
  return out;
}

export function diff(a: Record<string, string[]>, b: Record<string, string[]>): string[] {
  const problems: string[] = [];
  for (const t of TABLES) {
    const sa = new Set(a[t]); const sb = new Set(b[t]);
    const onlyA = a[t].filter((x) => !sb.has(x)); const onlyB = b[t].filter((x) => !sa.has(x));
    if (onlyA.length || onlyB.length || a[t].length !== b[t].length) {
      problems.push(`${t}: ${onlyA.length} only-left, ${onlyB.length} only-right, rows ${a[t].length} vs ${b[t].length}`);
      onlyA.slice(0, 3).forEach((x) => problems.push(`  - ${x}`));
      onlyB.slice(0, 3).forEach((x) => problems.push(`  + ${x}`));
    }
  }
  return problems;
}

if (process.argv[1]?.endsWith("agg-snapshot.ts")) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  snapshot(sql, process.argv[2]).then((s) => {
    const json = JSON.stringify(s);
    if (process.argv[3]) writeFileSync(process.argv[3], json); else console.log(json);
    return sql.end();
  });
}
```

- [ ] **Step 4: Clone your user and take a baseline**

```bash
DATABASE_URL=$LOCAL_DB SOURCE_DATABASE_URL="$(grep ^DATABASE_URL .env | cut -d= -f2-)" \
  npx tsx scripts/clone-user-to-local.ts tordar
DATABASE_URL=$LOCAL_DB npx tsx scripts/bootstrap-aggregates.ts
```
Expected: `listens: ~192883`, then `tordar — <ms>`.

- [ ] **Step 5: Add the columns to `lib/db/schema.ts`**

In `aggAlltime`, after `durationCoveragePct`:
```ts
  // Plays with a known duration. Stored so live ingest can keep
  // duration_coverage_pct exact without rescanning every listen.
  coveredPlays: integer("covered_plays").default(0).notNull(),
```
In `aggAlbum` columns, after `releaseMbid`:
```ts
    // Lower-cased artist names whose listens fall in this cluster. Clusters
    // can span artists via a shared release group; live ingest uses this to
    // find every artist it must re-read when one of them gets a new listen.
    memberArtists: text("member_artists").array(),
```
In `syncState`, after `lastAggregatedAt`:
```ts
  // Set once the first history import reaches LB's oldest listen. Null means
  // ingest runs in import mode (syncUser + rebuildAll) instead of live mode.
  backfillCompletedAt: timestamp("backfill_completed_at", { withTimezone: true }),
```

- [ ] **Step 6: Generate the migration and append the backfill stamp**

```bash
npm run db:generate
```
Open the new `drizzle/0015_*.sql` and append:
```sql
--> statement-breakpoint
UPDATE "sync_state" s SET "backfill_completed_at" = now()
WHERE EXISTS (SELECT 1 FROM "listens" l WHERE l."user_name" = s."user_name");
```

- [ ] **Step 7: Write `covered_plays` in `buildAlltime`**

In `lib/db/aggregates/rebuild.ts`, add `covered_plays` to the INSERT column list after `duration_coverage_pct`, and to the SELECT after the ROUND(...) expression:
```sql
      COUNT(*) FILTER (WHERE l.duration_ms IS NOT NULL OR r.length_ms IS NOT NULL)::int
```

- [ ] **Step 8: Write `member_artists` in `ALBUM_AGG_INSERT`**

In `albumCluster.ts`, add `member_artists` after `release_mbid` in the INSERT column list, and in BOTH SELECT branches after the `release_mbid` mode() expression:
```sql
    ,
    array_agg(DISTINCT lower(cl.artist_name)) FILTER (WHERE cl.artist_name IS NOT NULL)
```

- [ ] **Step 9: Migrate local, rebuild, verify**

```bash
DATABASE_URL=$LOCAL_DB npm run db:migrate
DATABASE_URL=$LOCAL_DB npx tsx scripts/bootstrap-aggregates.ts
psql $LOCAL_DB -c "SELECT covered_plays, duration_coverage_pct, total_plays FROM agg_alltime WHERE user_name='tordar'" \
  -c "SELECT COUNT(*) FILTER (WHERE array_length(member_artists,1) > 1) AS multi FROM agg_album WHERE user_name='tordar' AND scope=0" \
  -c "SELECT backfill_completed_at IS NOT NULL AS stamped FROM sync_state WHERE user_name='tordar'"
```
Expected: `round(100*covered/total,1) = duration_coverage_pct`; `multi = 112`; `stamped = t`.

- [ ] **Step 10: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add lib/db/schema.ts drizzle lib/db/aggregates scripts/clone-user-to-local.ts scripts/agg-snapshot.ts
git commit -m "feat: store covered plays and album member artists so aggregates can update in place"
```

---

### Task 2: Builders accept an artist scope (no behavior change)

**Files:**
- Modify: `lib/db/aggregates/albumCluster.ts`
- Modify: `lib/db/aggregates/rebuild.ts`
- Create: `lib/db/aggregates/lock.ts`

**Interfaces:**
- Produces:
  - `withArtistSetAlbumClusters(tail: string): string` (cluster CTE where `$1` = username, `$2::text[]` = verbatim artist names)
  - `albumAggInsert(opts?: { clusterKeyParam: number }): string` (`$1` user, `$2` artists, `$<n>` cluster keys when scoped; the unscoped form equals today's `ALBUM_AGG_INSERT`)
  - `export async function buildSong(tx: TransactionSql, username: string, artists?: string[]): Promise<void>`
  - `export async function buildArtist(tx: TransactionSql, username: string, artists?: string[]): Promise<void>`
  - `export async function buildAlbum(tx: TransactionSql, username: string, scope?: { artists: string[]; clusterKeys: string[] }): Promise<void>`
  - `lockUser(tx: TransactionSql, username: string): Promise<void>` (blocking), `tryLockUser(tx: TransactionSql, username: string): Promise<boolean>`

- [ ] **Step 1: Take a "before" snapshot**

```bash
DATABASE_URL=$LOCAL_DB npx tsx scripts/agg-snapshot.ts tordar /tmp/agg-before.json
```

- [ ] **Step 2: Add the artist-set CTE scope**

In `albumCluster.ts` change the generator signature and base filter:
```ts
type ClusterScope = "user" | "artist" | "artistSet";
const clusterCTE = (scope: ClusterScope) => `
  base AS (
    ...unchanged SELECT...
    WHERE l.user_name = $1 AND l.release_name IS NOT NULL
      ${scope === "artist" ? "AND lower(l.artist_name) = lower($2)" : ""}
      ${scope === "artistSet" ? "AND l.artist_name = ANY($2::text[])" : ""}
  ),
  ...rest unchanged...
`;

export const ALBUM_CLUSTER_CTE = clusterCTE("user");
export const ARTIST_SET_CLUSTER_CTE = clusterCTE("artistSet");
export function withAlbumClusters(tail: string): string { return `WITH ${ALBUM_CLUSTER_CTE} ${tail}`; }
export function withArtistAlbumClusters(tail: string): string { return `WITH ${clusterCTE("artist")} ${tail}`; }
/** $1 username, $2::text[] verbatim artist names. Callers MUST pass every
 *  verbatim spelling of each lower-cased name: name keys are lower-cased, so a
 *  missing spelling silently drops votes. */
export function withArtistSetAlbumClusters(tail: string): string {
  return `WITH ${ARTIST_SET_CLUSTER_CTE} ${tail}`;
}
```

- [ ] **Step 3: Turn `ALBUM_AGG_INSERT` into `albumAggInsert()`**

```ts
/** Unscoped: $1 username (full rebuild). Scoped: $1 username, $2 artists,
 *  $3 cluster keys — only those clusters are inserted. */
export function albumAggInsert(scoped = false): string {
  const wrap = scoped ? withArtistSetAlbumClusters : withAlbumClusters;
  const where = scoped ? "WHERE cl.cluster_key = ANY($3::text[])" : "";
  return wrap(`
  INSERT INTO agg_album (
    user_name, scope, group_key, release_name, artist_name,
    plays, effective_ms, caa_id, caa_release_mbid, release_mbid, member_artists
  )
  SELECT ...year-scoped select list exactly as today, incl. member_artists...
  FROM clustered cl
  LEFT JOIN recordings rec ON rec.mbid = cl.recording_mbid
  LEFT JOIN release_groups rgm ON rgm.mbid = cl.canon_rg
  ${where}
  GROUP BY EXTRACT(YEAR FROM cl.listened_at)::int, cl.cluster_key

  UNION ALL

  SELECT ...all-time select list exactly as today, incl. member_artists...
  FROM clustered cl
  LEFT JOIN recordings rec ON rec.mbid = cl.recording_mbid
  LEFT JOIN release_groups rgm ON rgm.mbid = cl.canon_rg
  ${where}
  GROUP BY cl.cluster_key
`);
}
export const ALBUM_AGG_INSERT = albumAggInsert();
```
Copy the two SELECT lists verbatim from the current `ALBUM_AGG_INSERT` (with the Task 1 `member_artists` line); only the `${where}` lines are new.

- [ ] **Step 4: Create `lib/db/aggregates/lock.ts`**

```ts
import type { TransactionSql } from "postgres";

// One lock per user for anything that rewrites that user's agg_* rows. The
// song/artist/album tables have no primary key, so two writers interleaving
// DELETE+INSERT would leave duplicate rows. Transaction-scoped: released on
// COMMIT/ROLLBACK.
export async function lockUser(tx: TransactionSql, username: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${"agg:" + username}))`;
}

export async function tryLockUser(tx: TransactionSql, username: string): Promise<boolean> {
  const [r] = await tx`SELECT pg_try_advisory_xact_lock(hashtext(${"agg:" + username})) AS ok`;
  return r.ok === true;
}
```

- [ ] **Step 5: Scope the builders in `rebuild.ts`**

`rebuildAll` gains `await lockUser(tx, username);` as the first statement inside `begin`. Export the three builders and add the optional filter. `buildSong` moves from a tagged template to `tx.unsafe` so the filter can be spliced:
```ts
export async function buildSong(tx: TransactionSql, username: string, artists?: string[]) {
  const filter = artists ? "AND l.artist_name = ANY($2::text[])" : "";
  await tx.unsafe(
    `
    INSERT INTO agg_song (...same columns...)
    SELECT $1::text, ...year-scoped list unchanged (with $1 in place of ${"${username}"})...
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = $1 ${filter}
    GROUP BY ...unchanged...
    UNION ALL
    SELECT $1::text, 0::int, ...all-time list unchanged...
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = $1 ${filter}
    GROUP BY ...unchanged...
  `,
    artists ? [username, artists] : [username],
  );
}
```
`buildArtist(tx, username, artists?)`: use `WITH ${artists ? ARTIST_SET_CLUSTER_CTE : ALBUM_CLUSTER_CTE}`, append `${filter}` to both `WHERE l.user_name = $1 AND l.artist_name IS NOT NULL` clauses, and pass `artists ? [username, artists] : [username]`.

`buildAlbum`:
```ts
export async function buildAlbum(
  tx: TransactionSql,
  username: string,
  scope?: { artists: string[]; clusterKeys: string[] },
) {
  if (!scope) return void (await tx.unsafe(ALBUM_AGG_INSERT, [username]));
  if (scope.clusterKeys.length === 0) return;
  await tx.unsafe(albumAggInsert(true), [username, scope.artists, scope.clusterKeys]);
}
```

- [ ] **Step 6: Rebuild and compare to the "before" snapshot**

```bash
DATABASE_URL=$LOCAL_DB npx tsx scripts/bootstrap-aggregates.ts
DATABASE_URL=$LOCAL_DB npx tsx scripts/agg-snapshot.ts tordar /tmp/agg-after.json
cmp /tmp/agg-before.json /tmp/agg-after.json && echo IDENTICAL
```
Expected: `IDENTICAL`. If not, run the rebuild a second time without the refactor (`git stash push -m t2-check`, rebuild, snapshot, `git stash apply`) to tell real differences from tie-break nondeterminism in `array_agg ... ORDER BY listened_at DESC`.

- [ ] **Step 7: Typecheck, test, commit**

```bash
npx tsc --noEmit && npm test
git add lib/db/aggregates
git commit -m "refactor: let aggregate builders target a set of artists so ingest can rebuild only what changed"
```

---

### Task 3: Incremental aggregate update + equivalence harness

**Files:**
- Create: `lib/db/aggregates/incremental.ts`
- Create: `scripts/check-incremental.ts`

**Interfaces:**
- Consumes: `buildSong`, `buildArtist`, `buildAlbum`, `withArtistSetAlbumClusters` (Task 2).
- Produces:
  ```ts
  export type NewListenKey = {
    listenedAt: Date; trackName: string; artistName: string | null;
    releaseMbid: string | null; releaseGroupMbid: string | null;
  };
  export type IncrementalPlan = {
    songArtists: string[];      // verbatim names on the new listens
    artistVariants: string[];   // every verbatim spelling of those names (lower-case match)
    loweredArtists: string[];
    expandedArtists: string[];  // artistVariants + all spellings of cluster partners
    beforeClusterKeys: string[];
  };
  export async function planIncremental(tx: TransactionSql, username: string, rows: NewListenKey[]): Promise<IncrementalPlan>;
  export async function applyIncremental(tx: TransactionSql, username: string, plan: IncrementalPlan, inserted: NewListenKey[]): Promise<void>;
  ```
  Contract: call `planIncremental` BEFORE inserting `rows`, insert with `ON CONFLICT DO NOTHING RETURNING`, then call `applyIncremental` with only the returned rows, all inside one transaction that already holds `lockUser`.

- [ ] **Step 1: Write the harness first (`scripts/check-incremental.ts`)**

Each scenario: pick listens to "withhold", delete them, `rebuildAll` (baseline), then in one transaction lock → plan → re-insert → apply, snapshot, `rebuildAll`, snapshot, diff. Finally restore the withheld rows so scenarios are independent.

```ts
import "dotenv/config";
import { sqlClient } from "@/lib/db/client";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";
import { lockUser } from "@/lib/db/aggregates/lock";
import { planIncremental, applyIncremental, type NewListenKey } from "@/lib/db/aggregates/incremental";
import { snapshot, diff } from "./agg-snapshot";

if (!/localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local DB only");
const USER = process.argv[2] ?? "tordar";
const sql = sqlClient;

type Row = Record<string, unknown> & { listened_at: Date; track_name: string; artist_name: string | null;
  release_mbid: string | null; release_group_mbid: string | null };

const key = (r: Row): NewListenKey => ({
  listenedAt: r.listened_at, trackName: r.track_name, artistName: r.artist_name,
  releaseMbid: r.release_mbid, releaseGroupMbid: r.release_group_mbid,
});

async function scenario(name: string, pick: () => Promise<Row[]>, synthetic = false) {
  const rows = await pick();
  if (rows.length === 0) throw new Error(`${name}: picked no rows`);
  if (!synthetic) {
    await sql`DELETE FROM listens WHERE user_name = ${USER}
      AND (listened_at, track_name) IN ${sql(rows.map((r) => [r.listened_at, r.track_name]))}`;
  }
  await rebuildAll(USER);
  await sql.begin(async (tx) => {
    await lockUser(tx, USER);
    const plan = await planIncremental(tx, USER, rows.map(key));
    const inserted = (await tx`INSERT INTO listens ${tx(rows)} ON CONFLICT DO NOTHING
      RETURNING listened_at, track_name, artist_name, release_mbid, release_group_mbid`) as unknown as Row[];
    await applyIncremental(tx, USER, plan, inserted.map(key));
  });
  const inc = await snapshot(sql, USER);
  await rebuildAll(USER);
  const full = await snapshot(sql, USER);
  const problems = diff(inc, full);
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name} (${rows.length} listens)`);
  problems.forEach((p) => console.log("   " + p));
  if (synthetic) {
    await sql`DELETE FROM listens WHERE user_name = ${USER}
      AND (listened_at, track_name) IN ${sql(rows.map((r) => [r.listened_at, r.track_name]))}`;
    await rebuildAll(USER);
  }
  return problems.length === 0;
}

const newest = (n: number) => () => sql<Row[]>`
  SELECT * FROM listens WHERE user_name = ${USER} ORDER BY listened_at DESC LIMIT ${n}`;

async function main() {
  const results = [
    await scenario("newest 1", newest(1)),
    await scenario("newest 25", newest(25)),
    await scenario("newest 400 (spans days)", newest(400)),
    // Review Focus 2: a listen from an artist inside a cross-artist cluster.
    await scenario("cross-artist cluster", () => sql<Row[]>`
      SELECT l.* FROM listens l
      WHERE l.user_name = ${USER} AND lower(l.artist_name) IN (
        SELECT unnest(member_artists) FROM agg_album
        WHERE user_name = ${USER} AND scope = 0 AND array_length(member_artists, 1) > 1 LIMIT 3)
      ORDER BY l.listened_at DESC LIMIT 10`),
    // Review Focus 1: a re-spelled copy of a real listen, one second later.
    await scenario("case variant", async () => {
      const [r] = await sql<Row[]>`SELECT * FROM listens WHERE user_name = ${USER}
        AND release_name IS NOT NULL ORDER BY listened_at DESC LIMIT 1`;
      return [{ ...r, listened_at: new Date(r.listened_at.getTime() + 1000),
        artist_name: r.artist_name!.toUpperCase() === r.artist_name ? r.artist_name!.toLowerCase() : r.artist_name!.toUpperCase() }];
    }, true),
    // Review Focus 5: brand-new artist, new day, new year.
    await scenario("new artist / new day / new year", async () => [{
      user_name: USER, listened_at: new Date("2031-01-01T00:30:00Z"), track_name: "Zz Test Track",
      artist_name: "Zz Test Artist", release_name: "Zz Test Album", recording_mbid: null,
      release_mbid: null, release_group_mbid: null, artist_mbids: [], caa_id: null,
      caa_release_mbid: null, duration_ms: 123000, source: null, inserted_at: new Date(),
    } as Row], true),
  ];
  await sql.end();
  if (results.includes(false)) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it to see it fail**

```bash
DATABASE_URL=$LOCAL_DB npx tsx scripts/check-incremental.ts tordar
```
Expected: fails with `Cannot find module '@/lib/db/aggregates/incremental'`.

- [ ] **Step 3: Write `lib/db/aggregates/incremental.ts`**

```ts
import type { TransactionSql } from "postgres";
import { buildAlbum, buildArtist, buildSong } from "./rebuild";
import { withArtistSetAlbumClusters } from "./albumCluster";

// Live ingest's replacement for rebuildAll(): recompute only the agg_* rows a
// batch of new listens can change. Exact, not an estimate: scripts/
// check-incremental.ts asserts every table matches a full rebuild.
//
// What each table depends on, and so what has to be re-read:
//  - agg_hour: plain counts, so add to them.
//  - agg_day: the days the new listens fall on.
//  - agg_year: derived from agg_day (same sums, same rounding as the rebuild).
//  - agg_song: grouped by verbatim artist_name, so that artist's songs.
//  - agg_artist: distinct_albums counts album clusters, and cluster name keys
//    are lower-cased, so every spelling of the artist.
//  - agg_album: a cluster can span artists through a shared release group
//    (112 do in production). Re-read every artist that shares a cluster with
//    the new listens' artists (agg_album.member_artists), and rebuild exactly
//    the clusters those listens were in before or are in after.
//  - agg_alltime: derived from the other tables plus covered_plays.

export type NewListenKey = {
  listenedAt: Date;
  trackName: string;
  artistName: string | null;
  releaseMbid: string | null;
  releaseGroupMbid: string | null;
};

export type IncrementalPlan = {
  songArtists: string[];
  artistVariants: string[];
  loweredArtists: string[];
  expandedArtists: string[];
  beforeClusterKeys: string[];
};

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

async function spellings(tx: TransactionSql, username: string, lowered: string[], extra: string[]) {
  const rows = await tx<{ artist_name: string }[]>`
    SELECT artist_name FROM agg_artist
    WHERE user_name = ${username} AND scope = 0 AND lower(artist_name) = ANY(${lowered}::text[])`;
  return uniq([...extra, ...rows.map((r) => r.artist_name)]);
}

async function clusterKeysOf(tx: TransactionSql, username: string, expanded: string[], lowered: string[]) {
  const rows = (await tx.unsafe(
    withArtistSetAlbumClusters(
      `SELECT DISTINCT cluster_key FROM clustered WHERE lower(artist_name) = ANY($3::text[])`,
    ),
    [username, expanded, lowered],
  )) as unknown as { cluster_key: string }[];
  return rows.map((r) => r.cluster_key);
}

export async function planIncremental(
  tx: TransactionSql,
  username: string,
  rows: NewListenKey[],
): Promise<IncrementalPlan> {
  const songArtists = uniq(rows.map((r) => r.artistName).filter((a): a is string => a != null));
  const loweredArtists = uniq(songArtists.map((a) => a.toLowerCase()));
  const artistVariants = await spellings(tx, username, loweredArtists, songArtists);

  // Release groups any of these artists' listens (stored or incoming) vote for.
  // A cluster can only be shared through one of them.
  const rgRows = await tx<{ rg: string }[]>`
    SELECT DISTINCT COALESCE(l.release_group_mbid, rel.release_group_mbid)::text AS rg
    FROM listens l LEFT JOIN releases rel ON rel.mbid = l.release_mbid
    WHERE l.user_name = ${username} AND l.artist_name = ANY(${artistVariants}::text[])
      AND l.release_name IS NOT NULL
      AND COALESCE(l.release_group_mbid, rel.release_group_mbid) IS NOT NULL
    UNION
    SELECT DISTINCT COALESCE(x.rg, rel.release_group_mbid)::text
    FROM unnest(${rows.map((r) => r.releaseGroupMbid)}::uuid[], ${rows.map((r) => r.releaseMbid)}::uuid[]) AS x(rg, rel_mbid)
    LEFT JOIN releases rel ON rel.mbid = x.rel_mbid
    WHERE COALESCE(x.rg, rel.release_group_mbid) IS NOT NULL`;
  const partners = await tx<{ a: string }[]>`
    SELECT DISTINCT unnest(member_artists) AS a FROM agg_album
    WHERE user_name = ${username} AND scope = 0
      AND group_key = ANY(${rgRows.map((r) => r.rg)}::text[])`;
  const expandedLowered = uniq([...loweredArtists, ...partners.map((p) => p.a)]);
  const expandedArtists = await spellings(tx, username, expandedLowered, artistVariants);

  const beforeClusterKeys = await clusterKeysOf(tx, username, expandedArtists, loweredArtists);
  return { songArtists, artistVariants, loweredArtists, expandedArtists, beforeClusterKeys };
}

export async function applyIncremental(
  tx: TransactionSql,
  username: string,
  plan: IncrementalPlan,
  inserted: NewListenKey[],
): Promise<void> {
  if (inserted.length === 0) return;
  const ts = inserted.map((r) => r.listenedAt);
  const tracks = inserted.map((r) => r.trackName);

  // agg_hour: additive.
  await tx`
    UPDATE agg_hour h SET plays = h.plays + n.c
    FROM (SELECT EXTRACT(HOUR FROM t)::int AS hour, COUNT(*)::int AS c
          FROM unnest(${ts}::timestamptz[]) AS t GROUP BY 1) n
    WHERE h.user_name = ${username} AND h.hour = n.hour`;

  // agg_day: recompute the touched days. Range first so the PK index is used.
  await tx`
    WITH d AS (SELECT DISTINCT t::date AS day FROM unnest(${ts}::timestamptz[]) AS t)
    DELETE FROM agg_day WHERE user_name = ${username} AND date IN (SELECT day FROM d)`;
  await tx`
    WITH d AS (SELECT DISTINCT t::date AS day FROM unnest(${ts}::timestamptz[]) AS t)
    INSERT INTO agg_day (user_name, date, plays, effective_ms)
    SELECT ${username}::text, l.listened_at::date, COUNT(*)::int,
           COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint
    FROM listens l LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username}
      AND l.listened_at >= (SELECT MIN(day) FROM d)
      AND l.listened_at < (SELECT MAX(day) FROM d) + 1
      AND l.listened_at::date IN (SELECT day FROM d)
    GROUP BY l.listened_at::date`;

  // agg_year: from agg_day — same per-listen sums, same rounding as buildYear.
  await tx`
    WITH y AS (SELECT DISTINCT EXTRACT(YEAR FROM t)::int AS year FROM unnest(${ts}::timestamptz[]) AS t)
    DELETE FROM agg_year WHERE user_name = ${username} AND year IN (SELECT year FROM y)`;
  await tx`
    WITH y AS (SELECT DISTINCT EXTRACT(YEAR FROM t)::int AS year FROM unnest(${ts}::timestamptz[]) AS t)
    INSERT INTO agg_year (user_name, year, plays, hours)
    SELECT ${username}::text, EXTRACT(YEAR FROM date)::int, SUM(plays)::int,
           ROUND(COALESCE(SUM(effective_ms), 0) / 1000.0 / 3600, 2)::float8
    FROM agg_day
    WHERE user_name = ${username} AND EXTRACT(YEAR FROM date)::int IN (SELECT year FROM y)
    GROUP BY EXTRACT(YEAR FROM date)::int`;

  // agg_song: grouped by verbatim artist name.
  await tx`DELETE FROM agg_song WHERE user_name = ${username} AND artist_name = ANY(${plan.songArtists}::text[])`;
  await buildSong(tx, username, plan.songArtists);

  // agg_artist: every spelling (shared lower-cased name keys).
  await tx`DELETE FROM agg_artist WHERE user_name = ${username} AND artist_name = ANY(${plan.artistVariants}::text[])`;
  await buildArtist(tx, username, plan.artistVariants);

  // agg_album: clusters the new listens' artists were in before or are in now.
  const after = await clusterKeysOf(tx, username, plan.expandedArtists, plan.loweredArtists);
  const keys = uniq([...plan.beforeClusterKeys, ...after]);
  await tx`DELETE FROM agg_album WHERE user_name = ${username} AND group_key = ANY(${keys}::text[])`;
  await buildAlbum(tx, username, { artists: plan.expandedArtists, clusterKeys: keys });

  // agg_alltime: derived. distinct_songs identity mirrors buildAlltime's
  // COALESCE(recording_mbid::text, track_name): '~' groups are mbid-less.
  await tx`
    UPDATE agg_alltime a SET
      total_plays      = d.plays,
      effective_ms     = d.ms,
      distinct_artists = (SELECT COUNT(*)::int FROM agg_artist WHERE user_name = ${username} AND scope = 0),
      distinct_albums  = (SELECT COUNT(*)::int FROM agg_album  WHERE user_name = ${username} AND scope = 0),
      distinct_songs   = (SELECT COUNT(DISTINCT CASE WHEN group_key LIKE '~%' THEN track_name ELSE recording_mbid::text END)::int
                          FROM agg_song WHERE user_name = ${username} AND scope = 0),
      first_played     = b.first_played,
      last_played      = b.last_played,
      covered_plays    = a.covered_plays + c.covered,
      duration_coverage_pct = ROUND(100.0 * (a.covered_plays + c.covered) / NULLIF(d.plays, 0), 1)::float8,
      computed_at      = now()
    FROM
      (SELECT COALESCE(SUM(plays), 0)::int AS plays, COALESCE(SUM(effective_ms), 0)::bigint AS ms
         FROM agg_day WHERE user_name = ${username}) d,
      (SELECT MIN(listened_at) AS first_played, MAX(listened_at) AS last_played
         FROM listens WHERE user_name = ${username}) b,
      (SELECT COUNT(*)::int AS covered
         FROM unnest(${ts}::timestamptz[], ${tracks}::text[]) AS n(ts, track)
         JOIN listens l ON l.user_name = ${username} AND l.listened_at = n.ts AND l.track_name = n.track
         LEFT JOIN recordings r ON r.mbid = l.recording_mbid
         WHERE l.duration_ms IS NOT NULL OR r.length_ms IS NOT NULL) c
    WHERE a.user_name = ${username}`;
}
```

- [ ] **Step 4: Run the harness**

```bash
DATABASE_URL=$LOCAL_DB npx tsx scripts/check-incremental.ts tordar
```
Expected: six `PASS` lines. A FAIL limited to `caa_id`/`caa_release_mbid`/`track_name` on rows with two listens in the same second is tie-break nondeterminism: confirm by diffing two consecutive full rebuilds. Any other FAIL is a real bug; fix `incremental.ts`, not the harness.

- [ ] **Step 5: Time it**

Add `console.time("apply")`/`console.timeEnd("apply")` around the transaction in the harness for one run. Expected: under 1s for "newest 25" against local Docker. Remove the timing lines.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add lib/db/aggregates/incremental.ts scripts/check-incremental.ts
git commit -m "feat: update only the aggregate rows new listens touch instead of rebuilding everything"
```

---

### Task 4: Server ingest (`ingestUser` + route)

**Files:**
- Modify: `lib/sync/syncUser.ts` (export `listenToRow`, add `fetchNewerListens`)
- Create: `lib/sync/ingest.ts`
- Create: `app/api/listens/ingest/[username]/route.ts`
- Modify: `lib/auth/users.ts` (+`getUserByLbUsername`)
- Modify: `lib/sync/healAggregates.ts` (comment only: now called from ingest)
- Create: `scripts/check-ingest.ts`

**Interfaces:**
- Consumes: `planIncremental`, `applyIncremental`, `NewListenKey` (Task 3); `lockUser`, `tryLockUser` (Task 2); `syncUser`, `rebuildAll`.
- Produces:
  ```ts
  // syncUser.ts
  export type ListenRow = ReturnType<typeof listenToRow>;
  export function listenToRow(username: string, l: Listen): ListenRow;
  export async function fetchNewerListens(username: string, sinceTs: number,
    opts: { deadline: number; maxRows: number }): Promise<{ rows: ListenRow[]; more: boolean }>;
  // ingest.ts
  export type IngestResult =
    | { mode: "live"; added: number; more: boolean }
    | { mode: "import"; added: number; more: boolean; imported: number; target: number | null }
    | { mode: "busy" } | { mode: "skipped" };
  export async function ingestUser(username: string, deps?: { fetchNewer?: typeof fetchNewerListens;
    now?: () => number }): Promise<IngestResult>;
  // users.ts
  export async function getUserByLbUsername(lbUsername: string): Promise<DbUser | null>;
  ```
  HTTP: `POST /api/listens/ingest/{username}` → 200 `IngestResult` JSON, 402 `{ error: "subscription_required" }`.

- [ ] **Step 1: Write `scripts/check-ingest.ts` (fails until ingest exists)**

```ts
import "dotenv/config";
import assert from "node:assert/strict";
import { sqlClient as sql } from "@/lib/db/client";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";
import { ingestUser } from "@/lib/sync/ingest";
import type { ListenRow } from "@/lib/sync/syncUser";
import { snapshot, diff } from "./agg-snapshot";

if (!/localhost/.test(process.env.DATABASE_URL ?? "")) throw new Error("local DB only");
const USER = process.argv[2] ?? "tordar";

const toRow = (r: Record<string, any>): ListenRow => ({
  userName: r.user_name, listenedAt: r.listened_at, trackName: r.track_name, artistName: r.artist_name,
  releaseName: r.release_name, recordingMbid: r.recording_mbid, releaseMbid: r.release_mbid,
  releaseGroupMbid: r.release_group_mbid, artistMbids: r.artist_mbids ?? [], caaId: r.caa_id,
  caaReleaseMbid: r.caa_release_mbid, durationMs: r.duration_ms, source: r.source,
});

async function main() {
  // Withhold the newest 30, plus a same-second twin (Review Focus 3).
  const withheld = await sql`SELECT * FROM listens WHERE user_name = ${USER} ORDER BY listened_at DESC LIMIT 30`;
  const twin = { ...withheld[0], track_name: withheld[0].track_name + " (twin)" };
  const rows = [...withheld, twin].map(toRow);
  await sql`DELETE FROM listens WHERE user_name = ${USER}
    AND (listened_at, track_name) IN ${sql(withheld.map((r) => [r.listened_at, r.track_name]))}`;
  await rebuildAll(USER);
  await sql`UPDATE sync_state SET last_synced_at = NULL, backfill_completed_at = now() WHERE user_name = ${USER}`;

  const fetchNewer = async () => ({ rows, more: false });
  const [a, b] = await Promise.all([ingestUser(USER, { fetchNewer }), ingestUser(USER, { fetchNewer })]);
  const modes = [a.mode, b.mode].sort();
  assert.deepEqual(modes, ["busy", "live"], `concurrent: ${modes}`);
  const live = (a.mode === "live" ? a : b) as { added: number };
  assert.equal(live.added, 31, "all 31 rows inserted, twin included");

  assert.equal((await ingestUser(USER, { fetchNewer })).mode, "skipped", "throttled within 10s");

  const inc = await snapshot(sql, USER);
  await rebuildAll(USER);
  assert.deepEqual(diff(inc, await snapshot(sql, USER)), []);
  await sql`DELETE FROM listens WHERE user_name = ${USER} AND track_name = ${twin.track_name}`;
  await rebuildAll(USER);
  console.log("PASS check-ingest");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Run: `DATABASE_URL=$LOCAL_DB npx tsx scripts/check-ingest.ts tordar`
Expected: FAIL, `Cannot find module '@/lib/sync/ingest'`.

- [ ] **Step 2: Add `fetchNewerListens` to `syncUser.ts`**

Change `function listenToRow` to `export function listenToRow`, add `export type ListenRow = ReturnType<typeof listenToRow>;`, and add:
```ts
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
    rows.push(...page.map((l) => listenToRow(username, l)));
    cursor = page[0].listened_at;
    if (page.length < 1000) return { rows, more: false };
  }
}
```

- [ ] **Step 3: Add `getUserByLbUsername` to `lib/auth/users.ts`**

```ts
export async function getUserByLbUsername(lbUsername: string): Promise<DbUser | null> {
  const row = await withRetry(() =>
    db.query.users.findFirst({ where: eq(schema.users.listenbrainzUsername, lbUsername) }),
  );
  return row ?? null;
}
```

- [ ] **Step 4: Write `lib/sync/ingest.ts`**

```ts
import { eq } from "drizzle-orm";
import { db, schema, sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";
import { tryLockUser } from "@/lib/db/aggregates/lock";
import { planIncremental, applyIncremental, type NewListenKey } from "@/lib/db/aggregates/incremental";
import { syncUser, fetchNewerListens } from "@/lib/sync/syncUser";
import { countListens } from "@/lib/db/queries/listenCount";

// Replaces the Sync button. Browsers call this when they see listens on LB
// that the page doesn't show yet. Two modes:
//  - import: the user's history hasn't been fully pulled yet. Same work the
//    old sync chain did, one 40s slice per call; the client loops on `more`.
//  - live: fetch what's newer than our newest listen, insert it and update
//    only the affected aggregate rows, all in one transaction.
const THROTTLE_MS = 10_000;
const FETCH_BUDGET_MS = 20_000;
const MAX_ROWS = 5_000;

export type IngestResult =
  | { mode: "live"; added: number; more: boolean }
  | { mode: "import"; added: number; more: boolean; imported: number; target: number | null }
  | { mode: "busy" }
  | { mode: "skipped" };

export async function ingestUser(
  username: string,
  deps: { fetchNewer?: typeof fetchNewerListens; now?: () => number } = {},
): Promise<IngestResult> {
  const now = deps.now ?? Date.now;
  const fetchNewer = deps.fetchNewer ?? fetchNewerListens;
  const state = await withRetry(() =>
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
  );

  if (!state?.backfillCompletedAt) return importSlice(username);

  if (state.lastSyncedAt && now() - new Date(state.lastSyncedAt).getTime() < THROTTLE_MS) {
    return { mode: "skipped" };
  }

  const since = state.lastListenedAt ? Math.floor(new Date(state.lastListenedAt).getTime() / 1000) : 0;
  const { rows, more } = await fetchNewer(username, since, {
    deadline: now() + FETCH_BUDGET_MS,
    maxRows: MAX_ROWS,
  });

  const outcome = await withRetry(() =>
    sqlClient.begin(async (tx) => {
      if (!(await tryLockUser(tx, username))) return { kind: "busy" as const, added: 0 };
      // Re-check under the lock: a concurrent caller may have just finished.
      const [s] = await tx`SELECT last_synced_at FROM sync_state WHERE user_name = ${username}`;
      if (s?.last_synced_at && now() - new Date(s.last_synced_at).getTime() < THROTTLE_MS) {
        return { kind: "skipped" as const, added: 0 };
      }
      let added = 0;
      if (rows.length > 0) {
        const keys: NewListenKey[] = rows.map((r) => ({
          listenedAt: r.listenedAt, trackName: r.trackName, artistName: r.artistName,
          releaseMbid: r.releaseMbid ?? null, releaseGroupMbid: r.releaseGroupMbid ?? null,
        }));
        const plan = await planIncremental(tx, username, keys);
        const values = rows.map((r) => ({
          user_name: r.userName, listened_at: r.listenedAt, track_name: r.trackName,
          artist_name: r.artistName, release_name: r.releaseName, recording_mbid: r.recordingMbid,
          release_mbid: r.releaseMbid, release_group_mbid: r.releaseGroupMbid,
          artist_mbids: r.artistMbids, caa_id: r.caaId, caa_release_mbid: r.caaReleaseMbid,
          duration_ms: r.durationMs, source: r.source,
        }));
        const inserted = await tx`
          INSERT INTO listens ${tx(values)} ON CONFLICT DO NOTHING
          RETURNING listened_at, track_name, artist_name, release_mbid, release_group_mbid`;
        added = inserted.length;
        await applyIncremental(tx, username, plan, inserted.map((r) => ({
          listenedAt: r.listened_at, trackName: r.track_name, artistName: r.artist_name,
          releaseMbid: r.release_mbid, releaseGroupMbid: r.release_group_mbid,
        })));
      }
      await tx`
        UPDATE sync_state SET
          last_synced_at = now(),
          last_listened_at = GREATEST(last_listened_at, (SELECT MAX(listened_at) FROM listens WHERE user_name = ${username})),
          total_listens = total_listens + ${added},
          last_aggregated_at = now()
        WHERE user_name = ${username}`;
      return { kind: "done" as const, added };
    }),
  );

  if (outcome.kind !== "done") return { mode: outcome.kind };
  return { mode: "live", added: outcome.added, more };
}

async function importSlice(username: string): Promise<IngestResult> {
  const result = await syncUser(username, { maxDurationMs: 40_000 });
  if (result.completed) {
    await rebuildAll(username);
    await withRetry(() =>
      db.update(schema.syncState)
        .set({ backfillCompletedAt: new Date(), lastAggregatedAt: new Date() })
        .where(eq(schema.syncState.userName, username)),
    );
  }
  const state = await withRetry(() =>
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
  );
  return {
    mode: "import",
    added: result.added,
    more: !result.completed,
    imported: await countListens(username),
    target: state?.targetListens ?? null,
  };
}
```

In the concurrent test both callers pass the pre-lock throttle check (no recent sync yet), one wins the lock (`live`), the other fails `tryLockUser` (`busy`).

- [ ] **Step 5: Write the route `app/api/listens/ingest/[username]/route.ts`**

```ts
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
```
`isAllowedToSync(null)` returns false in SaaS mode, so an unknown username gets 402 without touching LB.

- [ ] **Step 6: Make `healStaleAggregates` take the lock**

`rebuildAll` already locks (Task 2), so no code change. Update its doc comment: "now runs from the ingest route" in place of "the owner's sync-status probe".

- [ ] **Step 7: Run the checks**

```bash
DATABASE_URL=$LOCAL_DB npx tsx scripts/check-ingest.ts tordar
DATABASE_URL=$LOCAL_DB npx tsx scripts/check-incremental.ts tordar
npx tsc --noEmit && npm test
```
Expected: `PASS check-ingest`, six `PASS`, no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/sync lib/auth/users.ts app/api/listens scripts/check-ingest.ts
git commit -m "feat: add listen ingest endpoint so any open page can pull new listens into the database"
```

---

### Task 5: Browser LB client, live recent rows, import status store

**Files:**
- Create: `lib/live/lbBrowser.ts`, `lib/live/lbBrowser.test.ts`
- Create: `lib/live/importStatus.ts`
- Modify: `lib/sync/liveDelta.ts`

**Interfaces:**
- Produces:
  ```ts
  // lbBrowser.ts (no "use client": pure, importable by tests)
  export type LBListen = { listened_at: number; track_metadata: { track_name: string; artist_name: string;
    release_name?: string | null; additional_info?: { duration_ms?: number | null; recording_mbid?: string | null } | null;
    mbid_mapping?: { recording_mbid?: string | null } | null } };
  export function toLiveListen(l: LBListen): LiveListen;
  export function nextDelay(failures: number): number;        // 0→15000, 1→60000, ≥2→300000
  export function mergeNew(seen: Set<string>, incoming: LiveListen[]): LiveListen[]; // dedupes by listened_at|track
  export async function fetchListensSince(username: string, minTs: number,
    fetchImpl?: typeof fetch): Promise<LBListen[]>;          // newest first, pages until short page
  export async function fetchPlayingNow(username: string, fetchImpl?: typeof fetch): Promise<PlayingNow>;
  // liveDelta.ts additions
  export type LiveListen = { listened_at: string; track_name: string; artist_name: string;
    release_name: string | null; recording_mbid: string | null; duration_ms: number | null };
  export function useLiveRecent(): LiveListen[];             // newest first, max 50
  // importStatus.ts
  export type ImportStatus = { imported: number; target: number | null } | null;
  export function setImportStatus(s: ImportStatus): void;
  export function useImportStatus(): ImportStatus;
  ```

- [ ] **Step 1: Write the failing tests `lib/live/lbBrowser.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchListensSince, mergeNew, nextDelay, toLiveListen, type LBListen } from "./lbBrowser";

const L = (ts: number, track = "t"): LBListen => ({
  listened_at: ts, track_metadata: { track_name: track, artist_name: "a", release_name: "r",
    additional_info: { duration_ms: 1000, recording_mbid: null }, mbid_mapping: { recording_mbid: "m" } },
});

test("nextDelay backs off 15s → 60s → 5min", () => {
  assert.deepEqual([0, 1, 2, 9].map(nextDelay), [15_000, 60_000, 300_000, 300_000]);
});

test("toLiveListen prefers mapped recording mbid and ISO time", () => {
  const live = toLiveListen(L(1_700_000_000));
  assert.equal(live.recording_mbid, "m");
  assert.equal(live.listened_at, new Date(1_700_000_000_000).toISOString());
  assert.equal(live.duration_ms, 1000);
});

test("mergeNew keeps two tracks in the same second and drops repeats", () => {
  const seen = new Set<string>();
  const a = toLiveListen(L(10, "x")); const b = toLiveListen(L(10, "y"));
  assert.equal(mergeNew(seen, [a, b]).length, 2);
  assert.equal(mergeNew(seen, [a, b]).length, 0);
});

test("fetchListensSince pages forward until a short page", async () => {
  const calls: string[] = [];
  const pages = [Array.from({ length: 1000 }, (_, i) => L(2000 - i)), [L(2500)]];
  const fake = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ payload: { count: 0, listens: pages.shift() ?? [] } }));
  }) as typeof fetch;
  const got = await fetchListensSince("u", 1000, fake);
  assert.equal(got.length, 1001);
  assert.match(calls[0], /min_ts=1000/);
  assert.match(calls[1], /min_ts=2000/);
  assert.equal(got[0].listened_at, 2500, "newest first");
});
```
Run: `npx tsx --test lib/live/lbBrowser.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 2: Write `lib/live/lbBrowser.ts`**

```ts
import type { LiveListen } from "@/lib/sync/liveDelta";

// The browser talks to ListenBrainz directly: its API sends
// access-control-allow-origin: * and rate-limits per caller IP, so polling
// costs us no function invocations and no database time.
const LB = "https://api.listenbrainz.org";

export type LBListen = {
  listened_at: number;
  track_metadata: {
    track_name: string;
    artist_name: string;
    release_name?: string | null;
    additional_info?: { duration_ms?: number | null; recording_mbid?: string | null } | null;
    mbid_mapping?: { recording_mbid?: string | null; caa_id?: number | null; caa_release_mbid?: string | null } | null;
  };
};

export type PlayingNow = {
  track_name: string; artist_name: string; release_name?: string | null;
  caa_id?: number | null; caa_release_mbid?: string | null;
} | null;

export function toLiveListen(l: LBListen): LiveListen {
  const m = l.track_metadata;
  return {
    listened_at: new Date(l.listened_at * 1000).toISOString(),
    track_name: m.track_name,
    artist_name: m.artist_name,
    release_name: m.release_name ?? null,
    recording_mbid: m.mbid_mapping?.recording_mbid ?? m.additional_info?.recording_mbid ?? null,
    duration_ms: m.additional_info?.duration_ms ?? null,
  };
}

export function nextDelay(failures: number): number {
  return failures <= 0 ? 15_000 : failures === 1 ? 60_000 : 300_000;
}

export function mergeNew(seen: Set<string>, incoming: LiveListen[]): LiveListen[] {
  const fresh: LiveListen[] = [];
  for (const l of incoming) {
    const k = `${l.listened_at}|${l.track_name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(l);
  }
  return fresh;
}

export async function fetchListensSince(
  username: string,
  minTs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<LBListen[]> {
  const all: LBListen[] = [];
  let cursor = minTs;
  while (true) {
    const r = await fetchImpl(`${LB}/1/user/${encodeURIComponent(username)}/listens?min_ts=${cursor}&count=1000`);
    if (!r.ok) throw new Error(`LB ${r.status}`);
    const page = ((await r.json()) as { payload: { listens: LBListen[] } }).payload.listens;
    all.unshift(...page);
    if (page.length < 1000) return all;
    cursor = page[0].listened_at;
  }
}

export async function fetchPlayingNow(username: string, fetchImpl: typeof fetch = fetch): Promise<PlayingNow> {
  const r = await fetchImpl(`${LB}/1/user/${encodeURIComponent(username)}/playing-now`);
  if (!r.ok) throw new Error(`LB ${r.status}`);
  const l = ((await r.json()) as { payload: { listens: LBListen[] } }).payload.listens[0];
  if (!l) return null;
  const m = l.track_metadata;
  return {
    track_name: m.track_name, artist_name: m.artist_name, release_name: m.release_name ?? null,
    caa_id: m.mbid_mapping?.caa_id ?? null, caa_release_mbid: m.mbid_mapping?.caa_release_mbid ?? null,
  };
}
```
`all.unshift(...page)` keeps newest first: each later page holds newer listens (LB returns each page newest-first, and `min_ts` walks forward).

- [ ] **Step 3: Run the tests**

`npx tsx --test lib/live/lbBrowser.test.ts` → expected: 4 passing.

- [ ] **Step 4: Extend `liveDelta.ts`**

Replace the `LiveListen` type with the one in Interfaces (adds `listened_at`). Add after `let counters`:
```ts
// The rows themselves, newest first, for the "Recent listens" list. Capped:
// only the top few are ever shown, and a tab can stay open for days.
let recent: LiveListen[] = [];
const RECENT_MAX = 50;
```
In `recordListens`, before `emit()`:
```ts
  recent = [...rows].sort((a, b) => b.listened_at.localeCompare(a.listened_at)).concat(recent).slice(0, RECENT_MAX);
```
In `resetLive`, add `recent = [];`. Add:
```ts
export function useLiveRecent(): LiveListen[] {
  return useSyncExternalStore(subscribe, () => recent, () => EMPTY);
}
const EMPTY: LiveListen[] = [];
```
Update the file's top comment: the projection is now fed by the live poller in `NowPlaying.tsx`, not a sync.

- [ ] **Step 5: Write `lib/live/importStatus.ts`**

```ts
"use client";
import { useSyncExternalStore } from "react";

// Progress of a first-time history import, set by the poller in NowPlaying
// and shown as one line in the stats header. Null when no import is running.
export type ImportStatus = { imported: number; target: number | null } | null;

let status: ImportStatus = null;
const listeners = new Set<() => void>();

export function setImportStatus(s: ImportStatus) {
  status = s;
  for (const fn of listeners) fn();
}

export function useImportStatus(): ImportStatus {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    () => status,
    () => null,
  );
}
```

- [ ] **Step 6: Typecheck, test, commit**

```bash
npx tsc --noEmit && npm test
git add lib/live lib/sync/liveDelta.ts
git commit -m "feat: fetch new listens from ListenBrainz in the browser so they show before the server has them"
```
`SyncButton.tsx` still compiles (its rows already carry `listened_at: string`). If it doesn't, don't patch it: Task 6 deletes that file.

---

### Task 6: Wire the poller, remove the sync UI and route

**Files:**
- Modify: `app/u/[username]/NowPlaying.tsx`
- Modify: `app/u/[username]/layout.tsx` (`HeaderRight`)
- Create: `app/u/[username]/stats/LiveRecent.tsx`, `app/u/[username]/stats/ImportStatus.tsx`
- Modify: `app/u/[username]/stats/page.tsx` (`StatsHeader`, `RecentListens`)
- Modify: `app/onboarding/page.tsx` (copy at ~L62)
- Modify: `lib/db/queries/cache.ts` (comment), `lib/listenbrainz/client.ts` (remove `getPlayingNow` + `PlayingNow*` schemas)
- Delete: `app/u/[username]/stats/SyncButton.tsx`, `app/api/sync/[username]/route.ts`, `lib/sync/chainToken.ts`, `app/api/lb/playing-now/[username]/route.ts`

**Interfaces:**
- Consumes: `fetchListensSince`, `fetchPlayingNow`, `toLiveListen`, `mergeNew`, `nextDelay` (Task 5); `recordListens`, `useLiveRecent` (liveDelta); `setImportStatus`, `useImportStatus` (Task 5); `POST /api/listens/ingest/{username}` → `IngestResult` (Task 4).
- Produces: `NowPlaying({ username: string; cursor: number | null })`, where `cursor` is epoch seconds of `agg_alltime.last_played` or null when the user has no aggregates yet.

- [ ] **Step 1: Rewrite the effect in `NowPlaying.tsx`**

Keep the JSX unchanged. Replace the imports, `POLL_MS`, and the `useEffect`:
```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Music2 } from "lucide-react";
import { fetchListensSince, fetchPlayingNow, mergeNew, nextDelay, toLiveListen, type PlayingNow } from "@/lib/live/lbBrowser";
import { recordListens } from "@/lib/sync/liveDelta";
import { setImportStatus } from "@/lib/live/importStatus";
import type { IngestResult } from "@/lib/sync/ingest";

// The one live loop on every profile page. Every 15s while the tab is visible
// it asks ListenBrainz (directly, from the browser) for what's playing and for
// listens newer than the newest one this page has seen. New listens go on
// screen immediately via liveDelta; then the server is nudged to store them.
// A hidden tab stops entirely.
export function NowPlaying({ username, cursor }: { username: string; cursor: number | null }) {
  const [np, setNp] = useState<PlayingNow>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let since = cursor;
    let ingesting = false;
    let ingestAllowed = true;
    const seen = new Set<string>();

    async function ingest() {
      if (ingesting || !ingestAllowed) return;
      ingesting = true;
      try {
        while (!cancelled) {
          const r = await fetch(`/api/listens/ingest/${encodeURIComponent(username)}`, { method: "POST" });
          if (r.status === 402) { ingestAllowed = false; return; }
          if (!r.ok) return;
          const res = (await r.json()) as IngestResult;
          if (res.mode === "import") setImportStatus(res.more ? { imported: res.imported, target: res.target } : null);
          // "skipped" means another tab or viewer just stored them: refresh too.
          if (res.mode !== "busy") router.refresh();
          if (!("more" in res) || !res.more) return;
        }
      } catch {
        /* next new listen retries */
      } finally {
        ingesting = false;
      }
    }

    async function tick() {
      if (document.visibilityState !== "visible") return;
      try {
        const [playing, listens] = await Promise.all([
          fetchPlayingNow(username),
          since == null ? Promise.resolve([]) : fetchListensSince(username, since),
        ]);
        if (cancelled) return;
        setNp(playing);
        failures = 0;
        if (since == null) {
          void ingest(); // no aggregates yet: first import
        } else if (listens.length > 0) {
          since = listens[0].listened_at;
          const fresh = mergeNew(seen, listens.map(toLiveListen));
          if (fresh.length > 0) recordListens(fresh);
          void ingest();
        }
      } catch {
        failures++;
      }
      schedule();
    }

    function schedule() {
      if (cancelled || document.visibilityState !== "visible") return;
      timer = setTimeout(tick, nextDelay(failures));
    }
    function onVisibility() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (document.visibilityState === "visible") void tick();
    }

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [username, cursor, router]);
  // ...existing coverUrl + JSX unchanged...
}
```
Why `cursor` is in the deps: after `router.refresh()` the layout re-renders with the new `last_played`, the effect restarts from the server's cursor, and `useProjected`/`TopList` re-zero against the new base, so nothing is counted twice.

- [ ] **Step 2: Pass the cursor from the layout**

In `app/u/[username]/layout.tsx`:
```tsx
import { allTimeStats } from "@/lib/db/queries/stats";
...
async function HeaderRight({ params }: { params: Params }) {
  const { username } = await params;
  // Same cached row the stats tiles render from, so the poller starts exactly
  // where the numbers on screen stop.
  const { last_played } = await allTimeStats(username);
  const cursor = last_played ? Math.floor(new Date(last_played).getTime() / 1000) : null;
  return (
    <>
      <NowPlaying username={username} cursor={cursor} />
      ...unchanged OwnerOnly block...
    </>
  );
}
```

- [ ] **Step 3: Create `app/u/[username]/stats/LiveRecent.tsx`**

```tsx
"use client";
import { useLiveRecent } from "@/lib/sync/liveDelta";
import { splitDateTime } from "@/lib/format";

// Listens the poller has seen that the server-rendered list doesn't include
// yet. Same row markup as RecentListens; disappears as refreshes catch up.
export function LiveRecent({ newestServer }: { newestServer: string | null }) {
  const rows = useLiveRecent().filter((r) => !newestServer || r.listened_at > newestServer);
  return (
    <>
      {rows.map((r) => {
        const { date, time } = splitDateTime(r.listened_at);
        return (
          <li key={`${r.listened_at}|${r.track_name}`} className="flex gap-3 py-2 items-baseline">
            <span className="text-subtle-foreground tabular-nums shrink-0 text-xs leading-tight whitespace-nowrap">
              <span className="block">{date}</span>
              <span className="block">{time}</span>
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-foreground">{r.track_name}</span>
              <span className="text-subtle-foreground"> · {r.artist_name}</span>
              {r.release_name && <span className="text-subtle-foreground"> · {r.release_name}</span>}
            </span>
          </li>
        );
      })}
    </>
  );
}
```
Move `splitDateTime` from `page.tsx` into `lib/format.ts` (export it) and import it in both files. Check the existing `<li>` markup in `RecentListens` (page.tsx ~L321) and copy it exactly, including the source dot if present (live rows pass no source).

In `RecentListens`, render `<LiveRecent newestServer={rows[0]?.listened_at ?? null} />` as the first child of the `<ul>`.

- [ ] **Step 4: Create `app/u/[username]/stats/ImportStatus.tsx`**

```tsx
"use client";
import { useImportStatus } from "@/lib/live/importStatus";

export function ImportStatus() {
  const s = useImportStatus();
  if (!s) return null;
  return (
    <p className="text-sm text-muted-foreground tabular-nums">
      Importing history… {s.imported.toLocaleString()}
      {s.target != null && <> of {s.target.toLocaleString()}</>}
    </p>
  );
}
```

- [ ] **Step 5: Rewrite `StatsHeader` in `page.tsx`**

```tsx
async function StatsHeader({ params }: { params: Params }) {
  const { username } = await params;
  const [session, allTime] = await Promise.all([getSession(), allTimeStats(username)]);
  const isOwner = session?.lbUsername === username;
  const empty = allTime.total_plays === 0;
  return (
    <header className="space-y-3">
      <ImportStatus />
      {!empty && <GlobalSearch username={username} />}
      {isOwner ? null : session ? (
        <p className="text-sm text-muted-foreground">
          Viewing @{username}&apos;s profile. <Link href={`/u/${session.lbUsername}/stats`} className="underline">Your dashboard</Link>.
        </p>
      ) : (
        <SignInButton returnTo={`/u/${username}/stats`} label="Sign in to see your own listens" />
      )}
    </header>
  );
}
```
Remove the `SyncButton` and `syncStateFor` imports and the now-unused `relTime` helper if nothing else uses it (`grep -n relTime app/u/\[username\]/stats/page.tsx`). Keep `syncStateFor` in `stats.ts` only if other callers exist (`grep -rn syncStateFor app lib`); otherwise delete it.

- [ ] **Step 6: Delete the old sync code**

```bash
git rm app/u/\[username\]/stats/SyncButton.tsx app/api/sync/\[username\]/route.ts \
  lib/sync/chainToken.ts app/api/lb/playing-now/\[username\]/route.ts
grep -rn "api/sync\|SyncButton\|chainToken\|syncJobs\|getPlayingNow\|playing-now" app lib components
```
Expected after cleanup: only `lib/db/schema.ts` (`syncJobs`, kept until Task 8). Remove `getPlayingNow`, `PlayingNowListen`, `PlayingNowResponse`, `PlayingNowListenT` from `lib/listenbrainz/client.ts`.

- [ ] **Step 7: Update copy and comments**

- `app/onboarding/page.tsx` ~L62: "We'll import your listens from LB and show you the dashboard. The first import takes a few minutes for a large library; after that your stats update live."
- `lib/db/queries/cache.ts` L16: "Aggregates only move when an ingest lands (app/api/listens/ingest) or the user changes a display setting (app/account/actions.ts), and both do."
- `lib/sync/keys.ts` top comment: "projection of listens the live poller has seen".

- [ ] **Step 8: Build, lint, test**

```bash
npx tsc --noEmit && npm run lint && npm test && npm run build
```
Expected: all clean.

- [ ] **Step 9: Commit**

```bash
git add -A app lib components
git commit -m "feat: replace the Sync button with a live poller so stats update while you listen"
```

---

### Task 7: Verify in a real browser against the local database

**Files:**
- Create: `e2e/live.spec.ts`
- Modify: `e2e/render.spec.ts` (`/u/tordar/stats` joins `PAGES`; update the "Never /stats as owner locally" comment)

**Interfaces:**
- Consumes: the running app on `http://localhost:3457` with `DATABASE_URL=$LOCAL_DB`.

- [ ] **Step 1: Write `e2e/live.spec.ts`**

LB is mocked with `page.route`, so the test controls what "new" means. The ingest endpoint is real (local DB) except in the 402 test.

```ts
import { test, expect } from "@playwright/test";

const USER = "tordar";
const NEW_TRACK = `E2E Live ${Date.now()}`;

function lbListen(ts: number) {
  return { listened_at: ts, track_metadata: { track_name: NEW_TRACK, artist_name: "E2E Artist",
    release_name: "E2E Album", additional_info: { duration_ms: 200000 }, mbid_mapping: {} } };
}

test("a new listen appears before ingest finishes", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  await page.route("https://api.listenbrainz.org/1/user/*/playing-now", (r) =>
    r.fulfill({ json: { payload: { listens: [], playing_now: false } } }));
  await page.route("https://api.listenbrainz.org/1/user/*/listens*", (r) =>
    r.fulfill({ json: { payload: { count: 1, listens: [lbListen(now)] } } }));
  // Hold the ingest response so we can prove the row shows without it.
  let release!: () => void;
  const held = new Promise<void>((res) => (release = res));
  await page.route("**/api/listens/ingest/**", async (r) => { await held; await r.fulfill({ json: { mode: "skipped" } }); });

  await page.goto(`/u/${USER}/stats`);
  await expect(page.getByText(NEW_TRACK).first()).toBeVisible({ timeout: 10_000 });
  release();
});

test("402 stops further ingest calls and keeps the projection", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  let ingestCalls = 0;
  let ts = now;
  await page.route("https://api.listenbrainz.org/1/user/*/playing-now", (r) =>
    r.fulfill({ json: { payload: { listens: [], playing_now: false } } }));
  await page.route("https://api.listenbrainz.org/1/user/*/listens*", (r) =>
    r.fulfill({ json: { payload: { count: 1, listens: [lbListen(++ts)] } } }));
  await page.route("**/api/listens/ingest/**", (r) => { ingestCalls++; return r.fulfill({ status: 402, json: {} }); });

  await page.clock.install();
  await page.goto(`/u/${USER}/stats`);
  await expect(page.getByText(NEW_TRACK).first()).toBeVisible();
  await page.clock.runFor(45_000); // three more polls
  expect(ingestCalls).toBe(1);
  await expect(page.getByText(NEW_TRACK).first()).toBeVisible();
});
```

- [ ] **Step 2: Start the app against the local DB**

```bash
rm -rf .next/dev
DATABASE_URL=$LOCAL_DB npm run build && DATABASE_URL=$LOCAL_DB PORT=3457 npm run start
```
(Background process. `SELF_HOST=true` if the local DB has no `users` row for `tordar`, so the paywall lets ingest through.)

- [ ] **Step 3: Run the e2e suites**

```bash
E2E_FIXTURES=<existing fixtures path> npm run e2e -- live.spec.ts render.spec.ts
```
Expected: all pass on both projects.

- [ ] **Step 4: Real round trip by hand**

1. Open `http://localhost:3457/u/tordar/stats`.
2. Scrobble one track on a real player.
3. Within ~15s after LB has it: the row shows in Recent listens and Total plays goes up by 1.
4. Within a few more seconds: `psql $LOCAL_DB -c "SELECT total_plays FROM agg_alltime WHERE user_name='tordar'"` shows +1, and a hard reload shows the same numbers.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test: cover live listens showing before ingest and the unpaid-owner stop"
```

---

### Task 8: Ship (each step needs explicit user confirmation)

**Files:**
- Later, separately: `drizzle/0016_*.sql` dropping `sync_jobs`

- [ ] **Step 1: Ask the user before migrating production.** The 0015 migration adds three nullable/defaulted columns and stamps `backfill_completed_at`. Nothing is dropped.

- [ ] **Step 2: Run the production migration and refill aggregates**

```bash
npm run db:migrate              # uses prod DATABASE_URL from .env
npx tsx scripts/bootstrap-aggregates.ts
```
Expected: `migrated`, then one line per user. This fills `covered_plays` and `member_artists`. Watch Neon storage: `member_artists` adds roughly 2–4 MB.

- [ ] **Step 3: Push and deploy (ask first)**, then on prod: open `/u/tordar/stats`, scrobble a track, confirm it appears within ~15s and survives a reload.

- [ ] **Step 4: Drop `sync_jobs` (ask first, separately)**

Remove `syncJobs` from `lib/db/schema.ts`, `npm run db:generate`, review that the SQL is only `DROP TABLE "sync_jobs"`, commit, migrate.

---

## Self-Review Notes

- Spec §1 data flow → Tasks 4, 5, 6. §2 incremental → Tasks 1–3. §3 removals → Task 6, 8. §4 errors → Task 4 (lock, throttle, rollback), Task 5 (`nextDelay`), Task 6 (visibility, 402), Task 7 (402 e2e). §5 testing → Tasks 3, 4, 7.
- Spec deviations, now reflected in the spec: `agg_alltime` is derived from the other tables plus a new `covered_plays` column instead of before/after cluster arithmetic; `agg_album.member_artists` added because 112 clusters span artists; playing-now moved to the browser, so `/api/lb/playing-now` is deleted.
