# Cache Components + Partial Prefetching — design

Date: 2026-10-07 · Next.js 16.4.0 / React 19.3.0 (shipped c5e7312)

## Goal

1. **Priority:** switching tabs and opening artist/album/song pages feels instant.
2. **Bonus:** first loads from a shared link are faster.

All content is public. Only a few small things depend on login: the Account link, the owner pill, and the concerts owner bar and edit mode. Those must never block the public content from rendering.

## Current state

- `app/u/[username]/layout.tsx` calls `getSession()`, which reads a cookie. That makes every user page dynamic.
- 10 pages export `dynamic = "force-dynamic"` and/or `revalidate`:
  - `/`
  - `/account`
  - `/u/[username]/{songs,albums,artists,concerts,stats}`
  - the three detail pages.
- Pages that call `getSession()` themselves:
  - `/` (hero)
  - `/u/[username]/concerts` (owner mode)
  - `/u/[username]/stats`.
- Data reads go through `userCached` (`lib/db/queries/cache.ts`).
  - It wraps `unstable_cache` with tag `user:<name>` and `revalidate: false`.
  - The tag is cleared by `app/api/sync`, `app/account/actions.ts`, the concerts actions (`updateTag`) and the stats self-heal.
- `countListens` uses a separate 10 s time-based `unstable_cache`.
- The stats page runs a self-heal in `after()`: if `last_listened_at > last_aggregated_at`, it claims the stamp, runs `rebuildAll`, and revalidates.
- No `<Link>` uses `prefetch` today.

## Rendering model

Every user page is URL data (`params.username`). Each page therefore has three layers:

| Layer | Contents | Delivery |
|---|---|---|
| App Shell (shared across all users) | header frame, logo, tab bar, page headings, skeletons | instantly, prefetched by every link |
| Per-user content (cached) | lists, stats, detail pages, concerts | resolved ahead of the tap for full-prefetch links; otherwise streams right after navigation |
| Login-only bits (per request) | Account link, owner pill, concerts owner bar, edit mode | streams last, never blocks |

Changes:

1. **Config:**
   - Set `cacheComponents: true` and `partialPrefetching: true` in `next.config.ts`.
   - Delete every `dynamic`, `revalidate` and `fetchCache` route export.
2. **Layout:**
   - No cookie read at the top level.
   - The username breadcrumb reads `params` inside a `<Suspense>` with a same-width placeholder.
   - `<PillNav>`'s Account entry and `<AccountLink>` go inside a new `<OwnerOnly username>` server component.
3. **`<OwnerOnly username>`** (`components/OwnerOnly.tsx`):
   - It is an async server component that reads the session.
   - It renders its children only when `session.lbUsername === username`, and renders nothing otherwise.
   - It is always used inside `<Suspense fallback={null}>`.
   - It replaces the hand-rolled `isOwner` checks in the layout and in the concerts page.
4. **Pages:**
   - Each page's default export is a non-async wrapper: the real heading plus `<Suspense fallback={<…Skeleton/>}>` around a content component.
   - The content component awaits `params` and `searchParams` and calls the cached queries.
5. **Concerts:**
   - The timeline list is public and cached.
   - The owner bar and edit toggle (`Add concert`, `Add festival`, `Edit`, `SetlistImport`) render through `<OwnerOnly>`.
   - Edit mode is client state. It lives in a small client context provider so the owner bar and the rows share it.
   - For visitors, rows render with `editMode=false`.
6. **Stats self-heal:**
   - Remove the staleness check and `after()` rebuild from the page render.
   - The sync route's terminal rebuild already covers the normal path.
   - The stuck-chain case (a chain dies before its terminal rebuild) is handled by running the same claim-and-rebuild at the start of the next sync request for that user.
   - The page also keeps reading `syncState` and recent listens, which are real-time. They go in their own `<Suspense>` and are uncached, so they don't block the cached tiles.
7. **`/` and `/account`:**
   - These are cookie-driven by nature.
   - They keep a static frame, and the session-dependent parts sit inside `<Suspense>`.
   - `/` also reads `searchParams` (`error`, `reason`, `username`); that read moves inside Suspense too.

## Data cache

- **Constraint:** `unstable_cache` persists across instances and deploys. That is what lets Neon suspend between visits (see the comment in `cache.ts`). Plain `'use cache'` is in-memory per instance, so it is lost on cold starts and deploys.
- **Decision gate (Task 1 spike):**
  - On a Vercel preview, determine which of these feeds a prefetched or prerendered page **and** survives a cold start and a redeploy:
    - (a) the existing `unstable_cache`-based `userCached` used from within the new page structure
    - (b) `'use cache: remote'` with `cacheTag('user:'+name)` and `cacheLife('max')`.
  - Also determine what (b) does on self-host (Docker, no cache handler configured).
  - The winner becomes `userCached`'s implementation. Its call signature stays the same, so the query modules don't change.
  - If neither satisfies both conditions, stop and report before continuing.
- Invalidation is unchanged: `revalidateTag`/`updateTag` on `user:<name>` from the same four places.
- `countListens` keeps its 10 s time-based cache: `cacheLife({ revalidate: 10 })` if it migrates, or left as-is.

## Prefetching

| Links | Prefetch |
|---|---|
| Tabs: `PillNav` (desktop) and `TabBar` (phone) | full (`prefetch`) |
| Stats `YearNav` prev/next | full |
| List rows → detail pages: `InfiniteList`, `TopItemCard`, `TopList`, `SearchHits`, concerts `Timeline` | on intent: a client `IntentLink` wrapper calls `router.prefetch` on `pointerenter` / `touchstart`, with the default (App Shell) prefetch otherwise |
| Detail-page cross-links, `DayBars`, `Heatmap`, home, account, onboarding, pricing | default (App Shell only) |

Full prefetch on list rows was rejected because of cost: one server invocation per visible link, plus Neon wake-ups for pages never opened. Switching rows to full later is a one-line change per component.

## Loading skeletons

- New file: `components/skeletons.tsx`, with `RowSkeleton`, `StatSkeleton`, `DetailHeaderSkeleton` and `ChartSkeleton`.
- Style rules (the user rejects flair):
  - existing tokens only (`bg-muted`), with `animate-pulse` as the only motion
  - each skeleton copies its real row's height, image size (40 px, `rounded-full` for artists, `rounded` otherwise), padding (`py-2.5`) and `divide-y divide-border`
  - real headings and icons render immediately.
- List pages show their heading plus 8 `RowSkeleton`s. Stats and detail pages compose the matching parts.
- Header username: an invisible same-width placeholder. Login-only bits render nothing until resolved.

## Testing and verification

- `next build` must pass with `cacheComponents` on. The build fails on any cookie or URL read outside Suspense.
- After each page group: run a production build locally and Playwright render checks as visitor and owner against the prod DB.
  - Never `/stats` locally: it would rebuild prod aggregates. `/stats` is checked on the preview instead.
- `instant()` tests (`@next/playwright`) for each tab switch, run against a production build, kept in the repo.
- Screenshot each skeleton next to its loaded page for the user.
- `tsc`, `npm test` and lint must show no new errors.

## Measurement

- Baseline before Task 2, and again after shipping:
  - tab switch, from tap to the first real list row, at 1100 px and 390 px viewports
  - TTFB and time-to-content for a cold `/u/tordar/artists`.
- Neon: confirm the endpoint still reaches suspend between visits, checked for a day after launch.

## Rollout

1. Spike (cache storage). Gate.
2. Foundation: flags, layout, `OwnerOnly`, skeletons.
3. Pages in groups, each followed by a build and render check:
   - lists
   - details
   - concerts
   - stats (with the self-heal move)
   - home and account.
4. Prefetch: tabs and year nav full; `IntentLink` on rows.
5. `instant()` tests.
6. Push the branch, then render-check every page on the Vercel preview, including `/stats`, as visitor and owner.
7. Merge to `main`. Rollback is `git revert` of the merge; there are no DB changes.

## Out of scope

- The iOS app, which uses API routes; those are unchanged.
- Any visual redesign.
- Changing what is cached or when it is invalidated.
