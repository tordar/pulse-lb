# pulse-lb

A ListenBrainz-backed listening visualizer. Type a public LB username and see their data — top artists, albums, songs, drill-downs by year, all from raw listens replicated into a local Postgres.

This is the LB-backed rewrite of `spotify-pulse`. See [`PLAN.md`](./PLAN.md) for the full architecture, decisions, and migration plan.

## Status

Phase 1 — vertical slice. Sync + top-10-artists query render against Postgres. No auth, no charts beyond the proof-of-concept page, no Spotify import yet. See PLAN.md for the full phase list.

## Local setup

1. **Get a Postgres database.** Either run one locally with Docker
   (`docker compose up postgres -d` — see [Self-hosting](#self-hosting)) or use a
   hosted provider like [Neon](https://console.neon.tech/) (use the **pooled**
   endpoint + `sslmode=require`). Any standard Postgres works — the app connects
   via postgres-js.

2. **Configure env:**
   ```bash
   cp .env.example .env
   # set DATABASE_URL (local: postgres://pulse:pulse@localhost:5432/pulse)
   ```

3. **Generate + apply migrations:**
   ```bash
   npm run db:generate    # creates ./drizzle/*.sql from the schema
   npm run db:migrate     # applies them to the database in DATABASE_URL
   ```

4. **Run the dev server:**
   ```bash
   npm run dev
   ```

5. **Try it:** open [http://localhost:3000/u/tordar](http://localhost:3000/u/tordar), click "Sync now". First sync takes ~3-5 min for a heavy library; subsequent syncs are sub-second.

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

## Architecture in two paragraphs

ListenBrainz is the source of truth for all listening data. Pulse replicates a user's raw listens into Postgres on demand (manual "sync now" button) and answers every drill-down with a SQL query against the local copy. Cover art comes from MusicBrainz Cover Art Archive via the `caa_id` field that LB enriches every listen with.

The new repo is a clean break from the legacy Spotify-API codebase. There is no Spotify integration, no GitHub Actions sync pipeline, no static JSON file generation, no user accounts table. Public LB profiles are viewable with no auth at all; private profiles (and the Pulse-hosted Spotify importer, when it lands) use a one-time MB OAuth + LB token paste stored only in an encrypted cookie.

## Tech

- Next.js 16, React 19, Tailwind 4
- Postgres via postgres-js (works against local Postgres or Neon's pooled endpoint)
- Drizzle ORM + Drizzle Kit migrations
- Zod for runtime validation at the LB API boundary

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run db:generate` | Generate SQL migrations from the Drizzle schema |
| `npm run db:migrate` | Apply migrations to the database in `DATABASE_URL` |
| `npm run db:push` | (Dev shortcut) Push schema changes without generating migrations |
| `npm run db:studio` | Open Drizzle Studio in the browser |

## Roadmap

See [`PLAN.md`](./PLAN.md). Currently: Phase 0 (plan) + Phase 1 partial (data layer, LB client, sync, one validation page). Next: Phase 2 (read API + remaining drill-down queries), Phase 3 (port charts from legacy), Phase 5 (MB OAuth + token paste), Phase 6 (Spotify import).
