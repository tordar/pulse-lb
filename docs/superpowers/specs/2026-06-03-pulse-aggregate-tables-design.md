# Pulse-LB Performance: Per-User Aggregate Tables

**Date:** 2026-06-03
**Status:** Approved — ready for implementation planning

## Problem

The stats page (`/u/[username]/stats`) is `force-dynamic` and runs 8–10 heavy DB queries on every request, each scanning the user's ~200,000-row `listens` table:

- `allTimeStats` — full scan + `LEFT JOIN recordings`, 6 aggregates
- `todayStats` — full filtered scan + JOIN
- `yearlyListening` — full scan, `GROUP BY year`, + JOIN
- `hourlyDistribution` — full scan, `GROUP BY hour`
- `availableYears` — full scan, `DISTINCT year`
- `dailyListeningByYear` — year scan, `GROUP BY day`
- `topSongsByYear` / `topAlbumsByYear` / `topArtistsByYear` — three separate year scans each using `mode()` and filtered `array_agg`
- `dayDetail` × 2 if a day is selected

The list pages (`/songs`, `/artists`, `/albums`) likewise do full `GROUP BY` scans for paginated listings with `ILIKE` search.

This is unsustainable for three reasons:

1. **UX latency** — even with one user, the page is sluggish.
2. **DB cost** — Neon compute hours scale with this query volume.
3. **SaaS scale** — pulse-lb is heading to paid ($10/yr per memory). N users at this query shape means N× the DB work per render, and the per-user `listens` table grows monotonically.

## Goals

- Reduce stats-page DB work from "scan 200k rows × 8 times" to "read ~50 rows from indexed lookups."
- Same reduction applies to the songs/artists/albums list pages.
- Keep all current functionality intact — every existing page query has an equivalent.
- No new infrastructure outside Postgres.
- Multi-tenant friendly: every row carries `user_name`, every invalidation is `WHERE user_name = $1`.

## Non-goals

- Vercel Runtime Cache or any KV layer on top of Postgres point reads (premature; <1ms reads don't benefit).
- Materialized views (rebuild cost is global, doesn't scale with multi-tenant).
- Live incremental rollup updates on insert (full rebuild is bounded and runs at most once per sync chain — incremental adds bug surface for no real saving).
- Partitioning `listens` (single table handles ~10k users at our row counts on Neon; revisit if breached).
- Changing the `listens` or `recordings` source-of-truth tables.

## Architecture

Seven new per-user aggregate tables in Postgres. All keyed by `user_name`. All rebuilt atomically per user at end-of-sync-chain.

```
listens (source of truth, ~200k rows/user, untouched)
   │
   │  end-of-sync-chain trigger
   ▼
agg_alltime, agg_year, agg_hour, agg_day,
agg_song, agg_artist, agg_album
   │
   ▼
stats page + list pages read from these
```

The aggregate tables are purely derived. They can be dropped and regenerated from `listens` at any time.

## Data model

```sql
-- One row per user. All-time totals for the dashboard summary tiles.
CREATE TABLE agg_alltime (
  user_name             TEXT PRIMARY KEY,
  total_plays           INT       NOT NULL,
  effective_ms          BIGINT    NOT NULL,
  distinct_artists      INT       NOT NULL,
  distinct_albums       INT       NOT NULL,
  distinct_songs        INT       NOT NULL,
  first_played          TIMESTAMPTZ,
  last_played           TIMESTAMPTZ,
  duration_coverage_pct FLOAT8,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Yearly chart points. ~16 rows per user.
CREATE TABLE agg_year (
  user_name TEXT NOT NULL,
  year      INT  NOT NULL,
  plays     INT  NOT NULL,
  hours     FLOAT8 NOT NULL,
  PRIMARY KEY (user_name, year)
);

-- Hourly distribution. Exactly 24 rows per user.
CREATE TABLE agg_hour (
  user_name TEXT NOT NULL,
  hour      INT  NOT NULL,
  plays     INT  NOT NULL,
  PRIMARY KEY (user_name, hour)
);

-- Heatmap. One row per (user, date) — ~5,800 rows/user for 16 years.
CREATE TABLE agg_day (
  user_name TEXT NOT NULL,
  date      DATE NOT NULL,
  plays     INT  NOT NULL,
  PRIMARY KEY (user_name, date)
);

-- Songs. scope IS NULL = all-time; scope = 2026 = year-scoped.
-- One table covers both the "top songs by year" tile AND the all-time
-- /songs list page.
CREATE TABLE agg_song (
  user_name        TEXT NOT NULL,
  scope            INT,                -- NULL = all-time
  group_key        TEXT NOT NULL,      -- COALESCE(recording_mbid::text, '~'||track_name)
  track_name       TEXT NOT NULL,
  artist_name      TEXT,
  plays            INT  NOT NULL,
  effective_ms     BIGINT NOT NULL,
  caa_id           BIGINT,
  caa_release_mbid UUID,
  recording_mbid   UUID,
  PRIMARY KEY (user_name, scope, group_key)
);
CREATE INDEX agg_song_top ON agg_song (user_name, scope, plays DESC);

CREATE TABLE agg_artist (
  user_name        TEXT NOT NULL,
  scope            INT,
  artist_name      TEXT NOT NULL,
  plays            INT  NOT NULL,
  effective_ms     BIGINT NOT NULL,
  distinct_songs   INT  NOT NULL,
  distinct_albums  INT  NOT NULL,
  artist_mbid      UUID,
  caa_id           BIGINT,
  caa_release_mbid UUID,
  PRIMARY KEY (user_name, scope, artist_name)
);
CREATE INDEX agg_artist_top ON agg_artist (user_name, scope, plays DESC);

CREATE TABLE agg_album (
  user_name        TEXT NOT NULL,
  scope            INT,
  group_key        TEXT NOT NULL,   -- release_name + '|' + artist_name (NULL release_names excluded)
  release_name     TEXT NOT NULL,
  artist_name      TEXT,
  plays            INT  NOT NULL,
  effective_ms     BIGINT NOT NULL,
  caa_id           BIGINT,
  caa_release_mbid UUID,
  release_mbid     UUID,
  PRIMARY KEY (user_name, scope, group_key)
);
CREATE INDEX agg_album_top ON agg_album (user_name, scope, plays DESC);
```

Plus a column on `sync_state`:

```sql
ALTER TABLE sync_state ADD COLUMN last_aggregated_at TIMESTAMPTZ;
```

### Why a `scope` column instead of separate year-tables

`scope IS NULL` = all-time; `scope = 2026` = that year. One table per entity type (song/artist/album), one index covers both query shapes, same query body with a `WHERE scope = $year OR scope IS NULL` filter.

### Why `group_key`

Mirrors the grouping identity used in the current queries — for songs it's `COALESCE(recording_mbid::text, '~' || track_name)`, which collapses synonymous rows when the MBID is known and falls back to the track name when it isn't. Computed once at write time, stable across rebuilds.

### Why `effective_ms` is materialized

Current queries `LEFT JOIN recordings r ON r.mbid = l.recording_mbid` then `COALESCE(l.duration_ms, r.length_ms)`. We resolve this lookup once at write time, store the resulting `BIGINT`, and never join at read time.

## Sync integration

**Where:** end of sync chain only. In `app/api/sync/[username]/route.ts`, after `syncUser` completes inside the `after()` block.

**Trigger predicate:**
```ts
const isChainTerminal = result.completed && result.added === 0;
const state = await db.query.syncState.findFirst({ where: eq(syncState.userName, username) });
const aggregatesStale =
  !state?.lastAggregatedAt ||
  (state.lastListenedAt && state.lastAggregatedAt < state.lastListenedAt);

if (isChainTerminal && aggregatesStale) {
  await rebuildAll(username);
  await db.update(syncState)
    .set({ lastAggregatedAt: new Date() })
    .where(eq(syncState.userName, username));
}
```

This covers three cases:
- First sync of a new user — `lastAggregatedAt` is null, stale.
- Normal sync chain ending with new data added — `lastListenedAt` advanced past `lastAggregatedAt`, stale.
- No-op resync of an already-current user — `lastListenedAt` unchanged from previous run, not stale, skip the rebuild entirely.

**Rebuild implementation** lives in `lib/db/aggregates/rebuild.ts`:

```ts
export async function rebuildAll(username: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM ${schema.aggAlltime} WHERE user_name = ${username}`);
    await tx.execute(sql`DELETE FROM ${schema.aggYear}    WHERE user_name = ${username}`);
    await tx.execute(sql`DELETE FROM ${schema.aggHour}    WHERE user_name = ${username}`);
    await tx.execute(sql`DELETE FROM ${schema.aggDay}     WHERE user_name = ${username}`);
    await tx.execute(sql`DELETE FROM ${schema.aggSong}    WHERE user_name = ${username}`);
    await tx.execute(sql`DELETE FROM ${schema.aggArtist}  WHERE user_name = ${username}`);
    await tx.execute(sql`DELETE FROM ${schema.aggAlbum}   WHERE user_name = ${username}`);

    await rebuildAllTime(tx, username);
    await rebuildYear(tx, username);
    await rebuildHour(tx, username);
    await rebuildDay(tx, username);
    await rebuildSong(tx, username);    // UNION ALL of scoped + all-time SELECTs
    await rebuildArtist(tx, username);
    await rebuildAlbum(tx, username);
  });
}
```

Each rebuild function is one `INSERT INTO agg_X SELECT … FROM listens l LEFT JOIN recordings r … WHERE l.user_name = $1 GROUP BY …`, mirroring the SELECT shape of the current per-call query.

For songs/artists/albums where we want both year-scoped and all-time rows in the same table, the INSERT is a `UNION ALL` of the two SELECT shapes — one grouping by year, one omitting year (writing `NULL` to `scope`).

**Cost budget:** all DELETEs hit the `(user_name, …)` PK index — narrow. INSERTs all share `WHERE l.user_name = $1`, so each scan uses one index range on the existing `listens_user_listened_at` (or related) index. Expected wall-clock <2s for 200k listens. Fits comfortably under the unused tail of the 40s `maxDurationMs` sync budget.

**On failure:** if `rebuildAll` throws inside the route's existing `try/catch`, the transaction rolls back, the job is marked `status: error`, and `last_aggregated_at` is not updated. Reads continue to return the previous snapshot. The next sync click attempts the rebuild again. Self-healing.

## Read paths

Existing functions in `lib/db/queries/stats.ts` keep their signatures and return types — only the SQL body changes. Callers in `app/u/[username]/stats/page.tsx` and the list pages don't move.

```ts
// allTimeStats
SELECT * FROM agg_alltime WHERE user_name = $1

// yearlyListening
SELECT year, plays, hours FROM agg_year WHERE user_name = $1 ORDER BY year

// availableYears
SELECT year FROM agg_year WHERE user_name = $1 ORDER BY year DESC

// hourlyDistribution
SELECT hour, plays FROM agg_hour WHERE user_name = $1 ORDER BY hour

// dailyListeningByYear
SELECT to_char(d.day,'YYYY-MM-DD') AS date, COALESCE(a.plays, 0)::int AS plays
FROM generate_series(make_date($2,1,1), make_date($2,12,31), '1 day') d(day)
LEFT JOIN agg_day a ON a.user_name = $1 AND a.date = d.day::date
ORDER BY d.day

// topSongsByYear / topAlbumsByYear / topArtistsByYear
SELECT track_name, artist_name, plays, effective_ms, caa_id, caa_release_mbid, recording_mbid
FROM agg_song WHERE user_name = $1 AND scope = $2
ORDER BY plays DESC, track_name
LIMIT $3
```

**List pages** (`lib/db/queries/topItems.ts`) read with `scope IS NULL`:

```ts
SELECT … FROM agg_song
WHERE user_name = $1 AND scope IS NULL
  AND ($q::text IS NULL OR track_name ILIKE $q OR artist_name ILIKE $q)
ORDER BY plays DESC, track_name
LIMIT $limit OFFSET $offset
```

The `(user_name, scope, plays DESC)` index covers the sort. ILIKE against rows numbering in the thousands is effectively free.

**Queries that stay against `listens` (untouched):**
- `todayStats` — single-day window. Always fresh, not in any rollup.
- `dayDetail` — one specific date plus the ≤200 listen rows for that date. Already indexed.
- `/songs/[mbid]`, `/artists/[mbid]`, `/albums/[mbid]` detail pages — one-mbid filter, need full per-play list.
- Recent listens (last 10) — `ORDER BY listened_at DESC LIMIT 10` is an index seek.

## Edge cases

- **Second sync click during in-flight rebuild.** The route's POST handler already sweeps stale `running`/`queued` rows when a non-self-triggered POST arrives. If Vercel kills the rebuild function mid-transaction, the transaction rolls back. Either way, partial aggregates are impossible — readers see either the prior snapshot or the new one.
- **Empty user / first sync still in progress.** `rebuildAll` only fires at chain terminal. During an in-progress backfill, `agg_alltime` may have no row for the user yet. `allTimeStats()` returns null/empty → existing `empty=allTime.total_plays === 0` check in `page.tsx` handles it.
- **`Today` stat freshness.** `todayStats` queries `listens` directly — unaffected by rebuild cadence.
- **Mid-chain dashboard staleness.** Between chain start and chain terminal, the dashboard shows the last snapshot. Acceptable: the user is already aware of in-progress sync via the SyncButton state, and the live "streaming in" view is a separate query.

## Migration & rollout

One Drizzle migration adds the seven tables and the `sync_state.last_aggregated_at` column.

Rollout for this single-user codebase:
1. Generate + push migration.
2. Add `lib/db/aggregates/rebuild.ts` and run `scripts/bootstrap-aggregates.ts` once to populate aggregates for all existing users (currently one: `powerole`).
3. Swap the bodies of the query functions in the same deploy.
4. Wire `rebuildAll` into the chain-terminal branch of the sync route.

If this codebase ever has live users at deploy time, gate step 3 behind a `USE_AGGREGATES` boolean defaulted false. Bootstrap, flip, then delete the flag in a follow-up. Skipped for the current single-user state.

## Testing

- **Unit tests for each `rebuildX` function:** seed `listens` with a fixture (a known set of plays across users/years), call `rebuildX(tx, username)`, assert the resulting `agg_X` rows match handwritten expected output. Run in a transaction that rolls back.
- **Equivalence test:** for each query in `stats.ts` and `topItems.ts`, the new SQL must return the same shape and values as the old SQL for the same fixture. One test file pairs old-vs-new and asserts deep-equal.
- **Trigger test:** end-to-end sync test (existing harness, if any, or a focused integration test) that runs `syncUser` to completion and asserts `agg_alltime` contains a row for the user. Also asserts that a no-op resync does NOT re-fire rebuild (verify via `last_aggregated_at` not advancing).
- **Drop & rebuild test:** `DELETE FROM agg_*` for a user, call `rebuildAll`, assert the dashboard queries return the same payload they did before the delete. This verifies the rebuild is the inverse of read.

## Risks & mitigations

- **Risk:** Per-user transactional rebuild blocks the sync chain's `after()` block for ~2s, eating into the 60s function ceiling. **Mitigation:** rebuild only fires at chain terminal when no new listens were fetched, so we have ~58s of unused budget. Measure on first deploy; if it exceeds 5s for outlier users, split per-table into sequential transactions (still atomic per table).
- **Risk:** Aggregate tables and `listens` get out of sync due to a bug or partial deploy. **Mitigation:** the rebuild is idempotent and complete; `scripts/bootstrap-aggregates.ts` can be re-run for any user at any time without side effects on other tables.
- **Risk:** Storage growth. **Estimate:** ~10–30% on top of `listens`. For a 200k-listen user, agg tables total <100MB. Acceptable.
