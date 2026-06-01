# Pulse → ListenBrainz Refactor Plan

**Status:** Initial plan, pre-implementation
**Author:** tordar (with Claude)
**Date:** 2026-05-26

## TL;DR

Replace the entire Spotify-API-based data pipeline with **ListenBrainz as the single source of truth**. Pulse becomes a read layer over LB profiles (public users: zero auth; private users + first-time importers: MB OAuth + paste-LB-token-once). Pulse hosts its own Spotify ZIP import flow that submits to LB via `/1/submit-listens` — users never leave Pulse during onboarding. Roughly 70% of the current repo deletes. Validated architecturally by Achordion's existence shipping the same pattern.

## Why this refactor

The current architecture exists almost entirely to work around Spotify's API being terrible:

- Spotify Extended Streaming History requires a user data export (5–30 day wait), manual ZIP download, file upload, and a custom merge pipeline.
- Spotify Web API quotas force aggressive batching and a refresh-token dance.
- Enrichment (genres, MBIDs, album art fallback) is post-hoc, runs in our scripts, and is fragile.
- The full setup requires: Spotify dev app, redirect URIs, refresh token, GitHub PAT, Vercel envs, `UPLOAD_SECRET`, `SPOTIFY_OAUTH_STATE_SECRET`, MusicBrainz fallback scripts, GitHub Actions schedules, an in-app upload form. That is enormous surface area for a personal-listening visualizer.

ListenBrainz solves all of this natively. It already imports Spotify history (via its own well-maintained importer), enriches every listen with MusicBrainz MBIDs and Cover Art Archive IDs as a post-ingest pipeline, and exposes both pre-computed stats endpoints *and* raw listens via a generous public API.

## Architectural decisions (locked in)

These were debated in the brainstorming session and are committed:

1. **No in-browser Spotify ZIP parsing.** Pulse trusts LB's enrichment entirely. The user imports Spotify history via LB's own importer; Pulse never touches a ZIP.
2. **No GitHub Actions data pipeline.** No `data/spotify-history/` → `merged-streaming-history/` → `cleaned-data/` JSON chain. No regenerate-on-push.
3. **No Spotify API integration of any kind.** Drop Spotify OAuth, refresh tokens, all `scripts/fetch-recent-plays.ts`, `scripts/setup-spotify-auth.ts`, etc.
4. **Pulse is a read layer.** All data flows: LB → Pulse DB → user. Pulse never writes to LB.
5. **Public profiles are the default.** No auth needed for `/u/{username}`. MB OAuth + LB token-paste enables a private-profile mode and Pulse-driven Spotify imports as additive features.
6. **Postgres (Neon) replaces the static-JSON data model.** One global `listens` table keyed by `(user, listened_at, track_name)` plus a global metadata cache. Sub-millisecond drill-down queries. Frankfurt region. HTTP driver via `@neondatabase/serverless`. Drizzle ORM + Drizzle Kit migrations. Zod at the LB API boundary.
7. **Pulse hosts its own Spotify import flow.** Server-side ZIP parsing on Vercel → submit to LB via `/1/submit-listens` → LB's enrichment pipeline runs as normal. Users do not need to leave Pulse to import history. Validated by Achordion's existence using the same building blocks.
8. **Fresh repo, not in-place refactor.** Current `your-spotify-consolidator` repo is preserved as legacy (last known good for tordar's personal Pulse instance). The new project is a separate codebase that copies select reusable pieces (chart components, design tokens, layout primitives) and rewrites everything else from scratch. This avoids carrying forward the Spotify-API/cleaned-JSON scaffolding that motivated this refactor.
9. **Manual sync only at launch — no cron, no implicit page-load syncs.** Users press a sync button; that triggers `POST /api/sync` which kicks off a `waitUntil` background job and writes progress to a `sync_jobs` row. The dashboard polls that row. One code path handles both incremental refresh (<1 sec) and first-time backfill (~3–5 min). Cron-based background sweeps are a v2 question, not a launch concern.

## Validation against the existing UI

Empirically verified against tordar's account (187,919 listens, 2009–2026) on 2026-05-26 by syncing LB raw listens into a local SQLite and running the queries that would back the existing "album detail modal" UI:

| Screenshot value (The Story So Far, self-titled) | Computed from LB | |
|---|---|---|
| 312 plays | 312 | ✓ exact |
| First played Jun 5, 2015 | 2015-06-05 07:08:56 | ✓ exact |
| 10/11 tracks played | 10 distinct recordings | ✓ exact |
| Heavy Gloom 63 / Nerve 58 / Smile 36 / Distaste 32 | 63 / 58 / 36 / 32 | ✓ exact |
| 2018 yearly spike (dominant bar) | 2018: 122 plays | ✓ shape matches |

Every drill-down the current Pulse UI shows is reproducible from LB raw listens via one SQL query. No exceptions found.

## Findings that adjusted the initial plan

These came out of actually running the code, not from theory:

1. **Index on `release_mbid`, not `release_group_mbid`.** RGID coverage on LB-imported Spotify history is only 1.14% (LB writes it only on recent submissions from clients like Navidrome). `release_mbid` reaches 96.8% after correctly reading `mbid_mapping`. Cross-edition grouping uses a cached `releases` table mapping `release_mbid → release_group_mbid`.

2. **Read MBIDs from `mbid_mapping`, not `additional_info`.** LB's post-import enrichment block (`track_metadata.mbid_mapping`) carries the canonical MBIDs that `additional_info` lacks. Reading both lifted coverage:
   - `recording_mbid`: 88.45% → 96.43%
   - `release_mbid`: 85.39% → 96.77%

3. **Cover art is essentially free.** `mbid_mapping.caa_id` + `caa_release_mbid` are present on 93.81% of listens. The album-art-fallback worry from the brainstorm is mostly solved out-of-the-box. Image URL:
   ```
   https://archive.org/download/mbid-{caa_release_mbid}/mbid-{caa_release_mbid}-{caa_id}_thumb500.jpg
   ```

4. **Duration is the actual data gap.** `duration_ms` is missing on 97.9% of LB-imported Spotify listens. Required for "14h 16m" / "Play Time by Year (hours)" / per-track minutes columns. Fix: a one-time enrichment pass through LB's `/1/metadata/recording?recording_mbids=...` endpoint (50 MBIDs per call). For tordar's library: 43,783 distinct recordings → ~880 calls → ~5 minutes. **Cached globally** by MBID — every future user reuses the work.

5. **Pagination has a tail problem.** LB's `/listens` endpoint reliably drops the TCP socket near the deep-history boundary (~10k listens shy of complete on two separate runs against tordar's account). Backfill must include retry-with-backoff + page-size fallback. Without it, first-time syncs *will* appear to fail. Pattern is in `scripts-prototype/sync-tail.ts` (see references below).

6. **LB OAuth for third parties does not exist.** Verified directly against `metabrainz/listenbrainz-server` source on GitHub: there is no `oauth_provider.py` anywhere in the repo. All OAuth code is `external_service_oauth.*`, which is LB acting as a *client* to Spotify/Apple Music/etc. The `https://listenbrainz.org/oauth2/authorize/` endpoint returns 200 but is dormant scaffolding — no client registration, no working `/oauth2/token`. MusicBrainz OAuth2 *does* exist (standard OAuth2 + PKCE) and gets identity (`profile` scope returns the MB user_id, which is identical to the LB username — LB users *are* MB users under the hood). But MB scopes (`profile`, `email`, `tag`, `rating`, `collection`, `submit_isrc`, `submit_barcode`) do not include LB write. **The documented and only mechanism for LB write access is the static user token from `listenbrainz.org/settings/`.** This pattern is used by every LB-client project we surveyed — most visibly Achordion, whose architecture and pitch are nearly identical to the Pulse refactor target.

7. **Achordion validates the entire architectural bet.** Achordion (achordion.xyz, by J. Herskowitz) is in beta and explicitly states: "Achordion doesn't store your listening data. There's no Achordion-side profile of you... Your listens, follows, and playlists live in your ListenBrainz account. Leave whenever, take everything with you." This is the Pulse refactor's value proposition verbatim. Their auth: "Login with a MusicBrainz account" (MB OAuth) + Settings → Connections page for LB token paste. The model is well-trodden, low-friction, and demonstrably ships.

## Target architecture

### Data flow

```
ListenBrainz (source of truth)
    │
    │  GET /1/user/{name}/listens     (paginated raw listens)
    │  GET /1/user/{name}/playing-now (Now Playing)
    │  GET /1/stats/user/{name}/*     (precomputed stats — optional, for fast cold renders)
    ▼
Pulse sync worker  ──── one-time global metadata enrichment ───▶  LB /1/metadata/recording, MB ws/2
    │                                                                                │
    ▼                                                                                ▼
Postgres: listens table (per-user)                                Postgres: recordings, releases (global cache)
    │
    ▼
Next.js Server Components (Vercel)
    │
    ▼
User dashboard at /u/{username}
```

### State machine (what Pulse shows on each visit)

```
GET /1/user/{name}/listen-count
  ├─ 404                              → "That LB user doesn't exist. Sign up at listenbrainz.org?"
  ├─ count = 0                        → "No listens yet. Connect Spotify or import your history on LB."
  ├─ count growing across polls       → "LB is still ingesting your import — at N / ~estimate listens"
  ├─ count stable, profile public     → render dashboard
  └─ count stable, profile private    → "This profile is private. [Paste your LB token to view]"
```

### Database schema (Postgres / Neon)

```sql
CREATE TABLE listens (
  user_name           text          NOT NULL,
  listened_at         bigint        NOT NULL,  -- Unix seconds
  track_name          text          NOT NULL,
  artist_name         text,
  release_name        text,
  recording_mbid      uuid,
  release_mbid        uuid,
  artist_mbids        uuid[],
  caa_id              bigint,
  caa_release_mbid    uuid,
  PRIMARY KEY (user_name, listened_at, track_name)
);
CREATE INDEX listens_user_release_time ON listens (user_name, release_mbid, listened_at);
CREATE INDEX listens_user_recording     ON listens (user_name, recording_mbid);
CREATE INDEX listens_user_release_name  ON listens (user_name, release_name);  -- fallback for ~3% missing MBIDs

-- Global, shared across all users
CREATE TABLE recordings (
  mbid         uuid PRIMARY KEY,
  name         text,
  length_ms    integer
);
CREATE TABLE releases (
  mbid                uuid PRIMARY KEY,
  release_group_mbid  uuid,
  name                text,
  track_count         integer
);
CREATE INDEX releases_rgid ON releases (release_group_mbid);

-- Sync state, one row per Pulse user
CREATE TABLE sync_state (
  user_name           text PRIMARY KEY,
  last_synced_at      timestamptz,
  last_listened_at    bigint,
  total_listens       integer,
  first_seen          timestamptz DEFAULT now()
);
```

### Auth model

| Capability | Auth | Storage |
|---|---|---|
| View `/u/{public-username}` | None | — |
| Sign in to Pulse (identity only) | MB OAuth2 + PKCE | Session cookie with MB user_id (= LB username) |
| View own private profile at `/me` | MB OAuth + LB user token paste | HttpOnly cookie, AES-GCM encrypted token blob |
| Pulse imports Spotify history into LB | MB OAuth + LB user token paste | Same cookie used by private mode |
| Pulse writing arbitrary data to LB | **Out of scope** — Pulse only writes user-initiated historical imports | — |

**Flow for granting write access (private mode or imports):**

```
1. "Sign in with MusicBrainz"       → MB OAuth2 + PKCE, ~10 sec
2. Pulse knows your username        → derived from MB user_id (LB users are MB users)
3. "We need your LB token for X"    → open https://listenbrainz.org/settings/ in new tab
4. User copies token, pastes in Pulse
5. Pulse calls GET /1/validate-token → confirms it belongs to the MB-authenticated user (defense against paste mistakes)
6. AES-GCM encrypt the token with a server-side key (env var SESSION_ENCRYPTION_KEY)
7. Store encrypted blob in HttpOnly + Secure + SameSite=Lax cookie
8. Done. Logout clears the cookie.
```

The token never persists server-side. The encryption key never leaves the server. Compromise of either alone is insufficient; you'd need both the user's browser session *and* the server key. Acceptable for the threat model (the token's blast radius is the user's own LB account, not arbitrary credentials).

If LB ever ships a real third-party OAuth flow (the dormant `/oauth2/authorize/` endpoint suggests they intend to), swap step 3–6 for the OAuth dance. The rest of the architecture doesn't change.

### Onboarding journeys

**Path A — existing LB user with data ("I already have a ListenBrainz account")**

```
1. Visit pulse.app
2. Type LB username (or click "Sign in with MusicBrainz" if private)
3. Pulse polls /1/user/{name}/listen-count to detect state:
   - new user            → branch to Path B
   - still ingesting     → progress indicator; "we'll be ready when LB finishes" + email-when-ready
   - ready               → backfill (1–5 min, streaming) → dashboard
4. Returning users: incremental sync (one call), sub-second
```

**Path B — new user with no LB account or no data ("I have a Spotify export, I want to start fresh")**

```
1. Visit pulse.app
2. "Get started" → guided flow:
   a. Already have a Spotify export?
      - No  → step-by-step: how to request it (deeplink to spotify.com/account/privacy),
              "we'll email you when you should come back" (5–30 day wait)
      - Yes → continue
   b. "You'll need a free ListenBrainz account" → deeplink to listenbrainz.org/signup
      (LB signup is itself MB OAuth; ~30 sec)
   c. "Sign in to Pulse with MusicBrainz" → MB OAuth2 + PKCE
   d. "Paste your LB token" → open listenbrainz.org/settings/ in new tab → paste → verify
   e. "Drop your Spotify ZIP" → Pulse-hosted import flow (see section above)
   f. Pulse imports → LB enriches over the next ~minutes → dashboard renders
3. After this one-time onboarding, future visits are Path A
```

**Path C — existing LB user with private profile**

```
1. Visit pulse.app
2. "Sign in with MusicBrainz" → MB OAuth
3. "Paste your LB token" → verify → encrypted cookie stored
4. /me → dashboard (same code path as /u/{username}, just with token added to LB calls)
```

The Spotify export wait (5–30 days from request to email) in Path B is the only unavoidable delay and lives entirely on Spotify's side. Email-when-ready turns it from an opaque void into a guided wait.

## Pulse-hosted Spotify import flow

This is the part that closes the loop: users never need to visit `listenbrainz.org` to get their data in. Pulse owns the upload UI; LB owns the storage and enrichment.

### Why host the import in Pulse

- The LB Spotify importer UI works but is bare. Pulse can show meaningful preview ("we found 187,234 plays across 2009–2026, with 1,432 podcast episodes filtered out"), progress, and error reporting.
- Server-side parsing avoids the browser-memory issues a 100MB+ Spotify ZIP causes if parsed client-side.
- One-shot UX: the user is already on Pulse to see their data. Bouncing them to a second site to do the upload, then back, then waiting for ingest, then finally returning — that's the current state of the world we're trying to fix.
- LB's enrichment runs over `submit-listens` payloads source-agnostically. Pulse-submitted listens get the same MBID/CAA resolution as LB-importer-submitted listens. No quality loss.

### Endpoints used

| Endpoint | Purpose |
|---|---|
| `GET /1/latest-import` | Returns timestamp of the newest already-imported listen for this user. Pulse uses this as a server-side resume cursor — re-uploading the same ZIP is a no-op; an updated ZIP imports only the delta. |
| `POST /1/submit-listens` | Submit a batch of up to 1000 listens. Body: `{ listen_type: "import", payload: [...] }`. Requires the user's LB token in `Authorization: Token <…>` header. |
| `POST /1/latest-import` | After a successful batch, advance the user's `latest_import` timestamp. (LB updates this automatically on successful imports, but explicitly setting it is supported.) |

### Server-side flow on Vercel

```
1. User drops Spotify export ZIP (or individual Streaming_History_Audio_*.json files) in Pulse
   ↓
2. Vercel Function receives upload (streaming, multipart/form-data)
   ↓
3. Parse server-side: extract all Streaming_History_Audio_*.json, deserialize
   ↓
4. Apply filters:
     - drop podcast plays (records with episode_name set)
     - drop ms_played < 30000 (Spotify "skip" plays; LB convention is 30s minimum)
     - drop offline/sideloaded plays without timestamps
   ↓
5. Show preview to user: total plays, year range, podcast/skip counts, "Confirm import"
   ↓
6. On confirm:
     - GET /1/latest-import with user's token → cursor
     - filter plays: keep only listened_at > cursor (resumable, idempotent)
     - chunk into batches of 1000
     - POST /1/submit-listens for each batch, with the user's token
     - track per-batch success in a job row; on 5xx, exponential backoff retry
   ↓
7. Background: LB's enrichment pipeline runs on the inserted listens over the next minutes-to-hours
   ↓
8. Pulse polls /1/user/{name}/listen-count to detect when ingest stabilizes; then triggers
   normal Pulse sync (LB → Postgres) and shows the dashboard
```

### Listen payload format

LB's `submit-listens` payload per item:

```json
{
  "listened_at": 1433539200,
  "track_metadata": {
    "track_name": "Heavy Gloom",
    "artist_name": "The Story So Far",
    "release_name": "The Story So Far",
    "additional_info": {
      "submission_client": "spotify-pulse",
      "submission_client_version": "1.0.0",
      "music_service": "spotify.com",
      "spotify_id": "https://open.spotify.com/track/...",
      "duration_ms": 170400
    }
  }
}
```

The `submission_client` field tags Pulse as the source — useful for LB-side debugging and for the user's own provenance tracking. `music_service` + `spotify_id` are optional but help LB's matcher resolve the recording to a MusicBrainz MBID with higher precision than name-only matching. Pulse should populate these whenever the Spotify export has them (which is nearly always — `spotify_track_uri` is in every Extended Streaming History record).

### Filtering rules (locked in)

These are policy decisions that affect every Pulse import. Document them in the UI so users understand what got filtered:

| Spotify field | Pulse decision | Why |
|---|---|---|
| `ms_played < 30000` | Drop | LB convention: a listen needs 30s minimum. Filtering at import is cleaner than filtering on every read. |
| `episode_name` is set | Drop | Podcast play; LB doesn't model podcasts well; submitting them creates unmatched listens. |
| `master_metadata_track_name` is null | Drop | Incomplete record (offline play, local file, etc.) — no way to resolve. |
| `ts` (timestamp) is null | Drop | Unmatched record without a `listened_at` is unusable. |
| All other plays | Submit | Let LB handle them, including weird ones — its enrichment pipeline is the right place for that logic. |

### Comparison to LB's own importer

| | LB's importer | Pulse-hosted import |
|---|---|---|
| Where the user is | listenbrainz.org/settings/import/ | pulse.app (no context-switch) |
| Format | Spotify ZIP only | Spotify ZIP + raw JSON files |
| Filtering visible to user | No | Yes (preview before confirm) |
| Resume after partial failure | Manual restart | Automatic via `/1/latest-import` cursor |
| Enrichment | LB does it post-ingest | LB does it post-ingest (identical) |
| Final data quality | Identical | Identical |

The two are interchangeable for users who prefer LB's UI. Pulse just makes the import a first-class part of the Pulse onboarding rather than a side trip.

## Performance budget

Measured against tordar's account (an outlier — 188k listens over 17 years; typical users are 30–50k):

| Operation | Time | Notes |
|---|---|---|
| Full backfill (188k listens, no sleep) | ~3–5 min | LB rate limit headroom: ~1000 listens/sec sustained |
| Full backfill (typical 30–50k user) | ~30–90 sec | |
| Tail retry + page-size fallback | adds ~5–10 sec | Required for completeness |
| Metadata enrichment (43k recordings) | ~5 min cold | Cached globally — warm cache is instant |
| Incremental sync per visit | < 1 sec | Single `?min_ts=…` call |
| Album drill-down SQL query | sub-millisecond | With `(user, release_mbid, listened_at)` index |

LB rate limit is per-IP, shared across all users on Vercel's egress pool. Mitigation: sync queue with bounded concurrency. Day-one this is a non-issue; once Pulse has real concurrent users, the queue prevents 429 cascades.

## New repo vs legacy

The current `your-spotify-consolidator` repo (a.k.a. spotify-pulse) is frozen as **legacy**. It continues to host tordar's personal instance until the new app is at parity; no further feature work lands there.

The new project lives in a separate repo with a clean git history and zero Spotify-API scaffolding. Initial layout:

```
<new-repo>/
├── app/                    # Next.js App Router (root, not under web-app/)
│   ├── (public)/
│   │   ├── page.tsx        # landing
│   │   └── u/[username]/   # public profile dashboard
│   ├── (auth)/
│   │   ├── login/          # MB OAuth start
│   │   └── callback/       # MB OAuth callback
│   ├── (private)/
│   │   ├── me/             # private profile dashboard (token cookie required)
│   │   └── import/         # Pulse-hosted Spotify import flow (Phase 6)
│   └── api/
│       ├── sync/[name]/    # POST = start sync, GET = job status
│       ├── auth/           # OAuth + token-paste endpoints
│       └── import/         # Spotify ZIP upload + submit-to-LB
├── lib/
│   ├── db/                 # Drizzle schema, client, query helpers
│   ├── listenbrainz/       # typed LB client, Zod schemas at boundary
│   ├── sync/               # syncUserListens, sync_jobs orchestration
│   ├── enrich/             # recording / release metadata enrichment
│   └── auth/               # MB OAuth + LB token encryption
├── components/             # shared UI (re-uses charts ported from legacy)
└── drizzle/                # migrations
```

**What gets copied from the legacy repo (and modernized as we go):**

| From legacy | To new repo | Notes |
|---|---|---|
| `web-app/components/Heatmap.*` | `components/charts/Heatmap.tsx` | Same shape; data source changes from JSON file to Postgres query |
| `web-app/components/SpotifyStatsLayout.tsx` | `components/Layout.tsx` | Drop the "Spotify" branding/naming |
| `web-app/components/MiniPlayer.*` | `components/NowPlaying.tsx` | Replace Spotify playback-state source with LB `/playing-now` |
| `web-app/components/PlaybackContext.tsx` | rewrite | LB-backed, not Spotify-backed |
| Chart components (yearly, hourly, country, genres) | `components/charts/*` | Keep visual design; rewire props to query results |
| Design tokens, Tailwind config, global CSS | as-is | |
| `package.json` deps (Next, React, charting, etc.) | curate the minimum we need | Drop everything Spotify-related |

**What gets rewritten from scratch:**
- All API routes (different data layer entirely)
- All data-fetching logic (Postgres queries instead of JSON file reads)
- Auth (didn't meaningfully exist in legacy)
- The entire `scripts/` directory (Spotify-pipeline scripts are obsolete)
- Sync, import, enrichment — all new modules in `lib/`

**What stays in legacy and does not migrate:**
- `scripts/db/*` (the personal music-library consolidator — sldl, Navidrome, D1/Turso). Already noted as a separate-private-repo extraction in Phase 8.
- The GitHub Actions workflows.
- The Docker Compose setup (the new app is Vercel-native).
- The Spotify dev-app integration as a whole.

## Migration plan

### Phase 0 — branch + plan (this commit)
- Branch: `worktree-listenbrainz-refactor-plan`
- This document.

### Phase 1 — data layer
- Add Neon Postgres + Drizzle.
- Schema as above.
- `lib/listenbrainz/client.ts` — typed LB client.
- `lib/sync/syncUserListens.ts` — backfill + incremental + retry-with-backoff + page-size fallback (port from prototype scripts).
- `lib/enrich/recordings.ts` — batch `/1/metadata/recording` enrichment, global cache.
- `lib/enrich/releases.ts` — release → release_group_mbid lookup.

### Phase 2 — read API
- Replace `web-app/app/api/data/*` JSON-file readers with Postgres-backed query handlers.
- Endpoints: `/api/u/{name}/stats`, `/api/u/{name}/albums`, `/api/u/{name}/album/{release_mbid}`, `/api/u/{name}/songs`, `/api/u/{name}/artists`, `/api/u/{name}/recent`, `/api/u/{name}/playing-now`.
- All queries use the indexes above; no JSON files anywhere.

### Phase 3 — UI routing
- New route shape: `/u/{username}/*` for public, `/me/*` for token-auth private.
- Username-from-URL drives all server-component fetches.
- Existing chart components (yearly, hourly, country, heatmap, genres) keep their props; only their data source changes.
- "Album detail modal" backed by the validated query shape (see drill-down SQL in the findings section).

### Phase 4 — manual sync button + job tracking
- One UI control: "Sync now" button in the dashboard header. Shows "last synced X min ago" when idle.
- `POST /api/sync/{name}` creates a row in `sync_jobs` (status: queued → running → done/error, progress counters), then kicks off the actual sync via `waitUntil`.
- The sync function: reads `sync_state.last_listened_at`, paginates LB `/listens?min_ts=…` forward, batched UPSERTs into `listens`, updates `sync_jobs` progress every page.
- First-time backfill chunks: if no `sync_state` row exists, walks backward from now with `max_ts`. If `waitUntil` time budget runs short (~5 min), persist cursor, return; the next button press resumes.
- Dashboard polls `GET /api/sync/{name}/status` every 2s while a job is running; switches to fetching listens once done.
- **No cron, no implicit syncs on page load.** Adding background sweeps is a v2 decision once we see real usage patterns.

### Phase 5 — MB OAuth + private-mode auth
- Register Pulse as an MB OAuth2 client at `musicbrainz.org/account/applications`.
- Implement standard OAuth2 + PKCE flow (NextAuth.js custom provider or direct fetch — both ~50 lines).
- `/me` route group with cookie-required middleware.
- Token-paste form (rendered after MB OAuth identity is established) → `/1/validate-token` check → confirm token belongs to the MB-authenticated user → AES-GCM encrypt with `SESSION_ENCRYPTION_KEY` → HttpOnly cookie.
- Same sync pipeline as public mode, token added to `Authorization: Token …` header.

### Phase 6 — Pulse-hosted Spotify import
- New route: `/me/import` (requires Phase 5 auth — needs the LB token to submit listens).
- Server-side multipart upload handler in a Vercel Function. Streaming parse (don't buffer the whole ZIP).
- Apply the filter rules from the "Filtering rules" table (drop podcasts, ms_played < 30s, null tracks/timestamps).
- Preview UI: total plays, year range, podcast/skip count summaries, "Confirm" button.
- Submit pipeline: `GET /1/latest-import` cursor → batch into 1000s → `POST /1/submit-listens` with exponential backoff → track per-batch job state in a `import_jobs` table.
- Post-import: poll `/1/user/{name}/listen-count` until it stabilizes, then trigger normal sync.

### Phase 7 — deletion
Delete from the repo (a non-exhaustive starting list — there will be more once we walk the tree):

- `data/spotify-history/`, `data/merged-streaming-history/`, `data/cleaned-data/`
- `scripts/merge-streaming-history.ts`
- `scripts/merge-recent-data.ts`
- `scripts/fetch-recent-plays.ts`
- `scripts/add-podcast-data-to-stats.ts`
- `scripts/setup-spotify-auth.ts`
- `scripts/spotify-token-manager.ts`
- `scripts/test-spotify-api.ts`
- `scripts/create-metadata.ts`
- `scripts/cleaner/` (entire directory)
- `scripts/stash-recent-plays.ts`
- `scripts/musicbrainz-enrichment.ts` (LB does this for us now)
- `.github/workflows/sync-spotify.yml`
- `.github/workflows/merge-streaming-history.yml`
- `web-app/app/api/spotify/` (entire directory)
- `web-app/app/api/sync-status/`
- `web-app/app/api/upload-history/` (if exists)
- `web-app/app/callback/` (Spotify OAuth callback)
- All Spotify-related env vars from `vercel.json` and docs
- `Dockerfile.sync`, `docker-sync.sh` (the scheduled sync container)

### Phase 8 — separate the consolidator side
The `scripts/db/*` directory is a different project — personal music-library consolidator (sldl, Navidrome playcount sync, Cloudflare D1/Turso replication, beets/MusicBrainz writes). It does not belong in a public Pulse repo aimed at "share with friends."

- Extract `scripts/db/*` and `library.db` to a separate private repo (`spotify-library-consolidator` or similar).
- Pulse keeps only the LB-backed dashboard.

### Phase 9 — docs + DX
- Rewrite README around the new model: "Visit pulse.app, type your LB username, done."
- Drop all of: Spotify dev app setup, refresh tokens, redirect URIs, `UPLOAD_SECRET`, GitHub PAT, sync upstream workflow.
- New "Bring your own deploy" path: clone, push to Vercel, set `DATABASE_URL`, `SESSION_ENCRYPTION_KEY`, `MB_OAUTH_CLIENT_ID`, `MB_OAUTH_CLIENT_SECRET`, done.

## What we explicitly give up

To be honest about tradeoffs:

- **"Data as files in your repo"** — Pulse no longer owns the data. LB does. For users who valued the "everything is JSON I can grep" property, this is a loss. Mitigation: optional `/u/{name}/export` endpoint that dumps their listens as JSON or Parquet on demand.
- **Always-on offline mode** — current Pulse renders without external services once cleaned-data exists. New Pulse always depends on LB being up. LB's uptime is good but not Vercel-good.
- **The few users with truly private LB profiles** can't share dashboards as easily. Token-paste enables their own viewing but not link-sharing. v2 problem.
- **Now Playing feature parity** depends on the user routing their player through LB. Spotify users using LB's Spotify connector: works. Other players: only if they scrobble to LB. Plenty don't.

## References

The prototype scripts that validated the architecture are in the job scratch dir, not committed:

- `~/.claude/jobs/2849bd27/sync-resume.ts` — initial backfill (no sleep, ~3 min for 180k listens)
- `~/.claude/jobs/2849bd27/sync-tail.ts` — retry + page-size fallback (got the last 7k where pagination kept failing)
- `~/.claude/jobs/2849bd27/resync-fixed.ts` — re-extract MBIDs from `mbid_mapping` (the coverage-fix patch)
- `~/.claude/jobs/2849bd27/validate.ts` — drill-down SQL that reproduced the screenshot
- `~/.claude/jobs/2849bd27/listens.db` — 187,919 of tordar's listens in SQLite (86 MB)

These should be ported into `lib/` proper in Phase 1, not copied as-is.

## Open questions to resolve before Phase 1

- Postgres provider: Neon vs. Vercel Postgres vs. Supabase. Lean Neon for cost + cold-start speed.
- Should we keep the existing chart component library or rebuild as we touch each one?
- Sync queue: do we need it at launch, or wait until rate-limit signals appear?
- Should `/u/{username}` be discoverable (sitemap, search) or unlisted-by-default?
- What does the LB importer state-detection actually look like in practice — does listen-count grow monotonically during ingest, or does LB only flip it once ingest completes?
- MB OAuth client registration: does MetaBrainz throttle/approve new OAuth applications, or is it self-serve? Worth registering early to avoid blocking Phase 5.
- ZIP upload limits on Vercel: a 10-year Spotify Extended Streaming History export can exceed 50 MB compressed. Vercel function body limits (4.5 MB default; can be raised) may force a chunked-upload approach. Investigate before Phase 6.
- Should the Pulse importer also accept LB JSON dumps and Last.fm exports (both well-documented formats), so users migrating from other services have a single entry point? Probably a v2 question, but worth not designing it out.
