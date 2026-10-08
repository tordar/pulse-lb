# Live listens: remove the Sync button

**Date:** 2026-10-08
**Status:** design approved, awaiting spec review

## Goal

Stats feel instant and real-time. No Sync button, no progress UI after the
first import. New listens appear on screen within one poll (~15s) of being
scrobbled, and the database follows without full aggregate rebuilds.

## Decisions

- **Client-first (Option A).** Data is only ingested while someone has a page
  open. No cron or background job. Returning after days away catches up in ~1s
  on screen and a few seconds in the DB. An hourly job can be added later if
  this proves too slow.
- **Server never trusts client listens.** The client only nudges; the server
  fetches from LB itself.
- **Incremental aggregates replace `rebuildAll()`** on the hot path.
  `rebuildAll()` stays for first import and repair.
- **No "live" indicator** in the header; the "last synced" line is removed.

## Facts this relies on

- `api.listenbrainz.org` sends `access-control-allow-origin: *` and rate-limits
  per caller IP (30 req / ~10s), so the browser can poll LB directly.
- Album clusters never span artists (`lib/db/aggregates/albumCluster.ts`), and
  an artist-scoped cluster CTE already exists.

## 1. Data flow

### Client: `useLiveListens` hook

Mounted in `app/u/[username]/layout.tsx` for every viewer. Merged with the
existing `NowPlaying` poll so there is one timer.

1. On mount, and every 15s while the tab is visible, request
   `GET /1/user/{u}/listens?min_ts=<newest listened_at on screen>` from LB,
   paging (count=1000) until a page comes back empty.
2. Feed new listens to `lib/sync/liveDelta.ts`: recent listens, tiles and top
   lists update immediately.
3. If anything was new, `POST /api/listens/ingest/{username}` (no body).
4. If the response says `more: true`, call ingest again.
5. On final success: `router.refresh()`, then `resetLive()` so authoritative
   numbers replace the projection.

The "newest listened_at on screen" is passed from the server-rendered layout
(from `sync_state.last_listened_at`).

### Server: `POST /api/listens/ingest/[username]`

1. Paywall: `isAllowedToSync(owner)` else 402, no DB writes.
2. Take a per-user Postgres advisory lock (`pg_try_advisory_xact_lock`). If not
   acquired, return `{ busy: true }` immediately.
3. Throttle: if the last ingest for this user finished < 10s ago, return
   `{ skipped: true }`.
4. Forward pass: fetch LB listens newer than `MAX(listened_at)` in `listens`
   (reuse `syncUser`'s forward pass), within a time budget.
5. In one transaction: insert listens, apply the incremental aggregate update
   (section 2), update `sync_state`.
6. `revalidateTag("user:{username}", "default")`.
7. Return `{ added, more }`, where `more` is true when the budget ran out.

Open to any viewer: it only pulls the owner's public LB data.

### First import

For a user with no listens (or an unfinished backfill), the same endpoint also
runs `syncUser`'s backward pass, then `rebuildAll()` when the backfill
completes. The client loops while `more: true` and shows one plain text line
in the existing page style: `Importing history… 12,400 of 48,000`. The line
disappears when done.

## 2. Incremental aggregates

New module `lib/db/aggregates/incremental.ts`:
`applyNewListens(tx, username, newListens)`. Runs inside the ingest
transaction. Each step reuses the existing builder SQL from `rebuild.ts` with
an added slice filter (refactor builders to accept an optional filter rather
than duplicating SQL).

| Table | Slice recomputed (DELETE slice, INSERT slice) |
|---|---|
| `agg_year` | years touched by the new listens |
| `agg_day` | dates touched |
| `agg_hour` | hours touched |
| `agg_song` | songs played (both scopes: all-time and the affected years) |
| `agg_artist` | artists played (both scopes), incl. distinct song/album counts |
| `agg_album` | all clusters of the artists played, via the artist-scoped CTE |
| `agg_alltime` | single row, updated additively (below) |

`agg_alltime`:
- `total_plays += n`, `effective_ms += Σ duration` (same COALESCE with
  `recordings.length_ms` as the rebuild), `last_played = max(...)`,
  `first_played = min(...)`.
- `distinct_artists` / `distinct_songs`: +1 per key with no prior listen
  (checked before insert, using the same key expressions as the rebuild).
- `distinct_albums`: += (clusters for affected artists after) − (clusters
  before). Can decrease: a new play can tip a majority vote and merge two name
  keys. "Before" is counted from the `agg_album` rows about to be deleted.
- `duration_coverage_pct`: recomputed from the updated totals plus a
  covered-plays delta.

`agg_song`/`agg_artist`/`agg_album` have no primary key, so slices are
DELETE + INSERT; no upserts.

## 3. Removals

Deleted:
- `app/u/[username]/stats/SyncButton.tsx`: the search box it wraps moves
  directly into `StatsHeader`.
- `app/api/sync/[username]/route.ts`: chain, job polling, zombie detection,
  probe/auto-sync. The probe's stale-aggregate heal moves into the ingest
  endpoint (run `healStaleAggregates` when stale and no import is running).
- `lib/sync/chainToken.ts`.
- All code reading/writing `sync_jobs`. Dropping the table is a **separate
  migration, run only after explicit confirmation**.
- Onboarding copy ("First sync takes a few minutes…") updated to describe the
  first import.

Kept: `syncUser.ts` (forward + backward passes), `liveDelta.ts`, `keys.ts`,
`sync_state`, `rebuildAll()`, `healStaleAggregates`.

## 4. Errors

- **LB error / 429 in the browser:** back off 15s → 60s → 5min, silent.
- **Ingest failure:** transaction rolls back; the client keeps its projection
  and retries on the next new listen. The next success catches up the whole
  gap.
- **Concurrent tabs/viewers:** advisory lock; losers get `busy` immediately.
- **Hidden tab:** polling pauses; one immediate poll on `visibilitychange`.
- **Unpaid owner:** 402; client keeps showing live LB listens on screen and
  stops calling ingest.

## 5. Testing

1. **Equivalence script** (`scripts/`): load a real user's listens into a
   throwaway local Postgres, remove the last N, run `rebuildAll`, re-insert the
   N via `applyNewListens`, and assert every `agg_*` row equals a fresh
   `rebuildAll()`. Run with several N, including a vote-tipping album case.
2. **Playwright e2e** with LB mocked: a new listen shows on the page within one
   poll, before ingest returns, and stays correct after refresh.
3. **Render check** of the real stats page against the real DB before pushing.
   Then verify on prod with an actual scrobble.

## Out of scope

- Background/cron ingestion (revisit if the open-page catch-up feels slow).
- Push sources (LB websockets).
- iOS app changes.
