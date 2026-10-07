# Cache Components + Partial Prefetching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tab switches and detail pages in pulse-lb feel instant, and first loads get faster, by adopting Next 16.4 Cache Components and Partial Prefetching. Public content must never wait on the login cookie.

**Architecture:**
- Every `/u/[username]` page becomes a non-async wrapper: real heading plus `<Suspense>`, around a content component.
- The content component awaits `params`/`searchParams` and renders a cached subtree. Which cache directive (if any) that subtree uses is decided by a spike in Task 1.
- Login-only UI goes through `<OwnerOnly>` inside its own `<Suspense fallback={null}>`.
- The tabs and year nav prefetch fully. List rows prefetch fully only once the user shows intent (hover or touch).

**Tech Stack:** Next.js 16.4.0 (App Router, Turbopack), React 19.3, TypeScript, Tailwind 4, Drizzle + postgres-js against Neon, Playwright (`@playwright/test`, `@next/playwright`).

**Spec:** `docs/superpowers/specs/2026-10-07-cache-components-design.md`

## Global Constraints

- Next stays at exactly `16.4.0` and React at `19.3.0`. Do not upgrade.
- `next.config.ts` gets `cacheComponents: true` and `partialPrefetching: true`.
- No route may export `dynamic`, `revalidate`, `fetchCache` or `dynamicParams` when the plan is done. `grep -rn "export const \(dynamic\|revalidate\|fetchCache\|dynamicParams\)" app` must print nothing.
- `export const instant = false` is allowed only on `app/account/layout.tsx` and `app/account/page.tsx` when the plan is done (see the Task 7 ruling).
- Cache invalidation stays the tag `user:<username>`, cleared by the same callers as today:
  - `app/api/sync/[username]/route.ts`
  - `app/account/actions.ts`
  - `app/u/[username]/concerts/actions.ts`
  - the stats self-heal (it moves in Task 6).
- `userCached` (`lib/db/queries/cache.ts`) keeps its exact signature: `userCached<T>(username, keys, fn): Promise<T>`.
- Styling: reuse existing classes only, with no new fonts or colours. `animate-pulse` is the only motion. The base skeleton is `Sk` from `components/Skeletons.tsx` (`animate-pulse rounded-md bg-muted`).
- **Never load `/u/<user>/stats` as the owner against the prod DB from a local server.** The owner's sync probe can rebuild prod aggregates. Visitor `/stats` is allowed locally only after Task 6 lands. Never run `next dev` against prod.
- **Secrets:**
  - Copy prod `.env` into the worktree only for a local `next start` (`cp ~/Documents/code/pulse-lb/.env .env`).
  - Always `rm -f .env` afterwards. Never commit it.
  - Write minted owner tokens only under the scratchpad, and delete them afterwards.
- **Commits:**
  - One commit per task, in the format `<type>: <description>`.
  - End every commit message with:
    ```
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_014oYihLzKEmqH1zk2bVS5od
    ```
  - Never push. Task 10 stops for the user before pushing.
- Every task ends with all of these passing:
  - `npx tsc --noEmit`
  - `npm test`
  - `npm run lint`, with no new errors. Baseline: 2 errors in `app/account/page.tsx:95` and `InfiniteList.tsx:43`, plus 9 warnings.
  - `npm run build`
  - the render check (`npx playwright test e2e/render.spec.ts`, created in Task 2).

## Review Focus

1. **Owner UI leaking into a cached visitor render.** A logged-out visitor must never see Account, Edit, Add concert or SyncButton. The owner must always see them. Pinned by `e2e/render.spec.ts`, which runs as both visitor and owner (Task 2, extended in Tasks 5, 6 and 7).
2. **Unknown detail IDs.** `/u/tordar/artists/00000000-0000-0000-0000-000000000000` must show the not-found UI, not crash or spin forever. Pinned in Task 4.
3. **Query-string variants of a list.** `?q=radiohead` must show filtered results and `?view=list` the list layout. A changed `q` must re-render rather than serve the cached unfiltered list. Pinned in Task 3.
4. **Stats deep links.** `?year=2019&day=2019-06-01` must show that year and the day panel. Pinned in Task 6.
5. **Unknown username.** `/u/nobody-xyz/artists` and `/u/nobody-xyz/concerts` must render their empty states with status < 500. Pinned in Task 3 and Task 5.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `next.config.ts` | flags; `/u/:username` → `/stats` redirect | 2 |
| `components/OwnerOnly.tsx` (new) | renders children only for the profile owner | 2 |
| `components/Skeletons.tsx` | adds `Sk` export, `RowSkeleton`, `ListSkeleton`, `StatRowSkeleton`, `ControlsSkeleton` | 2 |
| `lib/nav.ts` | `navTabs(username)` + `ACCOUNT_TAB` | 2 |
| `app/u/[username]/PillNav.tsx` | tabs + `AccountPill` | 2 |
| `app/u/[username]/layout.tsx` | no cookie read; params in Suspense | 2 |
| `app/account/layout.tsx` | uses new PillNav API | 2 |
| `app/u/[username]/page.tsx` | deleted (replaced by redirect) | 2 |
| `e2e/*` (new) | Playwright config, token minting, render, instant and measure specs | 1, 2, 9 |
| `app/u/[username]/_lists/ListPage.tsx` (new) | shared songs/albums/artists page | 3 |
| `app/u/[username]/{songs,albums,artists}/page.tsx` | one-line wrappers | 3 |
| `app/u/[username]/{artists,albums,songs}/[id]/page.tsx` | wrapper + content split | 4 |
| `app/u/[username]/concerts/EditMode.tsx` (new) | edit-mode client context | 5 |
| `app/u/[username]/concerts/OwnerBar.tsx` (new) | owner add/edit bar | 5 |
| `app/u/[username]/concerts/{page,Timeline}.tsx` | public list + owner bar split | 5 |
| `lib/sync/healAggregates.ts` (new) | stale-aggregate claim + rebuild | 6 |
| `app/u/[username]/stats/page.tsx` | header/body/recent split; self-heal removed | 6 |
| `app/api/sync/[username]/route.ts` | calls `healStaleAggregates` from the probe | 6 |
| `app/page.tsx`, `app/onboarding/page.tsx`, `app/account/{layout,page}.tsx` | session/URL reads in Suspense | 7 |
| `components/IntentLink.tsx` (new) | full prefetch after hover/touch intent | 8 |
| `PillNav`, `TabBar`, `YearNav`, `InfiniteList`, `TopItemCard`, `TopList`, `SearchHits`, concerts `Timeline` | prefetch wiring | 8 |

---

### Task 1: Spike — which cache feeds a prefetched page (GATE)

Throwaway code on a throwaway branch. The output is a **ruling** written to the ledger, plus a baseline measurement. Nothing from the spike branch is merged.

**Files:**
- Create (spike branch only): `app/spike/[username]/page.tsx`, `app/spike/[username]/{a,b,c}/page.tsx`, `app/spike/data.ts`, `e2e/spike.spec.ts`
- Create (kept, on the main work branch): `e2e/playwright.config.ts`, `e2e/mint-token.mts`, `e2e/measure.spec.ts`

**Interfaces:**
- Produces: `RULING` ∈ {`A`, `B`, `C`, `STOP`} recorded in the ledger as `Ruling: cache variant <X> — <evidence>`. Tasks 3–7 read it.
  - **A** = no directive. Content components call `userCached` (`unstable_cache`) directly.
  - **C** = the content component has `"use cache"` + `cacheTag("user:"+username)` + `cacheLife("max")`, and calls `userCached` inside.
  - **B** = like C, but with `"use cache: remote"`.
- Produces: `e2e/playwright.config.ts` and `e2e/mint-token.mts` (used by every later task) and `e2e/measure.spec.ts` (used in Task 9).

- [ ] **Step 1: Install test tooling on the work branch**

```bash
npm i -D @playwright/test@1 @next/playwright@16.4.0
```

- If `@next/playwright@16.4.0` does not exist, run `npm view @next/playwright versions --json | tail -5` and install the newest `16.4.x`.
- If no `16.4.x` exists, install `@next/playwright@latest` and record the version in the ledger.
- Playwright's Chromium is already at `~/Library/Caches/ms-playwright/chromium_headless_shell-1243`. If `npx playwright test` complains about a missing browser, run `npx playwright install chromium-headless-shell`.

- [ ] **Step 2: Create `e2e/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

// Runs against an already-running server: `next start` locally (with the prod
// .env copied in) or prod itself. BASE_URL picks which.
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3457",
    colorScheme: "dark",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1100, height: 900 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
```

Add to `package.json` scripts: `"e2e": "playwright test -c e2e/playwright.config.ts"`.

- [ ] **Step 3: Create `e2e/mint-token.mts`**

```ts
// Prints a 1-hour owner session token for `tordar`, plus one real mbid per
// detail kind, as JSON. Reads DATABASE_URL and JWT_SECRET from .env. Output is
// a secret: write it under the scratchpad and delete it after the run.
import "dotenv/config";
import postgres from "postgres";
import { SignJWT } from "jose";

const s = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const [u] = await s`select id, mb_account_id from users where listenbrainz_username = 'tordar'`;
const [a] = await s`select artist_mbid from agg_artist where user_name = 'tordar' and scope = 0 and artist_mbid is not null order by plays desc limit 1`;
const [r] = await s`select release_mbid from agg_album where user_name = 'tordar' and scope = 0 and release_mbid is not null order by plays desc limit 1`;
const [g] = await s`select recording_mbid from agg_song where user_name = 'tordar' and scope = 0 and recording_mbid is not null order by plays desc limit 1`;
await s.end();
const tok = await new SignJWT({ uid: u.id, mbAccountId: Number(u.mb_account_id), lbUsername: "tordar" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
console.log(JSON.stringify({ tok, artist: a.artist_mbid, release: r.release_mbid, rec: g.recording_mbid }));
```

Every later run uses it like this:

```bash
SP=<scratchpad>
cp ~/Documents/code/pulse-lb/.env .env
npx tsx e2e/mint-token.mts > $SP/e2e.json
export E2E_FIXTURES=$SP/e2e.json
```

- [ ] **Step 4: Create `e2e/measure.spec.ts` and capture the BASELINE on prod**

```ts
import { test } from "@playwright/test";

// Time from tapping a tab to the first real list row, and from a cold
// navigation to first content. Logs numbers; asserts nothing. Run against prod
// (BASE_URL=https://pulse.tordar.no) before and after the migration.
const TABS = [
  { from: "/u/tordar/artists", to: "Songs", row: "/u/tordar/songs/" },
  { from: "/u/tordar/songs", to: "Albums", row: "/u/tordar/albums/" },
  { from: "/u/tordar/albums", to: "Concerts", row: "/u/tordar/artists/" },
];

test("tab switch: tap → first real row", async ({ page }, info) => {
  for (const t of TABS) {
    await page.goto(t.from, { waitUntil: "load" });
    await page.waitForTimeout(2500); // let viewport prefetches finish
    const nav = info.project.name === "phone" ? page.locator("nav[aria-label=Sections]").last() : page.locator("nav[aria-label=Sections]").first();
    const t0 = Date.now();
    await nav.getByRole("link", { name: t.to }).click();
    await page.locator(`main a[href^="${t.row}"], a[href^="${t.row}"]`).first().waitFor();
    console.log(`MEASURE ${info.project.name} ${t.from} → ${t.to}: ${Date.now() - t0} ms`);
  }
});

test("cold load: /u/tordar/artists", async ({ page }, info) => {
  const t0 = Date.now();
  const res = await page.goto("/u/tordar/artists", { waitUntil: "commit" });
  const ttfb = Date.now() - t0;
  await page.locator('a[href^="/u/tordar/artists/"]').first().waitFor();
  console.log(`MEASURE ${info.project.name} cold artists: ttfb ${ttfb} ms, content ${Date.now() - t0} ms, status ${res?.status()}`);
});
```

Run:

```bash
BASE_URL=https://pulse.tordar.no npm run e2e -- measure.spec.ts --reporter=line 2>&1 | grep MEASURE
```

- Run it 3 times.
- Write all the `MEASURE` lines to the ledger under `Baseline (before):`.
- Commit `e2e/` + `package.json` + `package-lock.json`: `test: add Playwright harness and baseline navigation timing`.

- [ ] **Step 5: Create the spike branch and spike code**

```bash
git switch -c spike/cache-storage
```

`next.config.ts`: add `cacheComponents: true, partialPrefetching: true` to `nextConfig`.

Then run the codemod so the rest of the app keeps building, and remove the segment configs:

```bash
npx @next/codemod@canary cache-components-instant-false ./app
grep -rln "export const \(dynamic\|revalidate\)" app | xargs sed -i '' '/^export const \(dynamic\|revalidate\) = /d'
```

`app/spike/data.ts`:

```ts
import { unstable_cache } from "next/cache";
import { sql } from "drizzle-orm";
import { execute } from "@/lib/db/client";

export async function spikeQuery(username: string): Promise<number> {
  console.log(`SPIKE_DB ${username} ${new Date().toISOString()}`);
  const r = await execute<{ c: number }>(sql`select count(*)::int as c from agg_artist where user_name = ${username}`);
  return r.rows[0]?.c ?? 0;
}

export const viaUnstable = (username: string) =>
  unstable_cache(() => spikeQuery(username), ["spike", username], { tags: [`spike:${username}`], revalidate: false })();
```

`app/spike/[username]/page.tsx`:

```tsx
import Link from "next/link";
import { Suspense } from "react";

async function Links({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return (
    <ul>
      {(["a", "b", "c"] as const).map((v) => (
        <li key={v}><Link href={`/spike/${username}/${v}`} prefetch>variant {v}</Link></li>
      ))}
    </ul>
  );
}

export default function SpikeIndex({ params }: { params: Promise<{ username: string }> }) {
  return <Suspense fallback={<p>…</p>}><Links params={params} /></Suspense>;
}
```

`app/spike/[username]/a/page.tsx` (variant A, no directive):

```tsx
import { Suspense } from "react";
import { viaUnstable } from "../../data";

async function Content({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <p data-testid="spike">A {await viaUnstable(username)}</p>;
}

export default function A({ params }: { params: Promise<{ username: string }> }) {
  return <Suspense fallback={<p data-testid="fallback">loading</p>}><Content params={params} /></Suspense>;
}
```

`app/spike/[username]/c/page.tsx` (variant C, `"use cache"` wrapping `unstable_cache`):

```tsx
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { viaUnstable } from "../../data";

async function Cached({ username }: { username: string }) {
  "use cache";
  cacheTag(`spike:${username}`);
  cacheLife("max");
  return <p data-testid="spike">C {await viaUnstable(username)}</p>;
}

async function Content({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <Cached username={username} />;
}

export default function C({ params }: { params: Promise<{ username: string }> }) {
  return <Suspense fallback={<p data-testid="fallback">loading</p>}><Content params={params} /></Suspense>;
}
```

`app/spike/[username]/b/page.tsx` (variant B, `"use cache: remote"` calling the DB directly):

```tsx
import { Suspense } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { spikeQuery } from "../../data";

async function Cached({ username }: { username: string }) {
  "use cache: remote";
  cacheTag(`spike:${username}`);
  cacheLife("max");
  return <p data-testid="spike">B {await spikeQuery(username)}</p>;
}

async function Content({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <Cached username={username} />;
}

export default function B({ params }: { params: Promise<{ username: string }> }) {
  return <Suspense fallback={<p data-testid="fallback">loading</p>}><Content params={params} /></Suspense>;
}
```

- [ ] **Step 6: Write `e2e/spike.spec.ts`**

```ts
import { test, expect } from "@playwright/test";
import { instant } from "@next/playwright";

for (const v of ["a", "b", "c"]) {
  test(`variant ${v}: prefetched link renders content with no fallback`, async ({ page }) => {
    await page.goto("/spike/tordar", { waitUntil: "load" });
    await page.waitForTimeout(3000); // prefetch on viewport
    await instant(page, async () => {
      await page.getByRole("link", { name: `variant ${v}` }).click();
      await page.waitForURL(`**/spike/tordar/${v}`);
      await expect(page.getByTestId("spike")).toBeVisible();
    });
  });
}
```

If `@next/playwright` was unavailable, use this body instead of `instant(...)`. It blocks the network after prefetch, so only already-prefetched content can render:

```ts
await page.route("**/*", (r) => r.abort());
await page.getByRole("link", { name: `variant ${v}` }).click();
await expect(page.getByTestId("spike")).toBeVisible({ timeout: 2000 });
```

- [ ] **Step 7: Build and run, then record each variant's result**

```bash
cp ~/Documents/code/pulse-lb/.env .env
npm run build 2>&1 | tee $SP/spike-build.log | tail -40
PORT=3457 npx next start -p 3457 > $SP/spike-server.log 2>&1 &
sleep 4
npm run e2e -- spike.spec.ts --project=desktop --reporter=line
```

Record per variant:
- **(1) build:** ok or error (copy the error text). Variant C may fail with an error about `unstable_cache` inside `"use cache"`; that is a valid result.
- **(2) instant test:** pass or fail.
- **(3) persistence:**
  1. `grep -c SPIKE_DB $SP/spike-server.log` after the first test run.
  2. Restart the server (`pkill -f "next start -p 3457"`, start it again) and rerun the spec.
  3. Count `SPIKE_DB` lines in the new log.
  4. **Zero new lines for A/C** means the `unstable_cache` layer persisted across the restart (`.next/cache`), which on Vercel is the persistent Data Cache.
  5. **For B**, new lines are expected locally (no remote handler). Also record whether the build or the server logged a warning about a missing remote handler; that is the self-host behaviour.

- [ ] **Step 8: Rule**

| Variant | build ok | instant pass |
|---|---|---|
| A | ✓ | ✓ | → **RULING A** (simplest; persistence already proven in prod) |
| A fails instant, C builds and passes | | | → **RULING C** |
| A and C fail, B passes | | | → **RULING B**. Vercel provides the remote handler. Self-host falls back to in-memory; record this in the ledger as a known cost. |
| none pass | | | → **RULING STOP**. Report the three results to the user and do not continue. |

- Write `Ruling: cache variant <X> — build: …, instant: …, SPIKE_DB after restart: …` to the ledger.
- Then clean up:

```bash
pkill -f "next start -p 3457"; rm -f .env $SP/e2e.json
git switch -           # back to the work branch
git branch -D spike/cache-storage
```

---

### Task 2: Foundation — flags, owner gate, header without cookies, skeleton parts, render check

After this task, the app builds with both flags on. Every page still behaves as today, because the pages are opted out with `instant = false` until their own task removes it.

**Files:**
- Modify: `next.config.ts`, `lib/nav.ts`, `app/u/[username]/PillNav.tsx`, `app/u/[username]/layout.tsx`, `app/account/layout.tsx`, `components/Skeletons.tsx`, every `page.tsx` that exports `dynamic`/`revalidate`
- Create: `components/OwnerOnly.tsx`, `lib/concerts/owner.test.ts`, `e2e/render.spec.ts`
- Delete: `app/u/[username]/page.tsx`

**Interfaces:**
- Consumes: `isOwner(session, username)` from `lib/concerts/owner.ts` (existing).
- Produces:
  - `OwnerOnly({ username, children }): Promise<ReactNode>`. It is a server component and must sit inside `<Suspense fallback={null}>`.
  - `Sk({ className })`, `RowSkeleton({ shape })`, `ListSkeleton({ rows, shape, view })`, `StatRowSkeleton({ count })`, `ControlsSkeleton()` from `components/Skeletons.tsx`.
  - `ACCOUNT_TAB: NavTab` and `navTabs(username): NavTab[]` from `lib/nav.ts`.
  - `PillNav({ username, children })` and `AccountPill()` from `app/u/[username]/PillNav.tsx`.
  - `e2e/render.spec.ts`, which later tasks extend.

- [ ] **Step 1: Test the owner predicate**

`lib/concerts/owner.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwner } from "./owner";

test("isOwner: only the matching session owns the profile", () => {
  assert.equal(isOwner({ lbUsername: "tordar" }, "tordar"), true);
  assert.equal(isOwner({ lbUsername: "someone" }, "tordar"), false);
  assert.equal(isOwner(null, "tordar"), false);
});
```

Run: `npm test`. Expected: PASS (37 tests). The predicate already exists; this test pins it now that it guards the layout.

- [ ] **Step 2: Flags and redirect**

`next.config.ts`: add these two keys inside `nextConfig`, after `allowedDevOrigins`:

```ts
  cacheComponents: true,
  partialPrefetching: true,
  // /u/<name> has no page of its own; Stats is the profile's front door.
  async redirects() {
    return [{ source: "/u/:username", destination: "/u/:username/stats", permanent: false }];
  },
```

Delete `app/u/[username]/page.tsx`.

- [ ] **Step 3: Remove segment configs and opt pages out for now**

```bash
grep -rln "export const \(dynamic\|revalidate\)" app | xargs sed -i '' '/^export const \(dynamic\|revalidate\) = /d'
npx @next/codemod@canary cache-components-instant-false ./app
git diff --stat
```

- The codemod must report `ok` for a non-zero file count.
- Then remove the `instant = false` lines it added to these two layouts:
  - `app/layout.tsx`. The root layout reads nothing per request; check that `grep -n "cookies\|headers\|searchParams" app/layout.tsx` prints nothing.
  - `app/u/[username]/layout.tsx`. This task converts it.
- Pages keep their `instant = false` until their own task removes it.
- `app/page.tsx` had `export const revalidate = 300`. Task 7 replaces it with `cacheLife`.

- [ ] **Step 4: `OwnerOnly`**

`components/OwnerOnly.tsx`:

```tsx
import { getSession } from "@/lib/auth/session";
import { isOwner } from "@/lib/concerts/owner";

/**
 * Renders its children only for the profile's owner. Reads the session cookie,
 * so it must sit inside <Suspense fallback={null}>: the public page around it
 * never waits on the cookie, and visitors get nothing — no flicker.
 */
export async function OwnerOnly({ username, children }: { username: string; children: React.ReactNode }) {
  return isOwner(await getSession(), username) ? <>{children}</> : null;
}
```

- [ ] **Step 5: Nav tabs without the account flag**

`lib/nav.ts`: replace `navTabs` with:

```ts
export const ACCOUNT_TAB: NavTab = { href: "/account", label: "Account", Icon: Settings };

export function navTabs(username: string): NavTab[] {
  const base = `/u/${encodeURIComponent(username)}`;
  return [
    { href: `${base}/stats`, label: "Stats", Icon: BarChart3 },
    { href: `${base}/songs`, label: "Songs", Icon: Music2 },
    { href: `${base}/albums`, label: "Albums", Icon: Disc3 },
    { href: `${base}/artists`, label: "Artists", Icon: Users },
    { href: `${base}/concerts`, label: "Concerts", Icon: Ticket },
  ];
}
```

Update the doc comment above it: it now says "The Account tab is appended by the owner-only `<AccountPill>`."

`app/u/[username]/PillNav.tsx`: replace the whole file:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCOUNT_TAB, isTabActive, navTabs, type NavTab } from "@/lib/nav";

/**
 * Desktop section nav — the centred pill in the header. Phones get <TabBar>
 * fixed to the bottom instead, so this hides below md. The owner's Account
 * pill arrives as a child (see <AccountPill>), streamed in after the cookie
 * check so the tabs never wait on it.
 */
export function PillNav({ username, children }: { username: string; children?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sections"
      className="hidden md:inline-flex items-center bg-card border border-card-border rounded-full p-1 shadow-sm"
    >
      {navTabs(username).map((tab) => (
        <PillLink key={tab.href} tab={tab} active={isTabActive(tab.href, pathname)} />
      ))}
      {children}
    </nav>
  );
}

export function AccountPill() {
  const pathname = usePathname();
  return <PillLink tab={ACCOUNT_TAB} active={isTabActive(ACCOUNT_TAB.href, pathname)} />;
}

function PillLink({ tab: { href, label, Icon }, active }: { tab: NavTab; active: boolean }) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
        active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"
      }`}
    >
      <Icon size={15} strokeWidth={2} />
      <span>{label}</span>
    </Link>
  );
}
```

`app/account/layout.tsx`:
- Change the import to `import { AccountPill, PillNav } from "../u/[username]/PillNav";`
- Change `<PillNav username={username} showAccount />` to `<PillNav username={username}><AccountPill /></PillNav>`.

- [ ] **Step 6: Skeleton parts**

`components/Skeletons.tsx`:
- Change `function Sk` to `export function Sk`.
- Append:

```tsx
/** One list row, same box as the real rows: 40px art, title + subtitle, value on the right. */
export function RowSkeleton({ shape = "square" }: { shape?: "square" | "circle" }) {
  return (
    <li className="flex items-center gap-3 py-2.5" aria-hidden>
      <Sk className={`size-10 shrink-0 ${shape === "circle" ? "rounded-full" : "rounded"}`} />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Sk className="h-3.5 w-1/2 max-w-56" />
        <Sk className="h-3 w-1/3 max-w-40" />
      </div>
      <Sk className="h-3.5 w-14 shrink-0" />
    </li>
  );
}

/** A list in either of the two list-page views (grid of cards or rows). */
export function ListSkeleton({
  rows = 8,
  shape = "square",
  view = "list",
}: {
  rows?: number;
  shape?: "square" | "circle";
  view?: "grid" | "list";
}) {
  if (view === "grid") {
    return (
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4" role="status" aria-label="Loading">
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} className="flex flex-col gap-3 p-3 rounded-lg border border-card-border bg-card">
            <Sk className={`w-full aspect-square ${shape === "circle" ? "rounded-full" : "rounded-md"}`} />
            <Sk className="h-3.5 w-3/4" />
            <Sk className="h-3 w-1/2" />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-border" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <RowSkeleton key={i} shape={shape} />)}
    </ul>
  );
}

/** The value-over-label stat row used on concerts and detail headers. */
export function StatRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-3 md:flex md:flex-wrap md:gap-x-8 md:gap-y-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Sk className="h-5 w-12" />
          <Sk className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Search box + view toggle placeholder for the list-page header row. */
export function ControlsSkeleton() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <Sk className="h-9 w-56" />
      <Sk className="h-9 w-20" />
    </div>
  );
}
```

- [ ] **Step 7: User layout without a cookie read**

Replace `app/u/[username]/layout.tsx` with the code below. The header markup and comments are unchanged; only the username, the nav and the owner bits move into Suspense.

```tsx
import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { AccountPill, PillNav } from "./PillNav";
import { TabBar } from "@/components/TabBar";
import { AccountLink } from "@/components/AccountLink";
import { NowPlaying } from "./NowPlaying";
import { OwnerOnly } from "@/components/OwnerOnly";
import { Sk } from "@/components/Skeletons";

type Params = Promise<{ username: string }>;

// No cookie read up here: everything public renders without waiting on the
// session. The username is URL data, so each piece that needs it awaits
// params inside its own Suspense — the header frame is part of the shared
// App Shell and paints instantly.
export default function UserLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-background/70 border-b border-border/60">
        {/* 3-column grid on md+ (1fr auto 1fr) keeps the pills dead-centre
            regardless of how wide the breadcrumb or now-playing pill is. */}
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap md:grid md:grid-cols-[1fr_auto_1fr]">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 md:justify-self-start"
          >
            <ChevronLeft size={16} />
            <span className="font-semibold text-foreground">pulse</span>
            <span className="text-subtle-foreground mx-0.5">/</span>
            <Suspense fallback={<Sk className="h-4 w-16" />}>
              <Username params={params} />
            </Suspense>
          </Link>
          <div className="hidden md:block md:justify-self-center">
            <Suspense fallback={<Sk className="h-[42px] w-[520px] rounded-full" />}>
              <HeaderNav params={params} />
            </Suspense>
          </div>
          <div className="min-w-0 md:justify-self-end flex items-center gap-2">
            <Suspense fallback={null}>
              <HeaderRight params={params} />
            </Suspense>
          </div>
        </div>
      </header>
      {/* Bottom padding clears the fixed phone tab bar (49pt row + the home
          indicator) so the last row is never trapped under it. */}
      <div className="max-w-7xl mx-auto px-6 py-6 pb-[calc(env(safe-area-inset-bottom)+5rem)] md:pb-6">
        {children}
      </div>
      <Suspense fallback={null}>
        <BottomTabs params={params} />
      </Suspense>
    </div>
  );
}

async function Username({ params }: { params: Params }) {
  const { username } = await params;
  return <span>{username}</span>;
}

async function HeaderNav({ params }: { params: Params }) {
  const { username } = await params;
  return (
    <PillNav username={username}>
      <Suspense fallback={null}>
        <OwnerOnly username={username}>
          <AccountPill />
        </OwnerOnly>
      </Suspense>
    </PillNav>
  );
}

async function HeaderRight({ params }: { params: Params }) {
  const { username } = await params;
  return (
    <>
      <NowPlaying username={username} />
      <Suspense fallback={null}>
        <OwnerOnly username={username}>
          <AccountLink />
        </OwnerOnly>
      </Suspense>
    </>
  );
}

async function BottomTabs({ params }: { params: Params }) {
  const { username } = await params;
  return <TabBar username={username} />;
}
```

- [ ] **Step 8: Render check spec**

`e2e/render.spec.ts`:

```ts
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fx = JSON.parse(readFileSync(process.env.E2E_FIXTURES!, "utf8")) as {
  tok: string; artist: string; release: string; rec: string;
};

// Never /stats as owner locally: the owner's sync probe can rebuild prod
// aggregates. Visitor /stats joins this list in Task 6.
export const PAGES = [
  "/",
  "/u/tordar/songs",
  "/u/tordar/albums",
  "/u/tordar/artists",
  "/u/tordar/concerts",
  `/u/tordar/artists/${fx.artist}`,
  `/u/tordar/albums/${fx.release}`,
  `/u/tordar/songs/${fx.rec}`,
];

async function check(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const res = await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  expect(res?.status(), path).toBeLessThan(500);
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
  expect(errors, path).toEqual([]);
}

test.describe("visitor", () => {
  for (const path of PAGES) {
    test(`renders ${path}`, async ({ page }) => {
      await check(page, path);
      await expect(page.getByRole("link", { name: "Account settings" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Account", exact: true })).toHaveCount(0);
    });
  }
});

test.describe("owner", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "pulse_session", value: fx.tok, url: baseURL! }]);
  });
  for (const path of PAGES.filter((p) => p.startsWith("/u/"))) {
    test(`renders ${path} with owner controls`, async ({ page }, info) => {
      await check(page, path);
      const account = info.project.name === "phone"
        ? page.getByRole("link", { name: "Account settings" })
        : page.getByRole("link", { name: "Account", exact: true });
      await expect(account).toBeVisible();
    });
  }
});
```

- [ ] **Step 9: Build and verify**

```bash
npx tsc --noEmit && npm test && npm run lint
cp ~/Documents/code/pulse-lb/.env .env && npm run build 2>&1 | tail -40
```

- Expected: the build succeeds.
- In the route table, every `/api/*` and `/auth/*` route is `ƒ` (dynamic). If any is `○`, it was prerendered: stop and fix it by reading the request in that handler.

```bash
PORT=3457 npx next start -p 3457 > $SP/server.log 2>&1 &
sleep 4
npx tsx e2e/mint-token.mts > $SP/e2e.json
E2E_FIXTURES=$SP/e2e.json npm run e2e -- render.spec.ts --reporter=line
pkill -f "next start -p 3457"; rm -f .env $SP/e2e.json
```

Expected: all pass on both projects.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: turn on cache components and stop the header waiting on the login cookie"
```

The commit message ends with the attribution block from Global Constraints.

---

### Task 3: List pages (songs, albums, artists)

**Files:**
- Create: `app/u/[username]/_lists/ListPage.tsx`
- Modify (replace whole files): `app/u/[username]/songs/page.tsx`, `app/u/[username]/albums/page.tsx`, `app/u/[username]/artists/page.tsx`
- Modify: `e2e/render.spec.ts`

**Interfaces:**
- Consumes:
  - the Task 1 ruling
  - `ListSkeleton`, `ControlsSkeleton` (Task 2)
  - `topSongs`/`topAlbums`/`topArtists({ username, query, page })` returning `{ items, hasMore }`
  - `InfiniteList({ kind, view, username, query, initialItems, initialHasMore })`.
- Produces: `ListPage({ kind, params, searchParams })` with `kind: "songs" | "albums" | "artists"`.

**Ruling application (applies to every `CACHE-RULING` line in Tasks 3–7):**
- **Ruling C:** keep the lines as written.
- **Ruling B:** change `"use cache"` to `"use cache: remote"`.
- **Ruling A:** delete the three `CACHE-RULING` lines and the `cacheLife`/`cacheTag` import.

- [ ] **Step 1: Add the failing render cases**

Append to `e2e/render.spec.ts`:

```ts
test("artists ?q= filters and ?view=list switches layout", async ({ page }) => {
  await page.goto("/u/tordar/artists?q=radiohead&view=list", { waitUntil: "load" });
  const rows = page.locator('ol a[href^="/u/tordar/artists/"]');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText(/radiohead/i);
  await page.goto("/u/tordar/artists?q=zzzz-no-match", { waitUntil: "load" });
  await expect(page.getByText('No artists match "zzzz-no-match".')).toBeVisible();
});

test("unknown username renders empty list states", async ({ page }) => {
  for (const kind of ["songs", "albums", "artists"]) {
    const res = await page.goto(`/u/nobody-xyz-404/${kind}`, { waitUntil: "load" });
    expect(res?.status()).toBeLessThan(500);
    await expect(page.getByText(new RegExp(`No ${kind} yet`))).toBeVisible();
  }
});
```

These pass today. They exist to stay green through the rewrite: run them now to confirm the baseline, using the Task 2 Step 9 commands.

- [ ] **Step 2: Shared list page**

`app/u/[username]/_lists/ListPage.tsx`:

```tsx
import { Suspense } from "react";
import { Disc3, Music2, Users, type LucideIcon } from "lucide-react";
import { cacheLife, cacheTag } from "next/cache"; // CACHE-RULING (import)
import { topAlbums, topArtists, topSongs } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { ViewToggle, type View } from "@/components/ViewToggle";
import { ControlsSkeleton, ListSkeleton } from "@/components/Skeletons";
import { InfiniteList } from "./InfiniteList";

type Kind = "songs" | "albums" | "artists";
type Params = Promise<{ username: string }>;
type SP = Promise<{ q?: string; view?: string }>;

const KINDS: Record<Kind, { title: string; Icon: LucideIcon; placeholder: string; shape: "square" | "circle" }> = {
  songs: { title: "Top songs", Icon: Music2, placeholder: "Search songs or artists…", shape: "square" },
  albums: { title: "Top albums", Icon: Disc3, placeholder: "Search albums or artists…", shape: "square" },
  artists: { title: "Top artists", Icon: Users, placeholder: "Search artists…", shape: "circle" },
};

const LOAD = { songs: topSongs, albums: topAlbums, artists: topArtists } as const;

/**
 * Songs, albums and artists share one page. The heading is static (App Shell);
 * the controls and the list depend on URL data and stream in — or arrive with
 * the tab's prefetch, so a tab switch shows real rows straight away.
 */
export function ListPage({ kind, params, searchParams }: { kind: Kind; params: Params; searchParams: SP }) {
  const { title, Icon, shape } = KINDS[kind];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Icon size={18} className="text-primary" /> {title}
        </h2>
        <Suspense fallback={<ControlsSkeleton />}>
          <Controls kind={kind} searchParams={searchParams} />
        </Suspense>
      </div>
      <Suspense fallback={<ListSkeleton shape={shape} view="grid" />}>
        <ListContent kind={kind} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Controls({ kind, searchParams }: { kind: Kind; searchParams: SP }) {
  const sp = await searchParams;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <SearchBox placeholder={KINDS[kind].placeholder} />
      <ViewToggle current={sp.view === "list" ? "list" : "grid"} />
    </div>
  );
}

async function ListContent({ kind, params, searchParams }: { kind: Kind; params: Params; searchParams: SP }) {
  const [{ username }, sp] = await Promise.all([params, searchParams]);
  const view: View = sp.view === "list" ? "list" : "grid";
  return <CachedList kind={kind} username={username} query={sp.q ?? ""} view={view} />;
}

async function CachedList({ kind, username, query, view }: { kind: Kind; username: string; query: string; view: View }) {
  "use cache"; // CACHE-RULING
  cacheTag(`user:${username}`); // CACHE-RULING
  cacheLife("max"); // CACHE-RULING
  const { Icon } = KINDS[kind];
  const { items, hasMore } = await LOAD[kind]({ username, query, page: 0 });
  if (items.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center text-sm text-muted-foreground gap-3">
        <Icon size={32} className="text-subtle-foreground" />
        {query ? `No ${kind} match "${query}".` : `No ${kind} yet — try syncing.`}
      </div>
    );
  }
  return (
    <InfiniteList
      kind={kind}
      view={view}
      username={username}
      query={query}
      initialItems={items}
      initialHasMore={hasMore}
    />
  );
}
```

If `tsc` rejects `LOAD[kind]` because the three loaders return different item types, add an explicit annotation:

```ts
const LOAD: Record<Kind, (o: { username: string; query: string; page: number }) => Promise<{ items: never[]; hasMore: boolean }>> = { … }
```

Also cast `initialItems={items as never}`, keeping the cast local to this file. `InfiniteList` already narrows by `kind`.

- [ ] **Step 3: The three pages become wrappers**

`app/u/[username]/artists/page.tsx` (whole file):

```tsx
import { ListPage } from "../_lists/ListPage";

export default function ArtistsPage(props: PageProps<"/u/[username]/artists">) {
  return <ListPage kind="artists" params={props.params} searchParams={props.searchParams} />;
}
```

`app/u/[username]/albums/page.tsx` (whole file):

```tsx
import { ListPage } from "../_lists/ListPage";

export default function AlbumsPage(props: PageProps<"/u/[username]/albums">) {
  return <ListPage kind="albums" params={props.params} searchParams={props.searchParams} />;
}
```

`app/u/[username]/songs/page.tsx` (whole file):

```tsx
import { ListPage } from "../_lists/ListPage";

export default function SongsPage(props: PageProps<"/u/[username]/songs">) {
  return <ListPage kind="songs" params={props.params} searchParams={props.searchParams} />;
}
```

`PageProps<...>` is Next's generated global type; it exists after `next build` or `next typegen`. If `tsc` can't find it, run `npx next typegen` first. If the `searchParams` type doesn't match `SP`, cast at the call site with `as never`.

- [ ] **Step 4: Build and verify**

Run the Task 2 Step 9 sequence.

- Expected: build ok, render spec all green, including the two new tests.
- The build must not report a blocking route for `/u/[username]/{songs,albums,artists}`.

- [ ] **Step 5: Commit**

`feat: stream list pages behind a shared shell so tab switches can be prefetched`

---

### Task 4: Detail pages (artist, album, song)

**Files:**
- Modify: `app/u/[username]/artists/[artistMbid]/page.tsx`, `app/u/[username]/albums/[releaseMbid]/page.tsx`, `app/u/[username]/songs/[recordingMbid]/page.tsx`, `e2e/render.spec.ts`

**Interfaces:**
- Consumes: the ruling; existing `DetailSkeleton` and the per-route `loading.tsx` files (unchanged); `artistDetail`, `albumDetail`, `songDetail`, `getShowListenSource`, `concertsForArtist`, `getReleaseMeta`.
- Produces: nothing new for other tasks.

**The pattern** (shown for artist; album and song use the same structure as in Steps 3 and 4):
1. Delete `export const instant = false` (added by the codemod in Task 2).
2. Rename the existing `export default async function ArtistDetailPage({ params })` to `async function ArtistDetail({ username, artistMbid }: { username: string; artistMbid: string })`.
3. Remove its first line (`const { username, artistMbid } = await params;`).
4. Add the cache lines as its first statements.
5. Add a new default export and an unwrap component.
6. The JSX body and the helper functions below stay byte-identical.

- [ ] **Step 1: Failing not-found case**

Append to `e2e/render.spec.ts`:

```ts
test("unknown detail ids show the not-found UI", async ({ page }) => {
  const zero = "00000000-0000-0000-0000-000000000000";
  for (const kind of ["artists", "albums", "songs"]) {
    await page.goto(`/u/tordar/${kind}/${zero}`, { waitUntil: "load" });
    await expect(page.locator("body")).toContainText(/could not be found|not found/i, { timeout: 15_000 });
  }
});
```

Run it against today's build. Expected: PASS (the baseline). Under streaming, the status may become 200, so the spec checks the text, not the code.

- [ ] **Step 2: Artist page**

At the top of `app/u/[username]/artists/[artistMbid]/page.tsx`:
- add `import { Suspense } from "react";`
- add `import { cacheLife, cacheTag } from "next/cache"; // CACHE-RULING (import)`
- add `import { DetailSkeleton } from "@/components/Skeletons";`

Replace the head of the old default export, through the `if (!detail) notFound();` line, with:

```tsx
type Params = Promise<{ username: string; artistMbid: string }>;

export default function ArtistDetailPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<DetailSkeleton artwork={false} />}>
      <Unwrap params={params} />
    </Suspense>
  );
}

async function Unwrap({ params }: { params: Params }) {
  const { username, artistMbid } = await params;
  return <ArtistDetail username={username} artistMbid={artistMbid} />;
}

async function ArtistDetail({ username, artistMbid }: { username: string; artistMbid: string }) {
  "use cache"; // CACHE-RULING
  cacheTag(`user:${username}`); // CACHE-RULING
  cacheLife("max"); // CACHE-RULING
  const [detail, showSource, seenLive] = await Promise.all([
    artistDetail(username, artistMbid),
    getShowListenSource(username).catch(() => false),
    concertsForArtist(username, artistMbid).catch(() => []),
  ]);
  if (!detail) notFound();
```

Everything from `const { header, years, topSongs, topAlbums, recent } = detail;` to the end of the file is unchanged.

Check the existing `app/u/[username]/artists/[artistMbid]/loading.tsx` for its `DetailSkeleton` props and reuse the same props here.

- [ ] **Step 3: Album page**

Same pattern in `app/u/[username]/albums/[releaseMbid]/page.tsx`:
- `type Params = Promise<{ username: string; releaseMbid: string }>; type SP = Promise<{ name?: string; artist?: string }>;`
- The default export takes `{ params, searchParams }` and renders `<Suspense fallback={<DetailSkeleton />}><Unwrap params={params} searchParams={searchParams} /></Suspense>`.
- `Unwrap` awaits both promises with `Promise.all`, then renders `<AlbumDetail username={…} releaseMbid={…} name={sp.name} artist={sp.artist} />`.
- `AlbumDetail({ username, releaseMbid, name, artist })` starts with the three `CACHE-RULING` lines.
- Every `sp.name`/`sp.artist` in the old body becomes `name`/`artist`.
- **`getReleaseMeta` is an uncached DB read.**
  - Under ruling C or B it gets cached along with the component. That is fine: release metadata never changes for an mbid.
  - Under ruling A no change is needed.

- [ ] **Step 4: Song page**

Same pattern in `app/u/[username]/songs/[recordingMbid]/page.tsx`:
- `type Params = Promise<{ username: string; recordingMbid: string }>; type SP = Promise<{ name?: string; artist?: string }>;`
- `SongDetail({ username, recordingMbid, name, artist })` with the three `CACHE-RULING` lines.
- `sp.*` becomes the props.

- [ ] **Step 5: Build, verify, commit**

- Run the Task 2 Step 9 sequence. Expected: all green, including the not-found test.
- Commit: `feat: stream artist, album and song pages from cache behind a skeleton`

---

### Task 5: Concerts — public list cached, owner bar streamed

**Files:**
- Create: `app/u/[username]/concerts/EditMode.tsx`, `app/u/[username]/concerts/OwnerBar.tsx`
- Modify: `app/u/[username]/concerts/page.tsx`, `app/u/[username]/concerts/Timeline.tsx`, `e2e/render.spec.ts`

**Interfaces:**
- Consumes: `OwnerOnly`, `StatRowSkeleton`, `ListSkeleton`, the ruling; `concertsTimeline(username): Promise<{ concerts, festivals, art }>`; `topArtistsSeen(username)`; `buildTimeline`; `concertStats`.
- Produces:
  - `ConcertsEditProvider({ children })`
  - `useEditMode(): { editMode, setEditMode, editing, setEditing, close }`
  - the `Editing` type (moved from `Timeline.tsx` and exported from `EditMode.tsx`)
  - `OwnerBar({ username, festivals })`
  - `Timeline({ username, years, festivals, art })`. The `isOwner` prop is removed.

- [ ] **Step 1: Failing owner/visitor cases**

Append to `e2e/render.spec.ts`:

```ts
test("concerts: visitor sees the list but no owner controls", async ({ page }) => {
  await page.goto("/u/tordar/concerts", { waitUntil: "load" });
  await expect(page.getByText("Shows", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add concert" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
});

test("concerts: owner gets the bar and edit mode", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "pulse_session", value: fx.tok, url: baseURL! }]);
  await page.goto("/u/tordar/concerts", { waitUntil: "load" });
  await expect(page.getByRole("button", { name: "Add concert" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  expect(await page.getByRole("button", { name: "Edit", exact: true }).count()).toBeGreaterThan(10);
});

test("concerts: unknown user renders the empty state", async ({ page }) => {
  const res = await page.goto("/u/nobody-xyz-404/concerts", { waitUntil: "load" });
  expect(res?.status()).toBeLessThan(500);
  await expect(page.getByText("No concerts yet.")).toBeVisible();
});
```

Run these against the Task 4 build. Expected: PASS (baseline behaviour).

- [ ] **Step 2: Edit-mode context**

`app/u/[username]/concerts/EditMode.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import type { Concert } from "@/lib/db/schema";

export type Editing =
  | { kind: "new-concert" } | { kind: "new-festival" }
  | { kind: "concert"; id: string } | { kind: "festival"; id: string }
  | { kind: "add-to-festival"; festivalId: string }
  | { kind: "from-setlist"; initial: Partial<Concert> };

type EditModeValue = {
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  close: () => void;
};

const Ctx = createContext<EditModeValue | null>(null);

// Shared by the owner-only bar (which toggles it) and the public list (which
// only reads it). Visitors never render the bar, so editMode stays false.
export function ConcertsEditProvider({ children }: { children: React.ReactNode }) {
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const router = useRouter();
  const close = useCallback(() => { setEditing(null); router.refresh(); }, [router]);
  return <Ctx.Provider value={{ editMode, setEditMode, editing, setEditing, close }}>{children}</Ctx.Provider>;
}

export function useEditMode(): EditModeValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditMode must be used inside <ConcertsEditProvider>");
  return v;
}
```

- [ ] **Step 3: Owner bar**

`app/u/[username]/concerts/OwnerBar.tsx`. The markup is moved verbatim from `Timeline.tsx` lines 54–75:

```tsx
"use client";

import type { Festival } from "@/lib/db/schema";
import { ConcertForm } from "./ConcertForm";
import { FestivalForm } from "./FestivalForm";
import { SetlistImport } from "./SetlistImport";
import { useEditMode } from "./EditMode";

export function OwnerBar({ username, festivals }: { username: string; festivals: Festival[] }) {
  const { editMode, setEditMode, editing, setEditing, close } = useEditMode();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setEditing({ kind: "new-concert" })}
          className="text-sm rounded-md bg-primary text-primary-foreground px-3 py-1.5">Add concert</button>
        <button type="button" onClick={() => setEditing({ kind: "new-festival" })}
          className="text-sm rounded-md border border-card-border px-3 py-1.5">Add festival</button>
        <button type="button" onClick={() => setEditMode(!editMode)} aria-pressed={editMode}
          className={`text-sm rounded-md border border-card-border px-3 py-1.5 ml-auto ${editMode ? "bg-muted" : ""}`}>
          {editMode ? "Done" : "Edit"}
        </button>
      </div>
      <SetlistImport username={username} festivals={festivals}
        onLoaded={(initial) => setEditing({ kind: "from-setlist", initial })} />
      {editing?.kind === "new-concert" && <ConcertForm username={username} festivals={festivals} onDone={close} />}
      {editing?.kind === "from-setlist" && (
        <ConcertForm key={`${editing.initial.setlistUrl}`} username={username} festivals={festivals}
          initial={editing.initial} onDone={close} />
      )}
      {editing?.kind === "new-festival" && <FestivalForm username={username} onDone={close} />}
    </div>
  );
}
```

- [ ] **Step 4: Timeline reads the context**

In `app/u/[username]/concerts/Timeline.tsx`:
- Remove the `Editing` type (it is now imported), and remove `isOwner` from `TimelineProps`.
- Remove these imports:
  - `useCallback`, `useRouter`
  - `SetlistImport`
  - `useState`, from the top-level component only. `FestivalRow` and `FestivalImage` still use it, so keep the import.
- Add `import { useEditMode, type Editing } from "./EditMode";`
- Replace the `Timeline` function header and its owner block (lines 45–75) with:

```tsx
export function Timeline({ username, years, festivals, art }: TimelineProps) {
  const { editMode, editing, setEditing, close } = useEditMode();
  const ctx: Ctx = { username, festivals, art, editMode, editing, setEditing, close };

  return (
    <div className="space-y-8">
```

Everything from `{years.length === 0 && …}` onward is unchanged. `ConcertForm` and `FestivalForm` are still used by the rows, so keep those imports.

- [ ] **Step 5: Concerts page**

Replace `app/u/[username]/concerts/page.tsx` with the code below. `Stat` is unchanged and the stats markup is moved verbatim.

```tsx
import Link from "next/link";
import { Suspense } from "react";
import { Ticket } from "lucide-react";
import { cacheLife, cacheTag } from "next/cache"; // CACHE-RULING (import)
import { concertsTimeline, topArtistsSeen } from "@/lib/db/queries/concerts";
import { buildTimeline } from "@/lib/concerts/timeline";
import { concertStats } from "@/lib/concerts/stats";
import { OwnerOnly } from "@/components/OwnerOnly";
import { ListSkeleton, StatRowSkeleton } from "@/components/Skeletons";
import { Timeline } from "./Timeline";
import { OwnerBar } from "./OwnerBar";
import { ConcertsEditProvider } from "./EditMode";

type Params = Promise<{ username: string }>;

export default function ConcertsPage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Ticket size={18} className="text-primary" /> Concerts
        </h2>
        <Suspense fallback={<StatRowSkeleton count={5} />}>
          <Unwrap params={params} part="stats" />
        </Suspense>
      </header>
      <ConcertsEditProvider>
        <div className="space-y-8">
          <Suspense fallback={null}>
            <Unwrap params={params} part="owner" />
          </Suspense>
          <Suspense fallback={<ListSkeleton shape="circle" />}>
            <Unwrap params={params} part="list" />
          </Suspense>
        </div>
      </ConcertsEditProvider>
    </div>
  );
}

async function Unwrap({ params, part }: { params: Params; part: "stats" | "owner" | "list" }) {
  const { username } = await params;
  if (part === "stats") return <ConcertStatsRow username={username} />;
  if (part === "list") return <ConcertList username={username} />;
  return (
    <OwnerOnly username={username}>
      <OwnerBarLoader username={username} />
    </OwnerOnly>
  );
}

async function OwnerBarLoader({ username }: { username: string }) {
  const { festivals } = await concertsTimeline(username);
  return <OwnerBar username={username} festivals={festivals} />;
}

async function ConcertStatsRow({ username }: { username: string }) {
  "use cache"; // CACHE-RULING
  cacheTag(`user:${username}`); // CACHE-RULING
  cacheLife("max"); // CACHE-RULING
  const [{ concerts, festivals }, topSeen] = await Promise.all([
    concertsTimeline(username),
    topArtistsSeen(username).catch(() => []),
  ]);
  if (concerts.length === 0) return null;
  const stats = concertStats(concerts, festivals.length);
  const top500 = topSeen.find((t) => t.top === 500);
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm md:flex md:flex-wrap md:gap-x-8 md:gap-y-2">
      <Stat label="Shows" value={stats.shows.toLocaleString()} />
      <Stat label="Artists" value={stats.artists.toLocaleString()} />
      <Stat label="Festivals" value={stats.festivals.toLocaleString()} />
      {top500 && <Stat label="Of top 500" value={top500.seen.toLocaleString()} />}
      {stats.mostSeen && (
        <Stat
          className="col-span-2"
          label={`Seen most · ${stats.mostSeen.count}×`}
          value={stats.mostSeen.name}
          href={stats.mostSeen.mbid ? `/u/${encodeURIComponent(username)}/artists/${stats.mostSeen.mbid}` : null}
        />
      )}
    </div>
  );
}

async function ConcertList({ username }: { username: string }) {
  "use cache"; // CACHE-RULING
  cacheTag(`user:${username}`); // CACHE-RULING
  cacheLife("max"); // CACHE-RULING
  const { concerts, festivals, art } = await concertsTimeline(username);
  const years = buildTimeline(concerts, festivals);
  if (years.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center text-sm text-muted-foreground gap-3">
        <Ticket size={32} className="text-subtle-foreground" />
        No concerts yet.
      </div>
    );
  }
  return <Timeline username={username} years={years} festivals={festivals} art={art} />;
}

function Stat({ label, value, href, className = "" }: {
  label: string; value: string; href?: string | null; className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      {href ? (
        <Link href={href} className="block truncate text-base font-semibold text-foreground hover:underline">{value}</Link>
      ) : (
        <div className="truncate text-base font-semibold text-foreground tabular-nums">{value}</div>
      )}
      <div className="text-xs text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
```

- Under ruling C or B, `Timeline` is a client component rendered from a cached server component. Its props (`years`, `festivals`, `art`) are plain data, so this is allowed.
- `Timeline` also imports `deleteConcert`/`deleteFestival` server actions directly. That is fine, because they are module imports, not props.

- [ ] **Step 6: Build, verify, commit**

- Run the Task 2 Step 9 sequence. Expected: all green, including the three concerts tests.
- Also take screenshots of `/u/tordar/concerts` as visitor and as owner (desktop and phone) into the scratchpad, and compare them with the pre-task look. They must be identical apart from loading order.
- Commit: `feat: serve the concerts list from cache and stream the owner bar separately`

---

### Task 6: Stats — cached panels, live header and recent listens, self-heal moved to the sync probe

**Files:**
- Create: `lib/sync/healAggregates.ts`
- Modify: `app/u/[username]/stats/page.tsx`, `app/api/sync/[username]/route.ts`, `e2e/render.spec.ts`

**Interfaces:**
- Consumes: the ruling, `PageSkeleton`, `ListSkeleton`, `OwnerOnly` (not used here: the stats header needs the session itself, see below).
- Produces: `healStaleAggregates(username: string, previous: Date | null): Promise<void>`.

- [ ] **Step 1: Move the self-heal**

`lib/sync/healAggregates.ts`. The logic is copied from `stats/page.tsx` lines 88–117:

```ts
import { revalidateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { schema, execute } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { rebuildAll } from "@/lib/db/aggregates/rebuild";

/**
 * Self-heal stale aggregates: when listens are newer than the last rebuild
 * (e.g. a sync chain died before its terminal rebuild), rebuild them.
 * Claim-first stamp: the UPDATE only returns a row for whoever moves the stamp
 * forward, so concurrent callers don't all kick off their own rebuild.
 *
 * This used to run from the stats page render; it now runs from the owner's
 * sync-status probe so pages can be served from cache.
 */
export async function healStaleAggregates(username: string, previous: Date | null): Promise<void> {
  const claimed = await withRetry(() =>
    execute<{ user_name: string }>(sql`
      UPDATE ${schema.syncState}
      SET last_aggregated_at = NOW()
      WHERE user_name = ${username}
        AND last_listened_at IS NOT NULL
        AND (last_aggregated_at IS NULL OR last_aggregated_at < last_listened_at)
      RETURNING user_name
    `),
  );
  if ((claimed as unknown as { rows: unknown[] }).rows.length === 0) return;
  try {
    await rebuildAll(username);
    revalidateTag(`user:${username}`, "default");
  } catch (e) {
    // Put the old stamp back — otherwise a failed rebuild leaves the claim
    // committed and staleness permanently undetectable (the sync route's
    // terminal rebuild checks the same condition).
    await withRetry(() =>
      execute(sql`
        UPDATE ${schema.syncState}
        SET last_aggregated_at = ${previous}
        WHERE user_name = ${username}
      `),
    );
    throw e;
  }
}
```

In `app/api/sync/[username]/route.ts`:
- add `import { healStaleAggregates } from "@/lib/sync/healAggregates";`
- in `GET`, directly after the `const aggStale = …;` statement, add:

```ts
  // The stats page used to self-heal on render; it is served from cache now,
  // so the owner's page-load probe does it instead.
  if (probe && aggStale) {
    after(() => healStaleAggregates(username, state?.lastAggregatedAt ?? null));
  }
```

`after` is already imported in that file.

- [ ] **Step 2: Add the stats render cases**

In `e2e/render.spec.ts`, add visitor-only stats tests. Never add stats to the owner list.

```ts
test("stats (visitor) renders and deep-links to a year and day", async ({ page }) => {
  await check(page, "/u/tordar/stats");
  await expect(page.getByText("listening time")).toBeVisible();
  await expect(page.getByText("Recent listens")).toBeVisible();
  await page.goto("/u/tordar/stats?year=2019&day=2019-06-01", { waitUntil: "load" });
  await expect(page.getByText("Saturday, June 1, 2019")).toBeVisible();
  await expect(page.getByRole("button", { name: /sync/i })).toHaveCount(0);
});
```

- [ ] **Step 3: Split the page**

Restructure `app/u/[username]/stats/page.tsx`:
- Remove the imports of `after`, `revalidateTag`, `rebuildAll`, and the `export const instant = false` line.
- Add:
  - `import { Suspense } from "react";`
  - `import { cacheLife, cacheTag } from "next/cache"; // CACHE-RULING (import)`
  - `import { ListSkeleton, PageSkeleton, Sk } from "@/components/Skeletons";`
- Replace the default export (old lines 42–330) with the components below. `DayDetailBlock`, `YearColumn`, `StatTile`, `SectionHeading` and the format helpers below them are unchanged.

```tsx
type Params = Promise<{ username: string }>;
type SP = Promise<{ year?: string; day?: string }>;

export default function StatsPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  return (
    <div className="space-y-8">
      <Suspense fallback={<Sk className="h-5 w-40" />}>
        <StatsHeader params={params} />
      </Suspense>
      <Suspense fallback={<PageSkeleton />}>
        <StatsBody params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// Live, per request: sync state, and who is looking (owner gets SyncButton).
async function StatsHeader({ params }: { params: Params }) {
  const { username } = await params;
  const [session, state, allTime] = await Promise.all([
    getSession(),
    withRetry(() => db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) })),
    allTimeStats(username),
  ]);
  const isOwner = session?.lbUsername === username;
  const empty = allTime.total_plays === 0;
  return (
    <header className="space-y-3">
      {/* … old lines 186–216 verbatim: the isOwner ? <SyncButton …/> : <div …/>
          block and the visitor / signed-in-elsewhere line … */}
    </header>
  );
}

async function StatsBody({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ username }, sp] = await Promise.all([params, searchParams]);
  const showSource = await getShowListenSource(username).catch(() => false);
  const yearParam = parseInt(sp.year ?? "", 10) || null;
  return (
    <StatsPanels
      username={username}
      yearParam={yearParam}
      day={sp.day ?? null}
      dayDetail={
        sp.day ? (
          <Suspense fallback={null}>
            <DayDetailLoader username={username} day={sp.day} yearParam={yearParam} showSource={showSource} />
          </Suspense>
        ) : null
      }
      recent={
        <Suspense fallback={<ListSkeleton rows={10} />}>
          <RecentListens username={username} showSource={showSource} />
        </Suspense>
      }
    />
  );
}
```

Write the `StatsHeader` body as the literal JSX from old lines 186–216, not a comment. It references `isOwner`, `state`, `username`, `empty`, `session`, `relTime` and `GlobalSearch`, all of which are in scope.

`StatsPanels` holds the cached aggregates. It replaces old lines 58–83 and 120–328, minus the recent-listens query and section and the `dayDetail` call:

```tsx
async function StatsPanels({
  username, yearParam, day, dayDetail, recent,
}: {
  username: string;
  yearParam: number | null;
  day: string | null;
  dayDetail: React.ReactNode;
  recent: React.ReactNode;
}) {
  "use cache"; // CACHE-RULING
  cacheTag(`user:${username}`); // CACHE-RULING
  cacheLife("max"); // CACHE-RULING
  const [allTime, yearly, hourly, years] = await Promise.all([
    allTimeStats(username),
    yearlyListening(username),
    hourlyDistribution(username),
    availableYears(username),
  ]);
  const empty = allTime.total_plays === 0;
  const selectedYear = years.length
    ? Math.max(years[years.length - 1], Math.min(years[0], yearParam ?? years[0]))
    : null;
  // … old lines 127–184 verbatim (yearIdx/next/prev, the Promise.all for
  //   daily/yearSongs/yearAlbums/yearArtists WITHOUT the dayDetail entry —
  //   destructure 4 values and use `[[], [], [], []]` for the no-year branch —
  //   then qs, u, songItems, artistItems, albumItems) …
  return (
    <>
      {/* … old lines 219–327 verbatim, with these three edits:
            1. `activeDate={sp.day ?? null}` → `activeDate={day}`
            2. `{daySummary && <DayDetailBlock … />}` → `{dayDetail}`
            3. the whole "Recent listens" <section> → `{recent}` …*/}
    </>
  );
}

async function DayDetailLoader({
  username, day, yearParam, showSource,
}: { username: string; day: string; yearParam: number | null; showSource: boolean }) {
  const summary = await dayDetail(username, day);
  if (!summary) return null;
  return <DayDetailBlock username={username} day={summary} year={yearParam ?? Number(day.slice(0, 4))} showSource={showSource} />;
}

async function RecentListens({ username, showSource }: { username: string; showSource: boolean }) {
  const recent = await withRetry(() =>
    execute<{ listened_at: string; track_name: string; artist_name: string; release_name: string | null; source: string | null }>(sql`
      SELECT listened_at, track_name, artist_name, release_name, source
      FROM ${schema.listens}
      WHERE user_name = ${username}
      ORDER BY listened_at DESC LIMIT 10
    `),
  );
  const rows = (recent as unknown as { rows: { listened_at: string; track_name: string; artist_name: string; release_name: string | null; source: string | null }[] }).rows;
  return (
    <section className="space-y-3">
      <SectionHeading icon={Clock}>Recent listens</SectionHeading>
      <ul className="divide-y divide-border text-sm">
        {/* … old lines 307–331 verbatim (rows.map …), with recentRows → rows … */}
      </ul>
    </section>
  );
}
```

As above, the `… verbatim` markers mean: paste those exact old lines there. They are not literal comments to leave in the file. When the paste is done, the file must contain no `…` comment markers. `grep -n "…" app/u/[username]/stats/page.tsx` must show only user-facing strings.

**Notes:**
- `empty` must render the old "No listens yet" block instead of the sections. Keep the old `empty ? … : <>…</>` shape inside `StatsPanels`.
- `day` and `yearParam` are serializable props, so they become part of the cache key. `dayDetail` and `recent` are passed-through JSX slots and are not part of the key.
- Under ruling A, `StatsPanels` has no directive, and the slots still work.
- If the build reports `Date.now()`/`new Date()` used during prerender in `StatsHeader` (from `relTime`), it is already behind `getSession()`, which makes it request-time. If the error persists, add `import { connection } from "next/server";` and `await connection();` as the first line of `StatsHeader`.

- [ ] **Step 4: Build, verify, commit**

- Run the Task 2 Step 9 sequence. Visitor `/stats` is now in the spec; owner `/stats` is still excluded.
- Expected: all green, including the deep-link test.
- `grep -n "rebuildAll\|after(" app/u/[username]/stats/page.tsx` must print nothing.
- Commit: `feat: serve stats from cache and move the aggregate self-heal into the owner's sync probe`

---

### Task 7: Home, onboarding, account

**Files:**
- Modify: `app/page.tsx`, `app/onboarding/page.tsx`, `app/account/layout.tsx`, `app/account/page.tsx`, `e2e/render.spec.ts`

**Interfaces:**
- Consumes: the ruling.
- Produces: none.

**Ruling recorded here (deviation from the spec):**
- `/account` keeps `export const instant = false` on its layout and page. It is owner-only, outside the tab flow, and redirects without a session.
- Splitting it gains nothing for the stated goals.
- Cost if wrong: `/account` stays a blocking render, as it is today.

- [ ] **Step 1: Home render cases**

Append to `e2e/render.spec.ts`:

```ts
test("home: visitor sees Sign in, owner sees Signed in as", async ({ page, context, baseURL }) => {
  await page.goto("/", { waitUntil: "load" });
  await expect(page.getByText("Sign in with ListenBrainz")).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
  await context.addCookies([{ name: "pulse_session", value: fx.tok, url: baseURL! }]);
  await page.goto("/", { waitUntil: "load" });
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("home ?error=upstream shows the banner; onboarding ?error=notfound too", async ({ page }) => {
  await page.goto("/?error=upstream", { waitUntil: "load" });
  await expect(page.getByText("ListenBrainz looks unreachable right now.")).toBeVisible();
  await page.goto("/onboarding?error=notfound&username=zz", { waitUntil: "load" });
  await expect(page.getByText(/couldn.t find/)).toBeVisible();
});
```

Run them against the Task 6 build. Expected: PASS (baseline).

- [ ] **Step 2: Home page**

In `app/page.tsx`:
- Delete `export const instant = false`.
- Add `import { Suspense } from "react";` and `import { cacheLife, cacheTag } from "next/cache";`.
- Replace `Home` with:

```tsx
type SP = Promise<{ error?: string; reason?: string; username?: string }>;

export default function Home({ searchParams }: { searchParams: SP }) {
  const live = paymentsConfigured();
  return (
    <main className="min-h-screen flex flex-col">
      <Suspense fallback={null}>
        <ErrorBanners searchParams={searchParams} />
      </Suspense>
      <Hero />
      <DemoSection />
      <FeatureGrid />
      <HowItWorks />
      <Suspense fallback={<PricingCards live={live} signedIn={false} />}>
        <SessionPricing live={live} />
      </Suspense>
      <Suspense fallback={<BrowseForm defaultValue="" />}>
        <BrowseFormFromUrl searchParams={searchParams} />
      </Suspense>
      <SiteFooter />
    </main>
  );
}

async function ErrorBanners({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const upstreamErr = sp.error === "upstream";
  const authErr = sp.error === "auth";
  if (!upstreamErr && !authErr) return null;
  return (
    /* … old lines 45–68 verbatim: the <div className="max-w-3xl …"> block … */
  );
}

async function SessionPricing({ live }: { live: boolean }) {
  return <PricingCards live={live} signedIn={!!(await getSession())} />;
}

async function BrowseFormFromUrl({ searchParams }: { searchParams: SP }) {
  return <BrowseForm defaultValue={(await searchParams).username ?? ""} />;
}
```

`Hero` becomes session-free. Change its signature to `function Hero()` and replace its two session-dependent fragments as follows:
1. **The `{session ? (<form …Sign out…/>) : (<SignInButton …/>)}` block** becomes:

```tsx
<Suspense fallback={<span className="inline-block h-11 w-56" aria-hidden />}>
  <HeroAuthButton />
</Suspense>
```

2. **The `{session ? (<p>Signed in as …</p>) : …}` block** (old line 120 onward) becomes:

```tsx
<Suspense fallback={null}>
  <HeroSignedInAs />
</Suspense>
```

Then add:

```tsx
async function HeroAuthButton() {
  const session = await getSession();
  return session ? (
    /* old Sign-out <form> verbatim */
  ) : (
    <SignInButton label="Sign in with ListenBrainz" />
  );
}

async function HeroSignedInAs() {
  const session = await getSession();
  if (!session) return /* old else-branch of that block verbatim, or null if it had none */;
  return (/* old "Signed in as" <p> verbatim, using session */);
}
```

`DemoSection` loads its own data. This replaces the old page-level `revalidate = 300`:

```tsx
async function DemoSection() {
  "use cache";
  cacheTag(`user:${DEMO_USERNAME}`);
  cacheLife("minutes");
  const demo = await safeAllTime(DEMO_USERNAME);
  /* … old DemoSection body verbatim, unchanged … */
}
```

**Notes:**
- `"use cache"` is used here regardless of the ruling. It is the documented replacement for `revalidate`. If ruling A was taken because `"use cache"` failed to build, use `"use cache: remote"` here instead.
- Replace the `DemoStats` type alias usages if `tsc` complains. It was only used for the old prop.
- As in Task 6, every `… verbatim` comment marks a paste and must not survive in the file.

- [ ] **Step 3: Onboarding**

In `app/onboarding/page.tsx`:
- Delete `export const instant = false`.
- Make `OnboardingPage` non-async with `{ searchParams }`.
- Move the `errorBanner` computation into `async function ErrorBanner({ searchParams }) { const { error, username } = await searchParams; return /* old ternary verbatim */; }`.
- Render it as `<Suspense fallback={null}><ErrorBanner searchParams={searchParams} /></Suspense>` where `{errorBanner}` was.
- Add `import { Suspense } from "react";`.

- [ ] **Step 4: Account**

- `app/account/layout.tsx` and `app/account/page.tsx` keep the `instant = false` the codemod added (see the ruling above).
- Confirm that `app/account/page.tsx` no longer exports `dynamic`.
- No other change.

- [ ] **Step 5: Leftover check**

```bash
grep -rn "export const \(dynamic\|revalidate\|fetchCache\|dynamicParams\)" app   # expect nothing
grep -rln "export const instant = false" app                                       # expect only app/account/layout.tsx, app/account/page.tsx
```

- [ ] **Step 6: Build, verify, commit**

- Run the Task 2 Step 9 sequence. Expected: all green.
- Also `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3457/account` → `307` (redirect to login) as visitor.
- Commit: `feat: stream session and URL bits on home and onboarding so the rest prerenders`

---

### Task 8: Prefetching — full on tabs and year nav, on intent for rows

**Files:**
- Create: `components/IntentLink.tsx`
- Modify: `app/u/[username]/PillNav.tsx`, `components/TabBar.tsx`, `app/u/[username]/stats/YearNav.tsx`, `app/u/[username]/_lists/InfiniteList.tsx`, `components/TopItemCard.tsx`, `components/TopList.tsx`, `components/SearchHits.tsx`, `app/u/[username]/concerts/Timeline.tsx`

**Interfaces:**
- Produces: `IntentLink(props: React.ComponentProps<typeof Link>)`, a drop-in for `next/link`'s `Link`.

**Deviation from the spec, recorded as a ruling:**
- The spec named `router.prefetch` on hover. The Next 16.4 docs give the Partial-Prefetching-native form, `prefetch={active ? true : "auto"}` (`docs/01-app/02-guides/prefetching.md`, "Hover-triggered prefetch").
- Use that form: it keeps the App Shell prefetch before intent.
- Cost if wrong: none, since the behaviour is the same.

- [ ] **Step 1: IntentLink**

`components/IntentLink.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * <Link> that prefetches the shared App Shell up front and the destination's
 * cached content only once the user shows intent (pointer over it, or a finger
 * down on it). Lists render 50+ rows; full-prefetching every one would be a
 * server call — and possibly a Neon wake-up — per row nobody opens.
 */
export function IntentLink({ onMouseEnter, onTouchStart, ...props }: React.ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? true : "auto"}
      onMouseEnter={(e) => { setIntent(true); onMouseEnter?.(e); }}
      onTouchStart={(e) => { setIntent(true); onTouchStart?.(e); }}
    />
  );
}
```

- [ ] **Step 2: Full prefetch on tabs and year nav**

Add the `prefetch` prop to these links:
- `app/u/[username]/PillNav.tsx` → the `<Link>` in `PillLink`
- `components/TabBar.tsx` → the tab `<Link>`
- `app/u/[username]/stats/YearNav.tsx` → both `<Link>`s

- [ ] **Step 3: Intent prefetch on list rows**

In each file below:
1. Replace `import Link from "next/link";` with `import { IntentLink } from "@/components/IntentLink";`, or add the import if `Link` is still used elsewhere in the file.
2. Change the row link tags from `<Link`/`</Link>` to `<IntentLink`/`</IntentLink>`.

Files and lines:
- `app/u/[username]/_lists/InfiniteList.tsx`: the row links at about lines 203, 241 and 272.
- `components/TopItemCard.tsx`: line 76.
- `components/TopList.tsx`: line 170.
- `components/SearchHits.tsx`: line 76. It keeps `onClick={onPick}`.
- `app/u/[username]/concerts/Timeline.tsx`: the `Link` in `Row`.

Then check that no `next/link` import is left unused: `npx tsc --noEmit && npm run lint`.

- [ ] **Step 4: Build, verify, commit**

- Run the Task 2 Step 9 sequence. Expected: all green.
- Commit: `feat: prefetch tabs fully and list rows on hover or touch`

---

### Task 9: Instant-navigation tests and after-measurement

**Files:**
- Create: `e2e/instant.spec.ts`

- [ ] **Step 1: Write the regression tests**

`e2e/instant.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { instant } from "@next/playwright";

// A tab switch must show real rows from the prefetch alone — no network wait.
const SWITCHES = [
  { from: "/u/tordar/artists", tab: "Songs", row: 'a[href^="/u/tordar/songs/"]' },
  { from: "/u/tordar/songs", tab: "Albums", row: 'a[href^="/u/tordar/albums/"]' },
  { from: "/u/tordar/albums", tab: "Artists", row: 'a[href^="/u/tordar/artists/"]' },
  { from: "/u/tordar/artists", tab: "Concerts", row: "text=Shows" },
];

for (const s of SWITCHES) {
  test(`instant: ${s.from} → ${s.tab}`, async ({ page }, info) => {
    await page.goto(s.from, { waitUntil: "load" });
    await page.waitForTimeout(3000); // viewport prefetch of the tabs
    const nav = page.locator("nav[aria-label=Sections]").nth(info.project.name === "phone" ? 1 : 0);
    await instant(page, async () => {
      await nav.getByRole("link", { name: s.tab }).click();
      await expect(page.locator(s.row).first()).toBeVisible();
    });
  });
}
```

- On the phone project, `PillNav` is hidden, so `nth(1)` is the `TabBar`. If the `TabBar` renders first in the DOM, swap the indices.
- If `@next/playwright` was unavailable (Task 1 Step 1), use the network-abort body from Task 1 Step 6.

- [ ] **Step 2: Run against the local production build**

Run the Task 2 Step 9 sequence, with `npm run e2e -- instant.spec.ts` in place of the render spec.

- Expected: all 8 tests pass (4 switches × 2 projects).
- If one fails, the failing destination has an uncached read before its rows. Find it from the build output or the dev overlay. Fix it by moving the read behind its own `<Suspense>` or caching it, then rerun.

- [ ] **Step 3: Commit**

`test: guard instant tab switches against regressions`

(The after-measurement runs in Task 10, against prod.)

---

### Task 10: Ship (STOPS for the user before the push)

**Files:** none.

**Ruling (deviation from the spec):**
- The spec said to verify on a Vercel preview. However, `vercel env ls` shows `DATABASE_URL` only for Production and Development, so a preview deploy has no database.
- Instead, verification uses `next start` locally against the prod DB (Tasks 2–9) plus a post-deploy check on prod. This is the procedure used for every change this session.
- Owner `/stats` is checked only on prod.
- Cost if wrong: an issue that only shows on Vercel's runtime would surface on prod, and is rolled back with `git revert`.

- [ ] **Step 1: Final local pass**

1. Run `npx tsc --noEmit && npm test && npm run lint && npm run build`.
2. Run `npm run e2e` (all specs) on the local server.
3. Take screenshots of every page in its loading state and its loaded state, desktop and phone, into the scratchpad.
4. Show the skeleton/loaded pairs to the user.

- [ ] **Step 2: Stop and ask the user**

Report the results and the screenshots. Ask: "Push to main?" Do not push without a yes.

- [ ] **Step 3: After a yes — push and watch the deploy**

```bash
git push origin HEAD:main
gh api repos/:owner/:repo/commits/$(git rev-parse HEAD)/statuses --jq '.[0].state'   # repeat until success
```

- [ ] **Step 4: Prod checks**

1. Run `BASE_URL=https://pulse.tordar.no E2E_FIXTURES=… npm run e2e -- render.spec.ts instant.spec.ts`.
   - The owner token must be minted with prod `JWT_SECRET`, which `mint-token.ts` does.
2. Open `/u/tordar/stats` as owner on prod once and confirm that SyncButton shows.
3. Run the `measure.spec.ts` command from Task 1 Step 4 three times, and write the `After:` lines to the ledger next to the baseline.
4. Report baseline vs after to the user.
5. Remind them to check Neon's dashboard tomorrow to confirm the endpoint still suspends between visits.
