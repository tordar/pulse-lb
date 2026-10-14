# Landing page: listening landscape

**Date:** 2026-10-14
**Status:** design approved in brainstorm, awaiting spec review
**Prototype:** `.superpowers/brainstorm/71950-1791978387/content/proto-v6.html` (gitignored; real data snapshot in `data.json` beside it)

## Goal

Replace the bare "Sign in" button on `/` with a full-screen, data-driven picture of one
person's listening history, in an industrial/HUD style. It shows how much data is in
pulse, explains how a listen gets from a player to the page, and offers two ways in:
**View tordar's profile** and **Sign in with ListenBrainz**. It must look and feel right
on phones first, desktop second.

This supersedes the earlier "no copy on `/`" decision (memory
`pulse-lb-personal-not-saas`). App pages under `/u/…` keep their plain style; only `/`
gets this treatment.

## Decisions

- **One showcase user.** The page shows a single user's data, set by
  `SHOWCASE_USER` (default `tordar`). Self-hosters set their own. No platform-wide
  aggregate, so the friend's listens are never shown.
- **One scene, no modes.** The point-cloud mountain from prototype v6 is the whole hero.
  Field/terrain modes and tabs are dropped.
- **Every listen is one point.** x = date, z = hour of day (local time), y = smoothed
  density at that (date, hour). ~193k points today.
- **Motion:** slow "wind" sway of every point around its true position, plus soft
  light crests rolling along the time axis. No camera orbit, no cursor push. Reduced
  motion: static.
- **Callouts carry the meaning.** Three facts computed from the data, pinned to the
  mountain with hairlines: peak day, quietest full year, first listen.
- **Below the fold:** `01 — Instruments` (linked to the hero), then `02 — Pipeline`.
- **three.js** is added as the only new dependency, loaded only on `/`.
- **Signed-in users still skip `/`** (`proxy.ts` redirect, already in the working
  tree and not yet committed — this work builds on it).

## 1. Data

### `GET /api/landing/points`

A Route Handler that returns one binary payload for `SHOWCASE_USER`.

```
[u32 header length][header JSON][u32 ts × n][u16 artist × n]
header = { user, n, tz, artists: string[≤1000], firstTs, lastTs }
```

- `ts` is `listened_at` in epoch seconds, ordered ascending.
- `artist` is the artist's rank by play count (0 = most played). Artists ranked
  ≥ 1000 share the value 65535 and have no name in `artists`.
- `tz` comes from `SHOWCASE_TZ` (default `Europe/Oslo`); users have no stored time
  zone. The client derives day and minute-of-day from `ts` in that zone.
- Roughly 6 bytes per listen: about 1.2 MB raw, about 0.6 MB with gzip.
- **Caching:** `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`,
  so the Vercel CDN serves it and Neon is touched at most about once an hour. It
  does not go through `unstable_cache`, because the payload would be too close to
  the data-cache entry size limit.
- Only `SHOWCASE_USER` can be requested; there is no username parameter.

### `GET /api/landing/listen?ts=<epoch>`

This is the hover/tap readout. It returns `{ track, artist, recordingMbid, listenedAt }`
for the showcase user's listen at that timestamp. The response has the same CDN cache
headers, with `max-age` set long, since a past listen never changes. The client calls
it only after the pointer rests on a point (debounced 150 ms) or on tap. The
"Latest" line and the pipeline packet use it once, with `lastTs`.

### Server-rendered numbers

The page shell renders totals from `agg_alltime` through `userCached` (listens,
artists, albums, songs, first listen). Pipeline values come from the same row. The
DB-size figure from the prototype is dropped.

### Client-side derived data (no extra requests)

From the points payload, the client builds:
- the density heightfield
- the callouts (peak day, quietest year, first listen)
- the weekday×hour punch card
- listens per year
- top 10 artists

## 2. Components

```
app/page.tsx                       wrapper; keeps ErrorBanners; renders <Landing>
app/_landing/Landing.tsx           server: HUD shell + sections, totals via userCached
app/_landing/Scene.tsx             client: canvas, three.js, wind, picking, callouts
app/_landing/Instruments.tsx       client: punch card, years, top artists, totals → filter
app/_landing/Pipeline.tsx          server: 7 stages + client "packet" ticker
app/_landing/useLandingData.ts     client: fetch + decode payload, shared via context
lib/landing/encode.ts              build the binary payload (server)
lib/landing/decode.ts              parse it (client) — pure, unit-tested with encode
lib/landing/derive.ts              heightfield, callouts, punch card, years (pure)
app/api/landing/points/route.ts
app/api/landing/listen/route.ts
```

- `Scene` and `Instruments` share one state (`filter`, `pinned`) through a small
  context in `Landing`. A filter is `{ type: weekdayHour | year | artist, … }` and maps
  to shader uniforms, as in the prototype.
- three.js is imported dynamically inside `Scene`, so it never lands in other routes'
  bundles.
- The styling follows the prototype: mono system font stack (no new web fonts),
  `#050505` background, `#ececec` text, a single accent `#ff4a2e` used only for active
  filters. It lives in a CSS module scoped to the landing page.

## 3. Hero behaviour

| | Desktop | Phone (portrait) |
|---|---|---|
| Camera | front-left view, pitch 0.5 | time axis recedes into depth, closer zoom, fills the screen edge to edge |
| Drag | rotates (yaw/pitch) | scrolls the page; no rotate |
| Hover / tap | crosshair + readout after 150 ms | tap pins readout; tap elsewhere clears |
| Readout | date · time, track, artist, **→ song page** link | same |
| Buttons | bottom-right stack | full-width stack, 48px+, safe-area padding |
| Latest listen | bottom-left | above buttons |

- The camera is still except when the user drags. Callouts project from 3D every
  frame and fade out on scroll or while a filter is active.
- The canvas is fixed behind the page; the sections scroll over it on translucent
  panels. The scene dims as you scroll.
- Rendering pauses when the tab is hidden. Pixel ratio is capped at 1.5 on phones and
  2 on desktop.

## 4. Sections

**01 — Instruments.** Clicking a cell or row lights up matching points in the hero
(accent colour) and dims the rest. Clicking it again clears the filter, and a chip in
the HUD shows the active filter with an × to clear it. The gauges:
- weekday×hour punch card
- listens per year
- top 10 artists
- totals

**02 — Pipeline.** The stages: ListenBrainz → OAuth/JWT → poll + delta ingest →
MusicBrainz enrichment → Postgres → `agg_*` tables → Next.js Cache Components. Each
stage has a one-paragraph spec line and a live number where one exists. A "packet"
carrying the latest listen steps through the stages.

## 5. Failure handling

- **No WebGL:** the HUD, buttons and sections still render, with a static line where
  the scene would be. Sign-in always works.
- **Points request fails or is slow:** the shell and buttons show immediately and the
  scene fades in once the data arrives. On error, show a small `DATA UNAVAILABLE`
  label instead of the scene.
- **Listen readout fails:** the readout shows date and time only.
- **`?error=upstream|auth` banners:** they keep working and appear above the HUD.
- **`SHOWCASE_USER` missing in the DB:** the page renders only the buttons, which is
  today's behaviour.

## 6. Testing

1. **Unit** (`lib/landing/*.test.ts`, `npm test`):
   - `encode` → `decode` round-trip
   - `derive` on a tiny fixture: peak day, quietest full year, punch-card counts
2. **e2e** (`render.spec.ts` already covers `/`). Extend it to check, on the desktop
   and phone projects:
   - the canvas mounts
   - both buttons are visible
   - `/api/landing/points` returns 200 with a sane `n`
   - there are no page errors
3. **Before pushing:**
   - load `/` against the real DB at both sizes and look at it (per the
     verify-by-rendering rule)
   - check `/api/landing/points` response headers for the CDN cache
   - check there's no three.js in other routes' bundles

## Out of scope

- Live updating of the scene while the page is open (new listens appear on the next
  hourly payload).
- Multiple showcase users or a picker.
- Gyroscope tilt, sound, replay mode.
