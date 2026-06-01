# pulse-lb

A ListenBrainz-backed listening visualizer. Type a public LB username and see their data — top artists, albums, songs, drill-downs by year, all from raw listens replicated into a local Postgres.

This is the LB-backed rewrite of `spotify-pulse`. See [`PLAN.md`](./PLAN.md) for the full architecture, decisions, and migration plan.

## Status

Phase 1 — vertical slice. Sync + top-10-artists query render against Postgres. No auth, no charts beyond the proof-of-concept page, no Spotify import yet. See PLAN.md for the full phase list.

## Local setup

1. **Get a Neon database.** Sign up at [neon.tech](https://console.neon.tech/) and create a project in `eu-central-1` (Frankfurt). Copy the connection string.

2. **Configure env:**
   ```bash
   cp .env.example .env
   # paste your Neon connection string into DATABASE_URL
   ```

3. **Generate + apply migrations:**
   ```bash
   npm run db:generate    # creates ./drizzle/*.sql from the schema
   npm run db:migrate     # applies them to your Neon DB
   ```

4. **Run the dev server:**
   ```bash
   npm run dev
   ```

5. **Try it:** open [http://localhost:3000/u/tordar](http://localhost:3000/u/tordar), click "Sync now". First sync takes ~3-5 min for a heavy library; subsequent syncs are sub-second.

## Architecture in two paragraphs

ListenBrainz is the source of truth for all listening data. Pulse replicates a user's raw listens into Postgres on demand (manual "sync now" button) and answers every drill-down with a SQL query against the local copy. Cover art comes from MusicBrainz Cover Art Archive via the `caa_id` field that LB enriches every listen with.

The new repo is a clean break from the legacy Spotify-API codebase. There is no Spotify integration, no GitHub Actions sync pipeline, no static JSON file generation, no user accounts table. Public LB profiles are viewable with no auth at all; private profiles (and the Pulse-hosted Spotify importer, when it lands) use a one-time MB OAuth + LB token paste stored only in an encrypted cookie.

## Tech

- Next.js 16, React 19, Tailwind 4
- Neon Postgres (HTTP driver via `@neondatabase/serverless`)
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
