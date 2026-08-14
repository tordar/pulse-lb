# Self-Hostable pulse-lb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pulse-lb runnable by anyone on their own hardware (Docker + plain Postgres + MusicBrainz OAuth) with no Neon, Vercel, or Stripe dependency, while the hosted SaaS keeps running on the same codebase.

**Architecture:** Replace the Neon HTTP driver (`@neondatabase/serverless` + `drizzle-orm/neon-http`) with `postgres` (postgres-js) + `drizzle-orm/postgres-js`. postgres-js speaks the standard Postgres wire protocol, which both a self-hoster's local Postgres **and** Neon's pooled endpoint support — so one driver serves both targets. A `SELF_HOST=true` env flag bypasses the subscription gate; Stripe stays inert when its keys are absent. Ship a Dockerfile + docker-compose (app + Postgres, migrate-on-boot), a generalized `APP_URL` base-URL override for the sync self-continuation chain behind a reverse proxy, complete env docs, and an AGPL-3.0 license.

**Tech Stack:** Next.js 16, React 19, Drizzle ORM, postgres-js, Docker / docker-compose, Postgres 17.

**Branch:** This is a **single codebase — all of it lands on `main`.** Develop on a normal short-lived feature branch (`feat/self-hostable`) and merge to `main` once the prod-parity gate (Task 8) passes; the production SaaS then runs from the same `main` as self-hosters. There is no long-lived `self-host` branch — that permanent divergence is precisely the anti-pattern the postgres-js unification lets us avoid. The `/self-host` promo page (Task 16) is part of the same work; it can be its own commit/PR for review cleanliness but ships from the same codebase.

---

## ⚠️ Critical execution notes (read before starting)

1. **"Production unchanged" is FALSE — this swaps prod's DB driver too.** postgres-js over TCP is a different connection model than neon-http (HTTP). On Vercel/Fluid, prod MUST use Neon's **pooled** endpoint (`…-pooler…neon.tech`) with a small `max`. At ~50 users / manual sync the load is trivial and this is expected to work, but it is a **prod change requiring prod-parity verification (Task 8) before merge**, not a no-op. Keep `@neondatabase/serverless` installed until Task 8 passes (Task 13 removes it).

2. **No test framework exists, and we are NOT adding one.** The repo's CLAUDE.md forbids unrequested scope; the established verification pattern is `scripts/*.ts` run via `tsx`, plus `npm run build` for typechecking. Verification in this plan uses `scripts/check-aggregate-equivalence.ts` (byte-diffs recomputed-from-raw vs. stored aggregates — the purpose-built check for the rebuild rewrite), `npm run build`, and a live Docker/Neon-branch run. **Do not scaffold vitest/jest.**

3. **postgres-js scripts hang without `sql.end()`.** neon-http is stateless HTTP, so scripts just exit. postgres-js holds an open socket — every converted script (`migrate.ts`, `check-aggregate-equivalence.ts`, all `scripts/*.ts`) MUST call `await sql.end()` on the success path or the process never terminates. Confusing symptom; easy to miss.

4. **Don't cross-contaminate the two query forms in `rebuild.ts`.** The build functions mix tagged-template (`` sql`…${username}…` `` → `` tx`…${username}…` ``, where `${username}` is a parameter value) and dynamic-text (`sql.query(text, [username])` with `$1` placeholders → `tx.unsafe(text, [username])`). The text form interpolates **SQL fragments** (`withAlbumClusters(...)`, `nameKeyExpr(...)`) into the query string via plain JS before execution — those must NOT become tagged-template parameters. A silent bug hides here. Each conversion is shown explicitly below.

5. **`prepare: false` on every postgres-js client.** Neon's pooler (and any PgBouncer in transaction mode) breaks named prepared statements. Setting `prepare: false` is pooler-safe and harmless against local Postgres.

---

## File Structure

**Modified (runtime):**
- `lib/db/client.ts` — swap to postgres-js; export the shared raw client as `sqlClient` so no other module spins up its own pool.
- `lib/db/retry.ts` — `isRetryable()` rewritten for postgres-js error shapes (the current Neon-message matching never fires after the swap → silent loss of retries).
- `lib/db/aggregates/rebuild.ts` — Neon array-batch `sql.transaction([...])` → postgres-js `sqlClient.begin(async tx => …)`; build functions take `(tx, username)`.
- `lib/db/aggregates/albumCluster.ts` — drop the private `csql` Neon client; use shared `sqlClient.unsafe(text, params)`.
- `lib/auth/users.ts` — `isAllowedToSync()` returns `true` when `SELF_HOST=true`.
- `app/api/sync/[username]/route.ts` — generalize `baseUrl()` with an `APP_URL` override.

**Modified (scripts / config / docs):**
- `scripts/migrate.ts`, `scripts/check-aggregate-equivalence.ts` — postgres-js + `sql.end()`.
- `scripts/_long_tail.ts`, `scripts/_check_rgid.ts`, `scripts/analyze-album-clusters.ts`, `scripts/bootstrap-aggregates.ts`, `scripts/backfill-release-groups.ts`, `scripts/backfill-release-groups-deep.ts` — mechanical postgres-js + `sql.end()` conversion.
- `next.config.ts` — (unchanged in behavior; no standalone output to keep migrate-on-boot simple).
- `package.json` — add `postgres` dep, `engines`, `license`.
- `.env.example`, `README.md` — full self-host docs.

**Created:**
- `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.nvmrc`, `LICENSE`.

---

### Task 1: Branch, dependency, Node pin

**Files:**
- Create: `.nvmrc`
- Modify: `package.json`

- [ ] **Step 1: Create the feature branch** (short-lived; merges to `main`, not a permanent fork)

```bash
cd /Users/tordartommervik/Documents/code/pulse-lb
git checkout -b feat/self-hostable
```

- [ ] **Step 2: Install postgres-js (keep @neondatabase/serverless for now — see Critical Note 1)**

```bash
npm install postgres@^3.4.5
```

Expected: `package.json` `dependencies` gains `"postgres": "^3.4.5"`. `drizzle-orm/postgres-js` is already present (it ships inside the installed `drizzle-orm`).

- [ ] **Step 3: Pin Node and declare license in `package.json`**

Add these two top-level keys (after `"private": true,`):

```json
  "engines": {
    "node": ">=20"
  },
  "license": "AGPL-3.0-only",
```

- [ ] **Step 4: Create `.nvmrc`**

```
24
```

- [ ] **Step 5: Verify install + commit**

Run: `npm ls postgres`
Expected: prints `pulse-lb@0.1.0` → `postgres@3.4.x`, no errors.

```bash
git add package.json package-lock.json .nvmrc
git commit -m "chore: add postgres-js driver, pin node, declare AGPL license"
```

---

### Task 2: Convert the runtime DB client to postgres-js

**Files:**
- Modify: `lib/db/client.ts`

- [ ] **Step 1: Replace the file contents**

`lib/db/client.ts` (full new contents):

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// postgres-js speaks the standard Postgres wire protocol, so the SAME client
// connects to a self-hoster's local Postgres and to Neon's POOLED endpoint
// (…-pooler…neon.tech). prepare:false keeps us pooler-safe (Neon pooler /
// PgBouncer transaction mode reject named prepared statements). Keep `max`
// small — on Vercel/Fluid each instance holds its own pool.
const client = postgres(process.env.DATABASE_URL!, {
  max: Number(process.env.DATABASE_POOL_MAX ?? 5),
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });
export { schema };
// Raw client for the modules that need parameterized dynamic SQL or real
// transactions (aggregate rebuild, cluster queries). Sharing this one pool
// is deliberate: never construct a second postgres() in app code.
export { client as sqlClient };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors in `lib/db/client.ts`). Other files still referencing the old Neon clients are converted in later tasks; if `tsc` reports errors there, that is expected until Task 5 — confirm the only errors are in `rebuild.ts` / `albumCluster.ts` / `scripts`, not `client.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/client.ts
git commit -m "feat: connect via postgres-js (works for both local Postgres and Neon pooler)"
```

---

### Task 3: Rewrite retry detection for postgres-js errors

**Files:**
- Modify: `lib/db/retry.ts:19-34`

The current `isRetryable()` matches Neon-specific strings (`"neon:retryable"`, `"Control plane request failed"`). After the driver swap those never appear, so transient connection failures would stop being retried. postgres-js surfaces a string `.code` on connection errors and a Postgres SQLSTATE `.code` on server errors.

- [ ] **Step 1: Replace `isRetryable` (lines 19-34)**

Replace the entire `function isRetryable(e: unknown): boolean { … }` with:

```ts
// postgres-js connection-layer errors carry a string .code; Postgres server
// errors carry a 5-char SQLSTATE .code. Drizzle wraps these, so walk the
// cause chain collecting every code and message we can see.
const RETRYABLE_CODES = new Set<string>([
  // postgres-js connection layer
  "CONNECTION_ENDED",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  // transient Postgres SQLSTATEs
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "57P01", // admin_shutdown
  "08006", // connection_failure
  "08003", // connection_does_not_exist
  "53300", // too_many_connections
]);

function isRetryable(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const messages: string[] = [];
  let cur: unknown = e;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;
    const m = (cur as { message?: unknown }).message;
    if (typeof m === "string") messages.push(m);
    cur = (cur as { cause?: unknown }).cause;
  }
  const blob = messages.join(" | ");
  return /ECONN|ETIMEDOUT|fetch failed|socket hang up|Connection terminated|write CONNECTION/i.test(
    blob,
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `lib/db/retry.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/retry.ts
git commit -m "fix: detect postgres-js connection/SQLSTATE errors as retryable"
```

---

### Task 4: Convert `albumCluster.ts` cluster queries to postgres-js

**Files:**
- Modify: `lib/db/aggregates/albumCluster.ts:113-118` (imports + client), `:140`, `:195` (call sites)

`csql` is used ONLY inside this file (verified). We drop the private Neon client and use the shared `sqlClient`. `csql.query(text, params)` → `sqlClient.unsafe(text, params)`; postgres-js `.unsafe()` returns an array of row objects, so the existing `as {...}[]` casts stay valid.

- [ ] **Step 1: Replace the import block + client (lines 113-118)**

Find:

```ts
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { withRetry } from "@/lib/db/retry";

// Shared raw client for cluster queries (drizzle's neon-http wrapper can't
// run the $1-parameterised CTE text directly).
export const csql = neon(process.env.DATABASE_URL!) as NeonQueryFunction<false, false>;
```

Replace with:

```ts
import { sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
```

- [ ] **Step 2: Convert the `resolveAlbumCluster` call site (around line 140)**

Find `csql.query(` (inside `resolveAlbumCluster`) and change it to `sqlClient.unsafe(`. The arguments (the `withArtistAlbumClusters(...)` text and the `[username, artistName, releaseMbid, fallbackNameKey]` array) are unchanged.

- [ ] **Step 3: Convert the `artistClusteredAlbums` call site (around line 195)**

Find the second `csql.query(` (inside `artistClusteredAlbums`) and change it to `sqlClient.unsafe(`. Arguments unchanged.

- [ ] **Step 4: Verify no stragglers**

Run: `grep -n "csql\|neon" lib/db/aggregates/albumCluster.ts`
Expected: no matches (empty output).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no new errors in `albumCluster.ts` (errors may remain in `rebuild.ts` until Task 5).

```bash
git add lib/db/aggregates/albumCluster.ts
git commit -m "refactor: run cluster queries through shared postgres-js client"
```

---

### Task 5: Rewrite the aggregate rebuild transaction (highest-risk change)

**Files:**
- Modify: `lib/db/aggregates/rebuild.ts`

Neon's `sql.transaction([q1, q2, …])` bundles an ARRAY of statements into one atomic HTTP call. postgres-js has no array form — it uses `sqlClient.begin(async (tx) => { … })`, running every statement on one connection inside `BEGIN/COMMIT`. The build functions change from *returning* a query to *awaiting* against the transaction handle `tx`.

**Conversion rule (apply per build function — do NOT re-author the SQL):**
- The multi-line SQL string inside each build function is **copied verbatim from the current file**. Only the wrapper changes.
- Functions currently using `` sql`…` `` (tagged template) → `` await tx`…` `` (same template literal, `${username}` stays a parameter).
- Functions currently using `sql.query(text, [username])` → `await tx.unsafe(text, [username])` (the `text` string, including its `withAlbumClusters(...)` / `nameKeyExpr(...)` JS interpolation, is unchanged).

Mapping (from the current file):
- `buildAlltime` → `tx.unsafe` (currently `sql.query`)
- `buildYear`, `buildHour`, `buildDay`, `buildSong` → `tx` tagged template (currently `` sql`…` ``)
- `buildArtist` → `tx.unsafe` (currently `sql.query`)
- `buildAlbum` → `tx.unsafe` (currently `sql.query(ALBUM_AGG_INSERT, [username])`)

- [ ] **Step 1: Replace the header (lines 1-15) — imports, client, and `rebuildAll`**

Find lines 1-37 (the imports, the `const sql = neon(...)` comment block + client, and the `rebuildAll` function) and replace with:

```ts
import type { TransactionSql } from "postgres";
import { sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import {
  ALBUM_AGG_INSERT,
  ALBUM_CLUSTER_CTE,
  nameKeyExpr,
  withAlbumClusters,
} from "./albumCluster";

// One atomic rebuild of every aggregate table for a single user. postgres-js's
// begin() runs all statements on one connection inside BEGIN/COMMIT, so a
// mid-rebuild failure never leaves half-updated aggregate tables. (This also
// removes the old neon-http limitation that forced raw SQL: postgres-js
// supports real transactions.)
export async function rebuildAll(username: string): Promise<void> {
  await withRetry(() =>
    sqlClient.begin(async (tx) => {
      await tx`DELETE FROM agg_alltime WHERE user_name = ${username}`;
      await tx`DELETE FROM agg_year    WHERE user_name = ${username}`;
      await tx`DELETE FROM agg_hour    WHERE user_name = ${username}`;
      await tx`DELETE FROM agg_day     WHERE user_name = ${username}`;
      await tx`DELETE FROM agg_song    WHERE user_name = ${username}`;
      await tx`DELETE FROM agg_artist  WHERE user_name = ${username}`;
      await tx`DELETE FROM agg_album   WHERE user_name = ${username}`;

      await buildAlltime(tx, username);
      await buildYear(tx, username);
      await buildHour(tx, username);
      await buildDay(tx, username);
      await buildSong(tx, username);
      await buildArtist(tx, username);
      await buildAlbum(tx, username);
    }),
  );
}
```

- [ ] **Step 2: Convert `buildAlltime` (the `sql.query` form)**

Change the signature and wrapper only. New form:

```ts
async function buildAlltime(tx: TransactionSql, username: string) {
  // distinct_albums counts album CLUSTERS (case variants / reissues merged),
  // matching the albums list — see albumCluster.ts.
  await tx.unsafe(
    `
    INSERT INTO agg_alltime (
      user_name, total_plays, effective_ms,
      distinct_artists, distinct_albums, distinct_songs,
      first_played, last_played, duration_coverage_pct
    )
    SELECT
      $1::text,
      COUNT(*)::int,
      COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint,
      COUNT(DISTINCT l.artist_name)::int,
      (${withAlbumClusters(`SELECT COUNT(DISTINCT cluster_key)::int FROM clustered`)}),
      COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int,
      MIN(l.listened_at),
      MAX(l.listened_at),
      ROUND(
        100.0 * COUNT(*) FILTER (
          WHERE l.duration_ms IS NOT NULL OR r.length_ms IS NOT NULL
        ) / NULLIF(COUNT(*), 0),
        1
      )::float8
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = $1
    HAVING COUNT(*) > 0
  `,
    [username],
  );
}
```

- [ ] **Step 3: Convert `buildYear`, `buildHour`, `buildDay`, `buildSong` (tagged-template form)**

For each: change the signature to `async function buildXxx(tx: TransactionSql, username: string)` and replace the `` return sql`…` `` with `` await tx`…` ``. The SQL template body (everything between the backticks) is **unchanged from the current file**, including every `${username}` (postgres-js keeps these as bound parameters). Example — `buildYear`:

```ts
async function buildYear(tx: TransactionSql, username: string) {
  await tx`
    INSERT INTO agg_year (user_name, year, plays, hours)
    SELECT
      ${username}::text,
      EXTRACT(YEAR FROM l.listened_at)::int,
      COUNT(*)::int,
      ROUND(
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0) / 1000.0 / 3600,
        2
      )::float8
    FROM listens l
    LEFT JOIN recordings r ON r.mbid = l.recording_mbid
    WHERE l.user_name = ${username}
    GROUP BY EXTRACT(YEAR FROM l.listened_at)::int
  `;
}
```

Apply the identical wrapper change to `buildHour`, `buildDay`, and `buildSong`, copying their existing SQL bodies verbatim.

- [ ] **Step 4: Convert `buildArtist` (the `sql.query` form)**

Change signature to `async function buildArtist(tx: TransactionSql, username: string)`. Keep the `const clusterKey = …` line unchanged. Replace `return sql.query(` with `await tx.unsafe(`. The query text (with its `${nameKeyExpr("l")}` and `${clusterKey}` JS interpolations) and the `[username]` arg are unchanged.

- [ ] **Step 5: Convert `buildAlbum`**

```ts
async function buildAlbum(tx: TransactionSql, username: string) {
  // Clustered album grouping — see albumCluster.ts for the full rule set.
  await tx.unsafe(ALBUM_AGG_INSERT, [username]);
}
```

- [ ] **Step 6: Verify no Neon references remain + typecheck**

Run: `grep -n "neon\|@neondatabase\|sql\.transaction\|sql\.query" lib/db/aggregates/rebuild.ts`
Expected: no matches.

Run: `npx tsc --noEmit`
Expected: PASS for the whole app (scripts are converted next; if `scripts/*.ts` still error, that's fine — they're excluded from the Next build, but `tsc --noEmit` may include them. If so, confirm the ONLY remaining errors are in `scripts/` and proceed; they're fixed in Tasks 6-7).

- [ ] **Step 7: Commit**

```bash
git add lib/db/aggregates/rebuild.ts
git commit -m "refactor: rebuild aggregates in a postgres-js transaction"
```

---

### Task 6: Convert the migrator

**Files:**
- Modify: `scripts/migrate.ts`

- [ ] **Step 1: Replace the file contents**

```ts
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("migrated");
  await sql.end(); // postgres-js holds an open socket — without this the process hangs.
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it runs against a throwaway DB**

If a local Postgres is available, point `DATABASE_URL` at an empty DB and run `npm run db:migrate`; expected: prints `migrated` and **exits cleanly** (proves `sql.end()` works). If no local DB yet, defer this check to Task 12's `docker compose up` (migrate-on-boot exercises it).

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate.ts
git commit -m "refactor: run migrations via postgres-js migrator"
```

---

### Task 7: Convert the verification + remaining dev scripts

**Files:**
- Modify: `scripts/check-aggregate-equivalence.ts` (gate-critical)
- Modify: `scripts/_long_tail.ts`, `scripts/_check_rgid.ts`, `scripts/analyze-album-clusters.ts`, `scripts/bootstrap-aggregates.ts`, `scripts/backfill-release-groups.ts`, `scripts/backfill-release-groups-deep.ts`

These are standalone tsx scripts that each construct their own Neon client. They are not part of the running app, but `check-aggregate-equivalence.ts` is the Task 8 gate, and leaving the others broken is sloppy. The transform is mechanical and identical for each.

**Mechanical transform (apply to every file in this task):**
1. Replace the import line `import { neon, type NeonQueryFunction } from "@neondatabase/serverless";` (or `import { neon } from "@neondatabase/serverless";`) with `import postgres from "postgres";`.
2. Replace `const sql = neon(process.env.DATABASE_URL!) as NeonQueryFunction<false, false>;` (or the un-cast form) with `const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });`.
3. Replace any `sql.query(text, params)` call with `sql.unsafe(text, params)`.
4. Add `await sql.end();` on the normal completion path of `main()` (immediately before the final success `console.log` / `return`).

- [ ] **Step 1: Convert `scripts/check-aggregate-equivalence.ts`**

Apply lines 1-4 of the transform. This file uses only tagged-template `` sql`…` `` (no `.query`), so step 3 is a no-op here. For step 4, edit `main()` so the success path ends:

```ts
  await sql.end();
  console.log("\nAll checks passed.");
}
```

(The `if (fail > 0) { … process.exit(1); }` branch exits the process, so `sql.end()` on the failure path is unnecessary.)

- [ ] **Step 2: Convert the six remaining scripts**

For each of `_long_tail.ts`, `_check_rgid.ts`, `analyze-album-clusters.ts`, `bootstrap-aggregates.ts`, `backfill-release-groups.ts`, `backfill-release-groups-deep.ts`: apply the mechanical transform. Several wrap their work in a `main()`/IIFE that creates `sql` inside the function — put `await sql.end()` at the end of that same scope. For any that use `sql.query(...)`, convert to `sql.unsafe(...)` (step 3).

- [ ] **Step 3: Verify no Neon references remain anywhere**

Run: `grep -rn "neon\|@neondatabase" lib scripts app components | grep -v node_modules`
Expected: no matches (empty output).

Run: `npx tsc --noEmit`
Expected: PASS across the whole repo now.

- [ ] **Step 4: Commit**

```bash
git add scripts/
git commit -m "refactor: convert all dev/verification scripts to postgres-js"
```

---

### Task 8: PROD-PARITY VERIFICATION GATE (must pass before merge)

**Files:** none (verification only)

This is the gate the advisor flagged: prove the new driver (a) connects to Neon's pooled endpoint and (b) produces **byte-identical aggregates** to the old code. Run against a **Neon branch** (Neon's branching feature) — a zero-risk copy of prod data — never against prod directly.

- [ ] **Step 1: Create a Neon branch and grab its POOLED URL**

In the Neon console (or `neonctl branches create`), branch from the production branch. Copy the branch's **pooled** connection string (host contains `-pooler`), with `?sslmode=require`.

- [ ] **Step 2: Point local env at the Neon branch**

In `.env`, set `DATABASE_URL` to the Neon-branch pooled URL.

- [ ] **Step 3: Build (full typecheck of the app)**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 4: Exercise the pool with a real sync + rebuild**

Run: `npm run start` (in one terminal). In a browser, log in via MusicBrainz and trigger "Sync now" for `tordar` (or POST `/api/sync/tordar` with a valid session cookie). This runs many pooled reads plus the `rebuildAll` transaction through the new code path against Neon.
Expected: sync completes; no connection-pool errors in the server logs.

- [ ] **Step 5: Run the equivalence check against the same branch**

Run: `tsx scripts/check-aggregate-equivalence.ts tordar`
Expected: every line `PASS`, final `All checks passed.`, and the process **exits cleanly** (confirms `sql.end()` and that the postgres-js rebuild reproduced the exact aggregates the old neon-http code did).

- [ ] **Step 6: Record the result**

If all pass: the driver swap is verified prod-compatible. Proceed.
If pooling misbehaves (connection exhaustion / prepared-statement errors): **stop and escalate.** The documented fallback is an env-selected driver (neon-http in prod, postgres-js for self-host), which means two transaction code paths — it is the fallback, not the default. Do not silently implement it; surface the failure first.

- [ ] **Step 7: Restore env**

Reset `.env` `DATABASE_URL` to whatever it was before (or the local Docker URL for the next tasks). Delete the Neon branch when done.

No commit (verification only).

---

### Task 9: Self-host billing bypass

**Files:**
- Modify: `lib/auth/users.ts:69` (`isAllowedToSync`)

Authentication and authorization (session present + `session.lbUsername === username`) are enforced in the sync route *before* `isAllowedToSync` is called, so an early `true` here only removes the subscription/trial gate, not auth.

- [ ] **Step 1: Add the flag check as the first line of `isAllowedToSync`**

Find:

```ts
export function isAllowedToSync(user: DbUser | null): boolean {
  if (!user) return false;
```

Replace with:

```ts
export function isAllowedToSync(user: DbUser | null): boolean {
  // Self-host: no paywall. Auth/authorization is enforced upstream in the
  // sync route; this gate is purely about subscription status.
  if (process.env.SELF_HOST === "true") return true;
  if (!user) return false;
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add lib/auth/users.ts
git commit -m "feat: SELF_HOST flag bypasses the subscription gate"
```

---

### Task 10: Generalize the sync base URL for reverse proxies

**Files:**
- Modify: `app/api/sync/[username]/route.ts:26-31` (`baseUrl`)

The self-continuation chain self-POSTs to `baseUrl(req)`. Behind a self-hoster's reverse proxy, `req.nextUrl.origin` can be the internal origin (wrong scheme/host), breaking the chain. Add an explicit `APP_URL` override (generalizing the existing `VERCEL_PROJECT_PRODUCTION_URL` pattern).

- [ ] **Step 1: Replace `baseUrl`**

Find:

```ts
function baseUrl(req: NextRequest): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return req.nextUrl.origin;
}
```

Replace with:

```ts
function baseUrl(req: NextRequest): string {
  // Explicit override wins (self-host behind a reverse proxy: scheme+host, no
  // trailing slash). Then Vercel's production URL. Then the request origin.
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, "");
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return req.nextUrl.origin;
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add "app/api/sync/[username]/route.ts"
git commit -m "feat: APP_URL override for sync self-continuation behind a proxy"
```

---

### Task 11: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`, `.dockerignore`

Single-stage image that keeps full deps so the entrypoint can run Drizzle migrations (`tsx`) before `next start`. Image size is non-critical for self-hosters; simplicity of migrate-on-boot wins.

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
.next
.git
.env
.env.*
!.env.example
.vercel
*.tsbuildinfo
npm-debug.log*
.DS_Store
docs
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
FROM node:24-bookworm-slim AS app
WORKDIR /app

# Install ALL deps (tsx + drizzle-kit are needed for migrate-on-boot).
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Apply migrations against DATABASE_URL, then serve. Fails fast if the DB is
# unreachable, so docker-compose's depends_on healthcheck matters.
CMD ["sh", "-c", "npm run db:migrate && npm run start"]
```

- [ ] **Step 3: Build the image**

Run: `docker build -t pulse-lb:self-host .`
Expected: build completes through `npm run build`. (It will not run yet — needs env + DB from Task 12.)

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: Dockerfile with migrate-on-boot entrypoint"
```

---

### Task 12: docker-compose (app + Postgres) and end-to-end run

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: pulse
      POSTGRES_PASSWORD: pulse
      POSTGRES_DB: pulse
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pulse -d pulse"]
      interval: 5s
      timeout: 5s
      retries: 10

  app:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      # Local Postgres: no sslmode → postgres-js connects without TLS.
      DATABASE_URL: postgres://pulse:pulse@postgres:5432/pulse
      SELF_HOST: "true"
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in your .env}
      METABRAINZ_CLIENT_ID: ${METABRAINZ_CLIENT_ID:?}
      METABRAINZ_CLIENT_SECRET: ${METABRAINZ_CLIENT_SECRET:?}
      METABRAINZ_REDIRECT_URI: ${METABRAINZ_REDIRECT_URI:-http://localhost:3000/auth/callback}
      APP_URL: ${APP_URL:-http://localhost:3000}
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

- [ ] **Step 2: Provide compose env**

Ensure `.env` (in the repo root, git-ignored) has `JWT_SECRET`, `METABRAINZ_CLIENT_ID`, `METABRAINZ_CLIENT_SECRET`, and (if not using defaults) `METABRAINZ_REDIRECT_URI`, `APP_URL`. `docker compose` auto-loads `.env` for `${VAR}` substitution. Generate a secret if needed: `openssl rand -base64 48`.

- [ ] **Step 3: Bring it up**

Run: `docker compose up --build`
Expected: `postgres` becomes healthy; `app` runs `npm run db:migrate` (prints `migrated`) then `next start` on port 3000. This is the real-world test that migrate-on-boot and `sql.end()` work.

- [ ] **Step 4: Smoke test the running app**

Open `http://localhost:3000`, log in via MusicBrainz, sync a small public user, confirm stats render. (This exercises the full postgres-js path against local Postgres with `SELF_HOST=true` — no paywall.)

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: docker-compose for self-hosting (app + postgres, migrate-on-boot)"
```

---

### Task 13: Remove the Neon dependency (only after Task 8 passed)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm no code references remain**

Run: `grep -rn "neon\|@neondatabase" lib scripts app components | grep -v node_modules`
Expected: no matches. (If any remain, fix them before uninstalling.)

- [ ] **Step 2: Uninstall**

```bash
npm uninstall @neondatabase/serverless
```

- [ ] **Step 3: Rebuild to confirm nothing broke**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: drop @neondatabase/serverless (fully on postgres-js)"
```

---

### Task 14: Complete `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace the file contents**

```bash
# ── Database ──────────────────────────────────────────────────────────────
# Self-host: a standard Postgres URL. docker-compose provides one automatically;
# for a bare-metal run use e.g. postgres://pulse:pulse@localhost:5432/pulse
# Hosted/Neon: use the POOLED endpoint (host contains "-pooler") + sslmode=require:
#   postgres://user:pass@ep-xxx-pooler.eu-central-1.aws.neon.tech/db?sslmode=require
DATABASE_URL=
# Max connections in the postgres-js pool. Keep small on serverless. Default 5.
DATABASE_POOL_MAX=5

# ── Auth: MusicBrainz OAuth ───────────────────────────────────────────────
# Register an application: https://musicbrainz.org/account/applications
# The callback URL there MUST equal <APP_URL>/auth/callback
METABRAINZ_CLIENT_ID=
METABRAINZ_CLIENT_SECRET=
METABRAINZ_REDIRECT_URI=http://localhost:3000/auth/callback

# Session-cookie signing key. Generate one with: openssl rand -base64 48
JWT_SECRET=

# ── Self-host ─────────────────────────────────────────────────────────────
# Bypass the subscription/trial gate entirely (no paywall when self-hosting).
SELF_HOST=true
# Public base URL of this instance: scheme + host, no trailing slash.
# Required behind a reverse proxy so the sync self-continuation chain targets
# the correct origin. Example: https://pulse.example.com
APP_URL=http://localhost:3000

# ── Payments (hosted SaaS only — leave blank when self-hosting) ────────────
STRIPE_SECRET_KEY=
STRIPE_PRICE_ANNUAL=
STRIPE_PRICE_LIFETIME=
STRIPE_WEBHOOK_SECRET=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document all env vars for self-hosting"
```

---

### Task 15: README self-host section + license file

**Files:**
- Modify: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Create the AGPL-3.0 license file**

```bash
curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE
```

Expected: `LICENSE` exists and begins with `GNU AFFERO GENERAL PUBLIC LICENSE`. (If offline, paste the canonical AGPL-3.0 text manually.)

- [ ] **Step 2: Add a "Self-hosting" section to `README.md`**

Insert this section immediately after the `## Local setup` section:

````markdown
## Self-hosting

pulse-lb is a read-only client over the public ListenBrainz and MusicBrainz
APIs. You can run your own instance with Docker — you only need your own
Postgres (provided by the compose file) and a MusicBrainz OAuth application.

1. **Register a MusicBrainz OAuth app** at
   <https://musicbrainz.org/account/applications>. Set the callback URL to
   `http://localhost:3000/auth/callback` (or `<APP_URL>/auth/callback` for a
   real deployment). Note the client ID and secret.

2. **Configure env:**
   ```bash
   cp .env.example .env
   # Fill in METABRAINZ_CLIENT_ID, METABRAINZ_CLIENT_SECRET, and a JWT_SECRET
   # (openssl rand -base64 48). Leave the STRIPE_* vars blank. Keep SELF_HOST=true.
   # DATABASE_URL is set automatically by docker-compose.
   ```

3. **Run it:**
   ```bash
   docker compose up --build
   ```
   The app applies database migrations on boot, then serves on
   <http://localhost:3000>. `SELF_HOST=true` disables the subscription gate, so
   there is no paywall.

4. **Behind a reverse proxy** (e.g. Caddy/nginx with TLS), set `APP_URL` to your
   public URL (`https://pulse.example.com`) and update the MusicBrainz callback
   URL to match. `APP_URL` is required there so the incremental-sync
   self-continuation chain targets the right origin.

**Rate limits:** be a good citizen with the upstream APIs —
[MusicBrainz](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting) (≤1 req/s)
and [ListenBrainz](https://listenbrainz.readthedocs.io/en/latest/users/api/index.html#rate-limiting).
````

- [ ] **Step 3: Fix the stale "Tech" line**

In `README.md`, find:

```
- Neon Postgres (HTTP driver via `@neondatabase/serverless`)
```

Replace with:

```
- Postgres via postgres-js (works against local Postgres or Neon's pooled endpoint)
```

- [ ] **Step 4: Commit**

```bash
git add README.md LICENSE
git commit -m "docs: self-hosting guide + AGPL-3.0 license"
```

---

### Task 16: `/self-host` promo page

The live site advertises self-hosting and links the public repo. This is part of the same `main` codebase as everything above; keep it as its own commit (and optionally its own PR) only for review cleanliness.

**Files:** Create `app/self-host/page.tsx`

- [ ] Create a server component that explains the hosted-vs-self-host choice and links the public repo + the README self-hosting section. Skeleton:

```tsx
export const metadata = {
  title: "Self-host pulse-lb",
  description:
    "Run your own pulse-lb instance with Docker — your data, your server, no subscription.",
};

const REPO_URL = "https://github.com/tordar/pulse-lb";

export default function SelfHostPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 prose prose-invert">
      <h1>Self-host pulse-lb</h1>
      <p>
        Prefer to run it yourself? pulse-lb is open source (AGPL-3.0) and
        self-hostable with Docker. You bring your own Postgres and a MusicBrainz
        OAuth app — there is no subscription when you self-host.
      </p>
      <pre>
        <code>{`git clone ${REPO_URL}
cd pulse-lb
cp .env.example .env   # fill in MusicBrainz OAuth + JWT_SECRET
docker compose up --build`}</code>
      </pre>
      <p>
        Full instructions are in the{" "}
        <a href={`${REPO_URL}#self-hosting`}>project README</a>. Or skip the
        setup and <a href="/">use the hosted version</a>.
      </p>
    </main>
  );
}
```

- [ ] Add a link to `/self-host` from the site footer/nav (match the existing nav pattern in `app/`).
- [ ] Commit: `feat: promote self-hosting option on the live site`.

---

## Self-Review

**Spec coverage** (against the conversation requirements):
- Self-hostable on own hardware → Tasks 11-12 (Docker/compose), 14-15 (docs). ✓
- Plain Postgres instead of Neon → Tasks 2-7, 13. ✓
- Hosted SaaS keeps working on same codebase → Task 8 prod-parity gate; postgres-js↔Neon pooler. ✓
- Billing bypass via env flag → Task 9 (`SELF_HOST`). ✓
- Promote from production site → Task 16. ✓
- Single codebase on `main`, no divergent branch (short-lived `feat/self-hostable` merges to `main`); promo page included → header + Task 1 + Task 16. ✓
- Retry logic (advisor) → Task 3. ✓ Base-URL/proxy (advisor) → Task 10. ✓ `sql.end()` (advisor) → Tasks 6-7. ✓ License → Task 15. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above". The one intentional non-transcription is the unchanged SQL bodies in `rebuild.ts` Task 5 — explicitly instructed to copy verbatim and change only the wrapper, because re-transcribing ~200 lines of intricate SQL would *introduce* bugs, not prevent them. Representative full conversions (`buildAlltime`, `buildYear`, `buildAlbum`) are shown.

**Type/name consistency:** `sqlClient` is exported in Task 2 and imported in Tasks 4-5. `tx: TransactionSql` (from `postgres`) used consistently in Task 5. `isAllowedToSync` signature unchanged (Task 9). `baseUrl(req)` unchanged (Task 10). `SELF_HOST`, `APP_URL`, `DATABASE_POOL_MAX` env names match across Tasks 9, 10, 2, 12, 14.
