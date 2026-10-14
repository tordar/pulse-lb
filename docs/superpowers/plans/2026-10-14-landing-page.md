# Landing Page (Listening Landscape) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare sign-in button on `/` with a full-screen WebGL point-cloud of the showcase user's listens, a linked Instruments section and a Pipeline section, plus "View profile" and "Sign in" buttons. It works on phone and desktop.

**Architecture:**
- **Data:** one CDN-cached Route Handler streams every listen as a compact binary payload (`ts u32`, `artist-rank u16`).
- **Client:** decodes it, localizes timestamps, and derives a density heightfield plus the instrument data with pure functions in `lib/landing/`.
- **Rendering:** a three.js scene (dynamically imported, `/` only) renders one point per listen with a shader-driven "wind". Instruments drive shader filter uniforms.
- **Readouts:** hover and tap readouts fetch one listen at a time from a second cached route.

**Tech Stack:** Next.js 16.4 (App Router, `cacheComponents: true`), React 19.3, three.js 0.169.0, postgres-js, node:test via `tsx --test`, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-10-14-landing-page-design.md`
**Visual reference:** `.superpowers/brainstorm/71950-1791978387/content/proto-v6.html` (working prototype; port behaviour from it, not code style)

## Global Constraints

- **Showcase user:** `SHOWCASE_USER` env, default `tordar`. Time zone: `SHOWCASE_TZ` env, default `Europe/Oslo`. Never expose another user's data; the routes take no username parameter.
- **Points route cache:** `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`.
- **Listen route cache:** `Cache-Control: public, max-age=86400, s-maxage=31536000, immutable`. Errors: `no-store`.
- **Dependencies:** `three@0.169.0` is the only new runtime dependency, and `@types/three@0.169.0` is a dev dependency. Import three only via `await import("three")` inside `app/_landing/scene/createScene.ts`.
- **Look:**
  - Font: the app's existing `var(--font-jetbrains-mono)`. No new web fonts.
  - Colours: background `#050505`, text `#8d8d8d`, bright `#ececec`, dim `#4a4a4a`, lines `#262626`, accent `#ff4a2e`. The accent is used only for active filters.
- **Hero motion:**
  - Point wind and light crests only. No camera orbit and no cursor push.
  - The camera moves only on desktop drag.
  - `prefers-reduced-motion: reduce` turns all motion off.
- **Phone (portrait):**
  - Drags scroll the page and never rotate the scene. A tap pins a readout.
  - Buttons are full width and at least 48px tall, with `env(safe-area-inset-*)` padding.
- **Order below the fold:** `// 01 — INSTRUMENTS`, then `// 02 — PIPELINE`.
- **Signed-in users:** they never see `/`. The redirect lives in `proxy.ts`, already in the working tree; don't touch it.
- **Next 16 rules:**
  - No `export const dynamic` or `revalidate` on pages.
  - `searchParams` and cookies are read only inside `<Suspense>`.
  - Route Handlers that hit the DB call `await connection()` first.
- **Git:** do NOT commit. The user commits manually (global CLAUDE.md: "Never commit unless explicitly asked"). Each task ends with a verification step instead of a commit.
- **Tests:** unit tests live next to their source as `lib/landing/*.test.ts`. Run them with `npm test`.

## Review Focus

1. **A listen in the half hour after local midnight**, e.g. 2024-07-01T22:30Z in Europe/Oslo. Expected: it lands on 2024-07-02 at minute 30, and counts toward 2024-07-02's weekday and year. Owned by Task 2's `localize` and `yearCounts` tests.
2. **A New Year's Eve listen just after local midnight** (2024-12-31T23:30Z in Oslo is 2025-01-01 00:30). Expected: the year filter for 2025 includes it and 2024 excludes it. Owned by Task 2's `matches` test.
3. **Artist names with quotes, emoji, CJK and empty strings.** Expected: they survive encode → decode byte-for-byte. Owned by Task 1.
4. **`/api/landing/listen` with a missing, negative, fractional or non-numeric `ts`.** Expected: 400 with `no-store`, never 500. Owned by Task 3's `parseTs` test.
5. **Showcase user with zero listens or missing from the DB.** Expected: `/api/landing/points` returns 404 and `/` shows only the sign-in button, today's behaviour. Owned by Task 3's `buildPayload` empty test and Task 5's `Landing` guard.

---

## File Structure

```
lib/landing/payload.ts        binary codec (encode/decode) + LandingPayload types       [Task 1]
lib/landing/payload.test.ts
lib/landing/derive.ts         pure: localize, heightfield, callouts, punch card, years,
                              top artists, filters, labels                              [Task 2]
lib/landing/derive.test.ts
lib/landing/showcase.ts       showcaseUser(), showcaseTz()                              [Task 3]
lib/landing/build.ts          buildPayload(rows, ranking) — pure; parseTs()             [Task 3]
lib/landing/build.test.ts
lib/landing/query.ts          loadShowcasePayload(), loadListenAt() — DB                [Task 3]
app/api/landing/points/route.ts                                                         [Task 3]
app/api/landing/listen/route.ts                                                         [Task 3]
app/_landing/scene/positions.ts   world-space mapping (W, buildPositions, topOf)        [Task 4]
app/_landing/scene/createScene.ts three.js scene, shader, camera, picking               [Task 4]
app/_landing/landing.module.css   all landing styles                                    [Task 5]
app/_landing/listen.ts            fetchListen(ts) client cache                          [Task 5]
app/_landing/useLandingData.ts    fetch + decode + prepare                              [Task 5]
app/_landing/SignInOnly.tsx       today's centered button (fallback)                    [Task 5]
app/_landing/Landing.tsx          server: totals via allTimeStats → LandingClient       [Task 5]
app/_landing/LandingClient.tsx    client: state (filter, latest), layout                [Task 5]
app/_landing/Hud.tsx              corner HUD, chip, buttons                             [Task 5]
app/_landing/Scene.tsx            canvas, hero surface, pointer handling, callouts,
                                  readout                                               [Task 5]
app/_landing/Instruments.tsx      punch card, years, top artists, totals → filter       [Task 6]
app/_landing/Pipeline.tsx         7 stages + packet ticker                              [Task 7]
app/page.tsx                      wrapper: ErrorBanners + <Landing/>                    [Task 5]
e2e/render.spec.ts                landing scene test                                    [Task 8]
```

---

### Task 1: Binary payload codec

**Files:**
- Create: `lib/landing/payload.ts`
- Test: `lib/landing/payload.test.ts`

**Interfaces:**
- Produces:
  - `type LandingHeader = { user: string; n: number; tz: string; artists: string[]; firstTs: number; lastTs: number }`
  - `type LandingPayload = { header: LandingHeader; ts: Uint32Array; artist: Uint16Array }`
  - `const OTHER_ARTIST = 65535`
  - `const MAX_NAMED_ARTISTS = 1000`
  - `encodePayload(p: LandingPayload): Uint8Array`
  - `decodePayload(buf: ArrayBuffer): LandingPayload` (throws `Error("bad landing payload")` on malformed input)

- [ ] **Step 1: Write the failing test**

```ts
// lib/landing/payload.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePayload, encodePayload, OTHER_ARTIST, type LandingPayload } from "./payload";

const sample = (n: number, artists: string[]): LandingPayload => ({
  header: { user: "tordar", n, tz: "Europe/Oslo", artists, firstTs: n ? 1_250_000_000 : 0, lastTs: n ? 1_250_000_000 + n : 0 },
  ts: Uint32Array.from({ length: n }, (_, i) => 1_250_000_000 + i),
  artist: Uint16Array.from({ length: n }, (_, i) => (i % 3 === 2 ? OTHER_ARTIST : i % 3)),
});

const toArrayBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

test("round-trips header and both columns", () => {
  const p = sample(7, ["Radiohead", "Bon Iver"]);
  const back = decodePayload(toArrayBuffer(encodePayload(p)));
  assert.deepEqual(back.header, p.header);
  assert.deepEqual([...back.ts], [...p.ts]);
  assert.deepEqual([...back.artist], [...p.artist]);
});

test("keeps quotes, emoji, CJK and empty artist names intact", () => {
  const names = ['Sigur Rós', 'The "Band"', "坂本龍一", "🎧 dj", ""];
  const back = decodePayload(toArrayBuffer(encodePayload(sample(3, names))));
  assert.deepEqual(back.header.artists, names);
});

test("header lengths that are not a multiple of 4 still align the columns", () => {
  for (const extra of ["", "a", "ab", "abc"]) {
    const p = sample(5, ["x" + extra]);
    const back = decodePayload(toArrayBuffer(encodePayload(p)));
    assert.deepEqual([...back.ts], [...p.ts]);
  }
});

test("empty payload round-trips", () => {
  const back = decodePayload(toArrayBuffer(encodePayload(sample(0, []))));
  assert.equal(back.header.n, 0);
  assert.equal(back.ts.length, 0);
});

test("truncated buffer throws", () => {
  const bytes = encodePayload(sample(4, ["a"]));
  assert.throws(() => decodePayload(toArrayBuffer(bytes.slice(0, bytes.length - 3))), /bad landing payload/);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx tsx --test lib/landing/payload.test.ts`
Expected: FAIL, `Cannot find module './payload'`.

- [ ] **Step 3: Implement**

```ts
// lib/landing/payload.ts
// Wire format for /api/landing/points:
//   [u32 LE header byte length][header JSON utf-8][zero pad to 4][u32 ts × n][u16 artist × n]
// Typed arrays use platform byte order; every browser and server we target is little-endian.
export type LandingHeader = { user: string; n: number; tz: string; artists: string[]; firstTs: number; lastTs: number };
export type LandingPayload = { header: LandingHeader; ts: Uint32Array; artist: Uint16Array };

/** Artist rank for everyone outside the top MAX_NAMED_ARTISTS. */
export const OTHER_ARTIST = 65535;
export const MAX_NAMED_ARTISTS = 1000;

export function encodePayload(p: LandingPayload): Uint8Array {
  const head = new TextEncoder().encode(JSON.stringify(p.header));
  const n = p.header.n;
  const tsOff = Math.ceil((4 + head.length) / 4) * 4;
  const out = new Uint8Array(tsOff + n * 4 + n * 2);
  new DataView(out.buffer).setUint32(0, head.length, true);
  out.set(head, 4);
  new Uint32Array(out.buffer, tsOff, n).set(p.ts.subarray(0, n));
  new Uint16Array(out.buffer, tsOff + n * 4, n).set(p.artist.subarray(0, n));
  return out;
}

export function decodePayload(buf: ArrayBuffer): LandingPayload {
  const bad = () => new Error("bad landing payload");
  if (buf.byteLength < 4) throw bad();
  const headLen = new DataView(buf).getUint32(0, true);
  if (4 + headLen > buf.byteLength) throw bad();
  let header: LandingHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headLen)));
  } catch {
    throw bad();
  }
  const n = header.n;
  const tsOff = Math.ceil((4 + headLen) / 4) * 4;
  if (!Number.isInteger(n) || n < 0 || tsOff + n * 6 !== buf.byteLength) throw bad();
  return {
    header,
    ts: new Uint32Array(buf.slice(tsOff, tsOff + n * 4)),
    artist: new Uint16Array(buf.slice(tsOff + n * 4, tsOff + n * 6)),
  };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx tsx --test lib/landing/payload.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p .`
Expected: no errors in `lib/landing/`.

---

### Task 2: Pure derivations (localize, heightfield, callouts, instruments, filters)

**Files:**
- Create: `lib/landing/derive.ts`
- Test: `lib/landing/derive.test.ts`

**Interfaces:**
- Consumes: `LandingPayload`, `OTHER_ARTIST` from Task 1.
- Produces:
  - `type Prepared = { payload: LandingPayload; day: Uint16Array; minute: Uint16Array; baseMs: number; maxDay: number; baseWeekday: number; hf: Heightfield }`
    - `baseMs`: UTC ms of local day 0 at 00:00, treated as a UTC date
    - `baseWeekday`: Mon=0 weekday of day 0
  - `type Heightfield = { gx: number; gz: number; grid: Float32Array; max: number }`
  - `type Filter = { kind: "slot"; weekday: number; hour: number } | { kind: "year"; year: number; from: number; to: number } | { kind: "artist"; rank: number }`
    - `from` and `to` are day indexes, half-open `[from, to)`
  - `type Callout = { key: string; label: string; value: string; day: number; index?: number }`
  - `localize(ts: Uint32Array, tz: string): { day: Uint16Array; minute: Uint16Array; baseMs: number; maxDay: number }`
  - `prepare(p: LandingPayload): Prepared`
  - `heightfield(day: Uint16Array, minute: Uint16Array, maxDay: number, gx?: number, gz?: number): Heightfield` (defaults 160 and 48)
  - `heightAt(hf: Heightfield, u: number, v: number): number`, returning 0..1
  - `dayStr(baseMs: number, day: number): string` (`YYYY-MM-DD`)
  - `minStr(minute: number): string` (`HH:MM`)
  - `yearOf(baseMs: number, day: number): number`
  - `yearStartDay(baseMs: number, year: number): number`
  - `yearCounts(p: Prepared): Map<number, number>`
  - `punchCard(p: Prepared): number[][]` (`[7][24]`, Mon=0)
  - `topArtists(p: Prepared, k: number): { rank: number; name: string; count: number }[]`
  - `callouts(p: Prepared): Callout[]`
  - `matches(f: Filter, p: Prepared, i: number): boolean`
  - `countMatches(f: Filter, p: Prepared): number`
  - `filterLabel(f: Filter, p: Prepared): string`
  - `filterUniforms(f: Filter | null): { uF: number; uA: number; uB: number }`
  - `const WEEKDAYS = ["MON","TUE","WED","THU","FRI","SAT","SUN"]`

- [ ] **Step 1: Write the failing test**

```ts
// lib/landing/derive.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { OTHER_ARTIST, type LandingPayload } from "./payload";
import {
  callouts, countMatches, dayStr, filterLabel, filterUniforms, heightAt, localize, matches,
  minStr, prepare, punchCard, topArtists, yearCounts, yearStartDay,
} from "./derive";

const s = (iso: string) => Date.parse(iso) / 1000;

function payload(isoList: string[], artists: number[], tz = "Europe/Oslo"): LandingPayload {
  const ts = Uint32Array.from(isoList.map(s));
  return {
    header: { user: "u", n: ts.length, tz, artists: ["A", "B", "C"], firstTs: ts[0] ?? 0, lastTs: ts[ts.length - 1] ?? 0 },
    ts, artist: Uint16Array.from(artists),
  };
}

test("localize: 22:30Z in summer is 00:30 next day in Oslo", () => {
  const l = localize(Uint32Array.from([s("2024-07-01T10:00:00Z"), s("2024-07-01T22:30:00Z")]), "Europe/Oslo");
  assert.equal(dayStr(l.baseMs, l.day[0]), "2024-07-01");
  assert.equal(dayStr(l.baseMs, l.day[1]), "2024-07-02");
  assert.equal(l.minute[1], 30);
  assert.equal(minStr(l.minute[0]), "12:00");
  assert.equal(l.maxDay, 1);
});

test("localize: UTC is identity", () => {
  const l = localize(Uint32Array.from([s("2020-01-01T23:59:00Z")]), "UTC");
  assert.equal(dayStr(l.baseMs, l.day[0]), "2020-01-01");
  assert.equal(l.minute[0], 23 * 60 + 59);
});

test("New Year's Eve 23:30Z counts for the new year in Oslo", () => {
  const p = prepare(payload(["2024-06-01T12:00:00Z", "2024-12-31T23:30:00Z"], [0, 1]));
  const years = yearCounts(p);
  assert.equal(years.get(2024), 1);
  assert.equal(years.get(2025), 1);
  const y2025 = { kind: "year" as const, year: 2025, from: yearStartDay(p.baseMs, 2025), to: yearStartDay(p.baseMs, 2026) };
  assert.equal(matches(y2025, p, 1), true);
  assert.equal(matches(y2025, p, 0), false);
  assert.equal(countMatches(y2025, p), 1);
});

test("punch card uses local weekday and hour (Mon=0)", () => {
  // 2024-07-01 is a Monday; 22:30Z is Tuesday 00:30 in Oslo.
  const p = prepare(payload(["2024-07-01T10:00:00Z", "2024-07-01T22:30:00Z"], [0, 0]));
  const pc = punchCard(p);
  assert.equal(pc[0][12], 1);
  assert.equal(pc[1][0], 1);
  assert.equal(matches({ kind: "slot", weekday: 1, hour: 0 }, p, 1), true);
  assert.equal(matches({ kind: "slot", weekday: 1, hour: 0 }, p, 0), false);
});

test("top artists skip OTHER_ARTIST and sort by count", () => {
  const p = prepare(payload(
    ["2024-01-01T10:00:00Z", "2024-01-01T11:00:00Z", "2024-01-01T12:00:00Z", "2024-01-01T13:00:00Z"],
    [1, 1, 0, OTHER_ARTIST],
  ));
  assert.deepEqual(topArtists(p, 5), [{ rank: 1, name: "B", count: 2 }, { rank: 0, name: "A", count: 1 }]);
  assert.equal(matches({ kind: "artist", rank: 1 }, p, 0), true);
  assert.equal(filterLabel({ kind: "artist", rank: 1 }, p), "B");
});

test("callouts: peak day, quietest full year, first listen", () => {
  const iso = [
    "2019-12-31T12:00:00Z",                                            // partial first year
    "2020-03-01T10:00:00Z", "2020-03-01T11:00:00Z", "2020-03-01T12:00:00Z", // peak day, 2020 = 3
    "2021-05-05T10:00:00Z",                                            // quietest full year = 1
    "2022-01-01T10:00:00Z", "2022-02-01T10:00:00Z",                    // 2022 = 2
    "2023-01-01T10:00:00Z",                                            // partial last year
  ];
  const p = prepare(payload(iso, iso.map(() => 0)));
  const byKey = Object.fromEntries(callouts(p).map((c) => [c.key, c]));
  assert.equal(byKey.peak.value, "2020-03-01 · 3 LISTENS");
  assert.equal(byKey.quiet.value, "2021 · 1 LISTENS");
  assert.equal(byKey.first.value, "2019-12-31");
  assert.equal(byKey.first.index, 0);
});

test("callouts omit quietest year when there is no full year", () => {
  const p = prepare(payload(["2024-01-01T10:00:00Z", "2024-02-01T10:00:00Z"], [0, 0]));
  assert.equal(callouts(p).some((c) => c.key === "quiet"), false);
});

test("heightfield peaks where listens cluster, normalized to 0..1", () => {
  const iso = Array.from({ length: 50 }, (_, i) => `2024-01-${String(1 + (i % 2)).padStart(2, "0")}T20:00:00Z`)
    .concat(["2024-12-31T05:00:00Z"]);
  const p = prepare(payload(iso, iso.map(() => 0)));
  const hot = heightAt(p.hf, 0.003, 21 / 24);
  const cold = heightAt(p.hf, 0.5, 0.25);
  assert.ok(hot > 0.5 && hot <= 1, `hot=${hot}`);
  assert.ok(cold < 0.05, `cold=${cold}`);
});

test("filterUniforms maps each kind", () => {
  assert.deepEqual(filterUniforms(null), { uF: 0, uA: 0, uB: 0 });
  assert.deepEqual(filterUniforms({ kind: "slot", weekday: 3, hour: 23 }), { uF: 1, uA: 3, uB: 23 });
  assert.deepEqual(filterUniforms({ kind: "year", year: 2020, from: 10, to: 20 }), { uF: 2, uA: 10, uB: 20 });
  assert.deepEqual(filterUniforms({ kind: "artist", rank: 4 }), { uF: 3, uA: 4, uB: 0 });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx tsx --test lib/landing/derive.test.ts`
Expected: FAIL, `Cannot find module './derive'`.

- [ ] **Step 3: Implement**

```ts
// lib/landing/derive.ts
import { OTHER_ARTIST, type LandingPayload } from "./payload";

export type Heightfield = { gx: number; gz: number; grid: Float32Array; max: number };
export type Prepared = {
  payload: LandingPayload; day: Uint16Array; minute: Uint16Array;
  baseMs: number; maxDay: number; baseWeekday: number; hf: Heightfield;
};
export type Filter =
  | { kind: "slot"; weekday: number; hour: number }
  | { kind: "year"; year: number; from: number; to: number }
  | { kind: "artist"; rank: number };
export type Callout = { key: string; label: string; value: string; day: number; index?: number };

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_MS = 864e5;

function offsetFinder(tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const cache = new Map<number, number>();
  // Offset is sampled once per UTC day at noon; DST switches happen at night, so at most
  // an hour of listens on two days a year is shifted by an hour.
  return (ms: number) => {
    const key = Math.floor(ms / DAY_MS);
    let off = cache.get(key);
    if (off === undefined) {
      const at = key * DAY_MS + DAY_MS / 2;
      const p: Record<string, number> = {};
      for (const part of fmt.formatToParts(new Date(at))) if (part.type !== "literal") p[part.type] = Number(part.value);
      off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
      cache.set(key, off);
    }
    return off;
  };
}

export function localize(ts: Uint32Array, tz: string) {
  const n = ts.length, offset = offsetFinder(tz);
  const localDay = new Float64Array(n), minute = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const ms = ts[i] * 1000, local = ms + offset(ms);
    localDay[i] = Math.floor(local / DAY_MS);
    minute[i] = Math.floor((local - localDay[i] * DAY_MS) / 6e4);
  }
  let first = Infinity, last = -Infinity;
  for (let i = 0; i < n; i++) { if (localDay[i] < first) first = localDay[i]; if (localDay[i] > last) last = localDay[i]; }
  if (!n) first = last = 0;
  const day = new Uint16Array(n);
  for (let i = 0; i < n; i++) day[i] = localDay[i] - first;
  return { day, minute, baseMs: first * DAY_MS, maxDay: last - first };
}

export const dayStr = (baseMs: number, day: number) => new Date(baseMs + day * DAY_MS).toISOString().slice(0, 10);
export const minStr = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const yearOf = (baseMs: number, day: number) => new Date(baseMs + day * DAY_MS).getUTCFullYear();
export const yearStartDay = (baseMs: number, year: number) => Math.round((Date.UTC(year, 0, 1) - baseMs) / DAY_MS);

export function heightfield(day: Uint16Array, minute: Uint16Array, maxDay: number, gx = 160, gz = 48): Heightfield {
  const grid = new Float32Array(gx * gz);
  for (let i = 0; i < day.length; i++) {
    const x = Math.min(gx - 1, Math.floor((day[i] / (maxDay + 1)) * gx));
    grid[x * gz + Math.floor((minute[i] / 1440) * gz)]++;
  }
  for (let pass = 0; pass < 3; pass++) {
    const g = grid.slice();
    for (let x = 0; x < gx; x++) for (let z = 0; z < gz; z++) {
      let sum = 0, w = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const xx = x + dx; if (xx < 0 || xx >= gx) continue;
        sum += g[xx * gz + ((z + dz + gz) % gz)]; w++;
      }
      grid[x * gz + z] = sum / w;
    }
  }
  let max = 0; for (const v of grid) if (v > max) max = v;
  return { gx, gz, grid, max: max || 1 };
}

/** Smoothed density at (u = date 0..1, v = time of day 0..1, wraps), 0..1 with a gamma lift. */
export function heightAt(hf: Heightfield, u: number, v: number): number {
  const { gx, gz, grid } = hf;
  const fx = Math.min(gx - 1.001, Math.max(0, u * gx - 0.5)), fz = v * gz - 0.5;
  const x0 = Math.floor(fx), x1 = Math.min(gx - 1, x0 + 1), tx = fx - x0;
  const zf = Math.floor(fz), z0 = ((zf % gz) + gz) % gz, z1 = (z0 + 1) % gz, tz = fz - zf;
  const a = grid[x0 * gz + z0] * (1 - tx) + grid[x1 * gz + z0] * tx;
  const b = grid[x0 * gz + z1] * (1 - tx) + grid[x1 * gz + z1] * tx;
  return Math.pow((a * (1 - tz) + b * tz) / hf.max, 0.75);
}

export function prepare(payload: LandingPayload): Prepared {
  const l = localize(payload.ts, payload.header.tz);
  const baseWeekday = (new Date(l.baseMs).getUTCDay() + 6) % 7;
  return { payload, ...l, baseWeekday, hf: heightfield(l.day, l.minute, l.maxDay) };
}

export function yearCounts(p: Prepared): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 0; i < p.day.length; i++) { const y = yearOf(p.baseMs, p.day[i]); out.set(y, (out.get(y) ?? 0) + 1); }
  return out;
}

export function punchCard(p: Prepared): number[][] {
  const pc = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (let i = 0; i < p.day.length; i++) pc[(p.baseWeekday + p.day[i]) % 7][Math.floor(p.minute[i] / 60)]++;
  return pc;
}

export function topArtists(p: Prepared, k: number) {
  const counts = new Map<number, number>();
  for (const r of p.payload.artist) if (r !== OTHER_ARTIST) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([rank, count]) => ({ rank, name: p.payload.header.artists[rank] ?? "", count }));
}

export function callouts(p: Prepared): Callout[] {
  if (!p.day.length) return [];
  const perDay = new Uint32Array(p.maxDay + 1);
  for (const d of p.day) perDay[d]++;
  let peak = 0; for (let d = 1; d <= p.maxDay; d++) if (perDay[d] > perDay[peak]) peak = d;
  const out: Callout[] = [{ key: "peak", label: "PEAK DAY", value: `${dayStr(p.baseMs, peak)} · ${perDay[peak]} LISTENS`, day: peak }];
  const firstYear = yearOf(p.baseMs, 0), lastYear = yearOf(p.baseMs, p.maxDay);
  const full = [...yearCounts(p).entries()].filter(([y]) => y > firstYear && y < lastYear).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (full.length) {
    const [y, c] = full[0];
    out.push({ key: "quiet", label: "QUIETEST YEAR", value: `${y} · ${c.toLocaleString("en-US")} LISTENS`, day: yearStartDay(p.baseMs, y) + 182 });
  }
  out.push({ key: "first", label: "FIRST LISTEN", value: dayStr(p.baseMs, 0), day: 0, index: 0 });
  return out;
}

export function matches(f: Filter, p: Prepared, i: number): boolean {
  if (f.kind === "slot") return (p.baseWeekday + p.day[i]) % 7 === f.weekday && Math.floor(p.minute[i] / 60) === f.hour;
  if (f.kind === "year") return p.day[i] >= f.from && p.day[i] < f.to;
  return p.payload.artist[i] === f.rank;
}

export function countMatches(f: Filter, p: Prepared): number {
  let c = 0; for (let i = 0; i < p.day.length; i++) if (matches(f, p, i)) c++;
  return c;
}

export function filterLabel(f: Filter, p: Prepared): string {
  if (f.kind === "slot") return `${WEEKDAYS[f.weekday]} ${String(f.hour).padStart(2, "0")}:00`;
  if (f.kind === "year") return String(f.year);
  return p.payload.header.artists[f.rank] ?? "";
}

export function filterUniforms(f: Filter | null) {
  if (!f) return { uF: 0, uA: 0, uB: 0 };
  if (f.kind === "slot") return { uF: 1, uA: f.weekday, uB: f.hour };
  if (f.kind === "year") return { uF: 2, uA: f.from, uB: f.to };
  return { uF: 3, uA: f.rank, uB: 0 };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx tsx --test lib/landing/derive.test.ts`
Expected: 9 passing. If the heightfield test fails on its thresholds, print `hot`/`cold` and fix the code, not the thresholds, unless the fixture itself is wrong.

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: every suite passes, the existing `lib/**` tests included. The real-size performance check (about 193k listens, `prepare()` under 1 s in a browser) happens in Task 5, Step 6.

---

### Task 3: Server data: showcase config, payload builder, two Route Handlers

**Files:**
- Create: `lib/landing/showcase.ts`
- Create: `lib/landing/build.ts`
- Test: `lib/landing/build.test.ts`
- Create: `lib/landing/query.ts`
- Create: `app/api/landing/points/route.ts`
- Create: `app/api/landing/listen/route.ts`

**Interfaces:**
- Consumes: `LandingPayload`, `encodePayload`, `OTHER_ARTIST`, `MAX_NAMED_ARTISTS` (Task 1).
- Produces:
  - `showcaseUser(): string`
  - `showcaseTz(): string`
  - `buildPayload(user: string, tz: string, rows: { ts: number; artist: string }[], ranking: string[]): LandingPayload | null`
  - `parseTs(raw: string | null): number | null`
  - `loadShowcasePayload(): Promise<LandingPayload | null>`
  - `loadListenAt(ts: number): Promise<ListenAt | null>`
  - `type ListenAt = { track: string; artist: string; recordingMbid: string | null; listenedAt: string }`
  - HTTP: `GET /api/landing/points` returns `application/octet-stream`, or 404
  - HTTP: `GET /api/landing/listen?ts=<int>` returns `ListenAt` JSON, 400 or 404

- [ ] **Step 1: Write the failing test**

```ts
// lib/landing/build.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload, parseTs } from "./build";
import { OTHER_ARTIST } from "./payload";

test("ranks named artists, maps the rest to OTHER_ARTIST, keeps order", () => {
  const p = buildPayload("u", "UTC", [
    { ts: 10, artist: "B" }, { ts: 20, artist: "A" }, { ts: 30, artist: "Z" },
  ], ["A", "B"])!;
  assert.deepEqual([...p.ts], [10, 20, 30]);
  assert.deepEqual([...p.artist], [1, 0, OTHER_ARTIST]);
  assert.deepEqual(p.header, { user: "u", n: 3, tz: "UTC", artists: ["A", "B"], firstTs: 10, lastTs: 30 });
});

test("no listens → null", () => {
  assert.equal(buildPayload("u", "UTC", [], []), null);
});

test("parseTs accepts positive integers only", () => {
  assert.equal(parseTs("1700000000"), 1700000000);
  for (const bad of [null, "", "abc", "-5", "1.5", "0", "1e9", "99999999999"]) assert.equal(parseTs(bad), null, String(bad));
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx tsx --test lib/landing/build.test.ts`
Expected: FAIL, `Cannot find module './build'`.

- [ ] **Step 3: Implement the pure parts**

```ts
// lib/landing/showcase.ts
/** Whose listens the public landing page shows. Self-hosters set their own. */
export const showcaseUser = () => process.env.SHOWCASE_USER || "tordar";
/** Users have no stored time zone; the landing page localizes in this one. */
export const showcaseTz = () => process.env.SHOWCASE_TZ || "Europe/Oslo";
```

```ts
// lib/landing/build.ts
import { MAX_NAMED_ARTISTS, OTHER_ARTIST, type LandingPayload } from "./payload";

/** rows must be ordered by ts ascending; ranking is artist names by play count, most first. */
export function buildPayload(user: string, tz: string, rows: { ts: number; artist: string }[], ranking: string[]): LandingPayload | null {
  if (!rows.length) return null;
  const artists = ranking.slice(0, MAX_NAMED_ARTISTS);
  const rank = new Map(artists.map((a, i) => [a, i]));
  const ts = new Uint32Array(rows.length), artist = new Uint16Array(rows.length);
  rows.forEach((r, i) => { ts[i] = r.ts; artist[i] = rank.get(r.artist) ?? OTHER_ARTIST; });
  return { header: { user, n: rows.length, tz, artists, firstTs: ts[0], lastTs: ts[rows.length - 1] }, ts, artist };
}

/** Epoch seconds from a query param; null unless a positive integer that fits in u32. */
export function parseTs(raw: string | null): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n <= 0xffffffff ? n : null;
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx tsx --test lib/landing/build.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Implement the DB layer and the routes**

```ts
// lib/landing/query.ts
import { sqlClient } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { buildPayload } from "./build";
import { MAX_NAMED_ARTISTS, type LandingPayload } from "./payload";
import { showcaseTz, showcaseUser } from "./showcase";

export type ListenAt = { track: string; artist: string; recordingMbid: string | null; listenedAt: string };

export async function loadShowcasePayload(): Promise<LandingPayload | null> {
  const user = showcaseUser();
  const ranking = await withRetry(() => sqlClient<{ a: string }[]>`
    SELECT coalesce(artist_name, '') AS a FROM listens WHERE user_name = ${user}
    GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT ${MAX_NAMED_ARTISTS}`);
  const rows = await withRetry(() => sqlClient<{ ts: string; a: string }[]>`
    SELECT extract(epoch FROM listened_at)::bigint AS ts, coalesce(artist_name, '') AS a
    FROM listens WHERE user_name = ${user} ORDER BY listened_at`);
  return buildPayload(user, showcaseTz(), rows.map((r) => ({ ts: Number(r.ts), artist: r.a })), ranking.map((r) => r.a));
}

export async function loadListenAt(ts: number): Promise<ListenAt | null> {
  const user = showcaseUser();
  const rows = await withRetry(() => sqlClient<{ track_name: string; artist_name: string | null; recording_mbid: string | null; listened_at: Date }[]>`
    SELECT track_name, artist_name, recording_mbid, listened_at FROM listens
    WHERE user_name = ${user} AND listened_at = to_timestamp(${ts}) ORDER BY track_name LIMIT 1`);
  const r = rows[0];
  return r ? { track: r.track_name, artist: r.artist_name ?? "", recordingMbid: r.recording_mbid, listenedAt: r.listened_at.toISOString() } : null;
}
```

Check `withRetry`'s signature in `lib/db/retry.ts` before using it (it is used as `withRetry(() => execute(...))` in `lib/db/queries/stats.ts`). If it is typed for `execute` results only, call `sqlClient` directly without it.

```ts
// app/api/landing/points/route.ts
import { connection } from "next/server";
import { encodePayload } from "@/lib/landing/payload";
import { loadShowcasePayload } from "@/lib/landing/query";

// The CDN holds this for an hour, so Neon sees at most ~1 request/hour from the landing page.
export async function GET() {
  await connection();
  const payload = await loadShowcasePayload();
  if (!payload) return new Response(null, { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } });
  return new Response(encodePayload(payload), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
```

```ts
// app/api/landing/listen/route.ts
import { NextRequest } from "next/server";
import { parseTs } from "@/lib/landing/build";
import { loadListenAt } from "@/lib/landing/query";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const ts = parseTs(req.nextUrl.searchParams.get("ts"));
  if (ts === null) return Response.json({ error: "bad_ts" }, { status: 400, headers: NO_STORE });
  const listen = await loadListenAt(ts);
  if (!listen) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  // A past listen never changes.
  return Response.json(listen, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" } });
}
```

- [ ] **Step 6: Verify against the local server**

Run:
```bash
npx tsc --noEmit -p . && npm run build
```
Expected: the build succeeds and lists both `/api/landing/*` routes as dynamic (ƒ), not static.

Then start the server with `npx next start -p 3457` in the background and run:
```bash
curl -s -o /tmp/points.bin -D - http://localhost:3457/api/landing/points | grep -i -E "^(HTTP|cache-control|content-type)"
ls -l /tmp/points.bin
curl -s "http://localhost:3457/api/landing/listen?ts=abc" -w " %{http_code}\n"
curl -s "http://localhost:3457/api/landing/listen?ts=$(node -e 'const b=require("fs").readFileSync("/tmp/points.bin");const h=b.readUInt32LE(0);console.log(JSON.parse(b.subarray(4,4+h)).lastTs)')" -w " %{http_code}\n"
```
Expected:
- 200 with `cache-control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`
- the file is about 1.2 MB
- `{"error":"bad_ts"} 400`
- the last call returns your latest listen's JSON with a 200

Memory `pulse-lb-dev-server-rebuilds-prod-aggregates` applies: use `next start`, not `next dev`, against prod data.

---

### Task 4: three.js scene module

**Files:**
- Modify: `package.json` (via npm install)
- Create: `app/_landing/scene/positions.ts`
- Create: `app/_landing/scene/createScene.ts`

**Interfaces:**
- Consumes: `Prepared`, `Heightfield`, `heightAt`, `filterUniforms` (Task 2).
- Produces:
  - `const W = 4`
  - `buildPositions(p: Prepared): Float32Array`
  - `topOf(p: Prepared, day: number): [number, number, number]`
  - `createScene(canvas: HTMLCanvasElement, p: Prepared, opts: { reducedMotion: boolean }): Promise<SceneHandle>`
  - `type SceneHandle`:
    - `setFilter(u: { uF: number; uA: number; uB: number }): void`
    - `rotate(dx: number, dy: number): void`
    - `setScroll(fraction: number): void`
    - `project(x: number, y: number, z: number): [number, number] | null`, returning CSS px or null if behind the camera
    - `pick(sx: number, sy: number, radius: number, accept?: (i: number) => boolean): number`, returning -1 when nothing is in range
    - `pointAt(i: number): [number, number, number]`
    - `onFrame(cb: () => void): () => void`
    - `destroy(): void`
  - `createScene` rejects if WebGL is unavailable.

- [ ] **Step 1: Install three**

Run: `npm install three@0.169.0 && npm install -D @types/three@0.169.0`
Expected: `package.json` gains `"three": "^0.169.0"` (dependencies) and `"@types/three": "^0.169.0"` (devDependencies). Pin both to exactly `0.169.0` by removing the caret.

- [ ] **Step 2: Write positions.ts**

```ts
// app/_landing/scene/positions.ts
import { heightAt, type Prepared } from "@/lib/landing/derive";

/** World length of the date axis. Hour axis spans 2, height up to 1.25. */
export const W = 4;
const HEIGHT = 1.25;

// Deterministic per-point jitter in [-0.5, 0.5) so points don't sit on grid lines.
const jit = (i: number, k: number) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; };

export function buildPositions(p: Prepared): Float32Array {
  const n = p.day.length, out = new Float32Array(n * 3), span = p.maxDay + 1;
  for (let i = 0; i < n; i++) {
    const u = (p.day[i] + 0.5 + jit(i, 6) * 3) / span, v = (p.minute[i] + jit(i, 7) * 20) / 1440;
    out[i * 3] = (u - 0.5) * W;
    out[i * 3 + 1] = heightAt(p.hf, u, v) * HEIGHT + jit(i, 8) * 0.012;
    out[i * 3 + 2] = (v - 0.5) * 2;
  }
  return out;
}

/** Highest point of the surface along the hour axis at a given day. */
export function topOf(p: Prepared, day: number): [number, number, number] {
  const u = (day + 0.5) / (p.maxDay + 1);
  let bv = 0, bh = -1;
  for (let k = 0; k < 48; k++) { const v = (k + 0.5) / 48, h = heightAt(p.hf, u, v); if (h > bh) { bh = h; bv = v; } }
  return [(u - 0.5) * W, bh * HEIGHT, (bv - 0.5) * 2];
}
```

- [ ] **Step 3: Write createScene.ts**

```ts
// app/_landing/scene/createScene.ts
import type { Prepared } from "@/lib/landing/derive";
import { buildPositions, W } from "./positions";

export type SceneHandle = {
  setFilter(u: { uF: number; uA: number; uB: number }): void;
  rotate(dx: number, dy: number): void;
  setScroll(fraction: number): void;
  project(x: number, y: number, z: number): [number, number] | null;
  pick(sx: number, sy: number, radius: number, accept?: (i: number) => boolean): number;
  pointAt(i: number): [number, number, number];
  onFrame(cb: () => void): () => void;
  destroy(): void;
};

const VERT = /* glsl */ `
  attribute float aDay, aMin, aArt, aRnd;
  uniform float uTime, uMotion, uF, uA, uB, uBaseWd, uSize, uDpr, uDim;
  uniform vec3 uAccent;
  varying vec3 vCol; varying float vA;
  void main() {
    vec3 p = position;
    float hl = 1.0;
    if (uF > 0.5 && uF < 1.5) hl = step(abs(mod(aDay + uBaseWd, 7.0) - uA), 0.1) * step(abs(floor(aMin / 60.0) - uB), 0.1);
    else if (uF > 1.5 && uF < 2.5) hl = step(uA, aDay) * step(aDay, uB - 0.5);
    else if (uF > 2.5) hl = step(abs(aArt - uA), 0.1);
    bool filtered = uF > 0.5;
    vCol = mix(vec3(0.92), uAccent, filtered ? hl : 0.0);
    vA = (filtered ? (hl > 0.5 ? 0.9 : 0.035) : 0.30) * uDim;
    // Wind: every point sways around its true spot; waves travel along the time axis.
    float t = uTime;
    float ph = p.x * 1.4 - t * 0.32;
    float sway = sin(ph + aRnd * 0.9) * 0.5 + sin(p.x * 3.1 + p.z * 2.3 - t * 0.51 + aRnd * 2.0) * 0.35 + sin(p.z * 5.0 + t * 0.23) * 0.15;
    float lift = 0.25 + clamp(p.y, 0.0, 1.5);
    p.x += uMotion * (sway * 0.025 + sin(t * 0.6 + aRnd * 6.283) * 0.006);
    p.y += uMotion * sin(ph * 0.8 + p.z * 1.7 + aRnd * 0.5) * 0.028 * lift;
    p.z += uMotion * cos(ph * 0.6 + aRnd * 1.3) * 0.03;
    float crest = smoothstep(0.55, 1.0, sin(p.x * 0.9 - t * 0.42)) * 0.9 + smoothstep(0.8, 1.0, sin(p.x * 2.3 + p.z * 1.1 - t * 0.7)) * 0.5;
    vA *= 1.0 + crest * uMotion;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uDpr * (filtered && hl > 0.5 ? 1.6 : 1.0) * clamp(4.0 / -mv.z, 0.6, 2.2);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  varying vec3 vCol; varying float vA;
  void main() { vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = vec4(vCol * vA, 1.0); }`;

export async function createScene(canvas: HTMLCanvasElement, p: Prepared, opts: { reducedMotion: boolean }): Promise<SceneHandle> {
  const THREE = await import("three");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" }); // throws without WebGL
  renderer.setClearColor(0x050505);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

  const n = p.day.length, pos = buildPositions(p), rnd = new Float32Array(n);
  for (let i = 0, s = 1; i < n; i++) { s = (s * 16807) % 2147483647; rnd[i] = s / 2147483647; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aDay", new THREE.BufferAttribute(Float32Array.from(p.day), 1));
  geo.setAttribute("aMin", new THREE.BufferAttribute(Float32Array.from(p.minute), 1));
  geo.setAttribute("aArt", new THREE.BufferAttribute(Float32Array.from(p.payload.artist), 1));
  geo.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 1));
  const U = {
    uTime: { value: 0 }, uMotion: { value: opts.reducedMotion ? 0 : 1 },
    uF: { value: 0 }, uA: { value: 0 }, uB: { value: 0 }, uBaseWd: { value: p.baseWeekday },
    uSize: { value: 1.6 }, uDpr: { value: 1 }, uDim: { value: 1 }, uAccent: { value: new THREE.Color(0xff4a2e) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  const floor = new THREE.GridHelper(W * 1.1, 32, 0x2a2a2a, 0x1a1a1a);
  floor.scale.z = 0.5;
  (floor.material as THREE.Material).transparent = true;
  (floor.material as THREE.Material).opacity = 0.12;
  floor.renderOrder = -1;
  scene.add(floor);

  let userYaw = 0, userPitch = 0, scroll = 0, raf = 0, last = performance.now(), first = true;
  const cam = { yaw: 0, pitch: 0, dist: 8, ty: 0 };
  const frameCbs = new Set<() => void>();

  const portrait = () => canvas.clientHeight > canvas.clientWidth;
  function target() {
    const t = Math.tan((camera.fov / 2) * Math.PI / 180), a = camera.aspect;
    const fit = (bw: number, bh: number) => Math.max(bh / 2 / t, bw / 2 / (t * a));
    const clampP = (x: number) => Math.max(-0.2, Math.min(1.2, x));
    return portrait()
      ? { yaw: 1.0 + userYaw, pitch: clampP(0.62 + userPitch), dist: fit(2.8, 2.8) * 0.72, ty: 0.42 }
      : { yaw: -0.25 + userYaw, pitch: clampP(0.5 + userPitch), dist: fit(W + 0.3, 2.4), ty: 0.3 };
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, w < 720 ? 1.5 : 2);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); U.uDpr.value = dpr;
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(50, now - last); last = now;
    if (document.hidden) return;
    U.uTime.value += (dt / 1000) * U.uMotion.value;
    const t = target(), k = first || opts.reducedMotion ? 1 : 0.08; first = false;
    cam.yaw += (t.yaw - cam.yaw) * k; cam.pitch += (t.pitch - cam.pitch) * k; cam.dist += (t.dist - cam.dist) * k; cam.ty += (t.ty - cam.ty) * k;
    U.uDim.value = 1 - scroll * 0.45;
    camera.position.set(Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist, cam.ty + Math.sin(cam.pitch) * cam.dist, Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
    camera.lookAt(0, cam.ty - scroll * 0.3, 0);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    frameCbs.forEach((cb) => cb());
  }
  raf = requestAnimationFrame(frame);

  const m = new THREE.Matrix4(), v = new THREE.Vector4();
  return {
    setFilter(u) { U.uF.value = u.uF; U.uA.value = u.uA; U.uB.value = u.uB; },
    rotate(dx, dy) { userYaw -= dx * 0.005; userPitch += dy * 0.003; },
    setScroll(f) { scroll = Math.max(0, Math.min(1, f)); },
    project(x, y, z) {
      v.set(x, y, z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (v.w <= 0) return null;
      return [(v.x / v.w + 1) * canvas.clientWidth / 2, (1 - v.y / v.w) * canvas.clientHeight / 2];
    },
    pick(sx, sy, radius, accept) {
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const e = m.elements, hw = canvas.clientWidth / 2, hh = canvas.clientHeight / 2;
      let best = -1, bd = radius * radius, bz = Infinity;
      for (let i = 0; i < n; i++) {
        if (accept && !accept(i)) continue;
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const cw = e[3] * x + e[7] * y + e[11] * z + e[15]; if (cw <= 0) continue;
        const px = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw + 1) * hw;
        const py = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw) * hh;
        const d = (px - sx) ** 2 + (py - sy) ** 2;
        if (d < bd || (d === bd && cw < bz)) { bd = d; best = i; bz = cw; }
      }
      return best;
    },
    pointAt(i) { return [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; },
    onFrame(cb) { frameCbs.add(cb); return () => frameCbs.delete(cb); },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      geo.dispose(); mat.dispose(); floor.geometry.dispose(); (floor.material as THREE.Material).dispose();
      renderer.dispose();
    },
  };
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p .`
Expected: no errors. The visual check happens in Task 5, once something mounts the scene.

---

### Task 5: Page shell: data hook, server Landing, client layout, HUD, Scene, readout, callouts

**Files:**
- Create: `app/_landing/landing.module.css`
- Create: `app/_landing/listen.ts`
- Create: `app/_landing/useLandingData.ts`
- Create: `app/_landing/SignInOnly.tsx`
- Create: `app/_landing/Landing.tsx`
- Create: `app/_landing/LandingClient.tsx`
- Create: `app/_landing/Hud.tsx`
- Create: `app/_landing/Scene.tsx`
- Create: `app/_landing/Instruments.tsx` (stub; Task 6 replaces it)
- Create: `app/_landing/Pipeline.tsx` (stub; Task 7 replaces it)
- Modify: `app/page.tsx` (whole file)

**Interfaces:**
- Consumes: `decodePayload` (Task 1); `prepare`, `callouts`, `countMatches`, `filterLabel`, `filterUniforms`, `matches`, `dayStr`, `minStr`, `Filter`, `Prepared` (Task 2); `ListenAt` type (Task 3); `createScene`, `SceneHandle`, `topOf` (Task 4); `allTimeStats` from `lib/db/queries/stats.ts`; `showcaseUser` (Task 3).
- Produces:
  - `type Totals = { listens: number; artists: number; albums: number; songs: number }` (exported from `LandingClient.tsx`)
  - `<Instruments data: Prepared; totals: Totals; filter: Filter | null; onFilter(f: Filter | null): void />`
  - `<Pipeline totals: Totals; latest: ListenAt | null />`
  - `fetchListen(ts: number): Promise<ListenAt | null>`

- [ ] **Step 1: Styles**

```css
/* app/_landing/landing.module.css */
.root {
  --bg: #050505; --fg: #8d8d8d; --hi: #ececec; --dim: #4a4a4a; --line: #262626; --accent: #ff4a2e;
  background: var(--bg); color: var(--fg); font-family: var(--font-jetbrains-mono), ui-monospace, Menlo, monospace;
  font-size: 11px; letter-spacing: .04em; min-height: 100svh;
}
.root b { color: var(--hi); font-weight: 500; }
.canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; display: block; z-index: 0; }
.hero { position: relative; height: 100svh; z-index: 1; touch-action: pan-y; cursor: crosshair; user-select: none; -webkit-user-select: none; }
.hud { position: absolute; padding: 16px; text-transform: uppercase; line-height: 1.7; pointer-events: none; z-index: 2; }
.hud > * { pointer-events: auto; }
.tl { top: 0; left: 0; padding-top: calc(16px + env(safe-area-inset-top)); }
.bl { bottom: 0; left: 0; }
.br { bottom: 0; right: 0; text-align: right; }
.bc { bottom: 0; left: 50%; transform: translateX(-50%); color: var(--dim); }
.brand { color: var(--hi); letter-spacing: .12em; }
.dim { color: var(--dim); }
.btn { display: inline-block; margin-top: 6px; color: var(--hi); background: rgba(5,5,5,.6); border: 1px solid #333;
  padding: 6px 9px; text-transform: uppercase; letter-spacing: inherit; font: inherit; text-decoration: none; }
.btn:hover { border-color: #777; }
.solid { background: var(--hi); color: #000; border-color: var(--hi); }
.solid:hover { background: #fff; }
.chip { margin-top: 6px; color: var(--accent); }
.chip button { font: inherit; color: var(--accent); background: none; border: 1px solid var(--accent); padding: 2px 6px; margin-left: 6px; cursor: pointer; }
.msg { position: absolute; top: 50%; width: 100%; text-align: center; color: var(--dim); text-transform: uppercase; }

.cross { position: absolute; pointer-events: none; z-index: 2; }
.cross::before, .cross::after { content: ""; position: absolute; background: rgba(236,236,236,.35); }
.cross::before { left: -18px; width: 36px; top: 0; height: 1px; }
.cross::after { top: -18px; height: 36px; left: 0; width: 1px; }
.readout { position: absolute; z-index: 3; background: rgba(5,5,5,.88); border: 1px solid #333; padding: 6px 8px;
  text-transform: uppercase; line-height: 1.6; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
.readout.pinned { pointer-events: auto; border-color: var(--hi); }
.readout a { color: var(--hi); }

.callouts { position: fixed; inset: 0; z-index: 1; pointer-events: none; transition: opacity .2s; }
.callouts svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.callouts line { stroke: rgba(236,236,236,.45); stroke-width: 1; }
.callouts circle { fill: none; stroke: var(--hi); stroke-width: 1; }
.callout { position: absolute; left: 0; top: 0; text-transform: uppercase; line-height: 1.5; font-size: 10px; white-space: nowrap; }
.callout b { display: block; }

.main { position: relative; z-index: 1; padding: 0 16px 80px; }
.section { max-width: 1080px; margin: 0 auto 28px; background: rgba(5,5,5,.72); border: 1px solid var(--line); }
.sectionHead { display: flex; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--line); text-transform: uppercase; color: var(--dim); }
.footer { max-width: 1080px; margin: 0 auto; color: var(--dim); text-transform: uppercase; display: flex; justify-content: space-between; }

.grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 1px; background: var(--line); }
.gauge { background: rgba(5,5,5,.9); padding: 10px 12px; }
.gauge h4 { margin: 0 0 10px; font-weight: 400; color: var(--dim); text-transform: uppercase; font-size: inherit; }
.punch { display: grid; grid-template-columns: 26px repeat(24, 1fr); gap: 2px; align-items: center; }
.lab { color: var(--dim); font-size: 9px; text-transform: uppercase; }
.cell { aspect-ratio: 1; display: grid; place-items: center; cursor: pointer; background: none; border: 0; padding: 0; }
.cell i { display: block; border-radius: 50%; background: var(--fg); }
.cell:hover i, .cell.sel i { background: var(--accent); }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 110px; }
.bar { flex: 1; background: #444; cursor: pointer; min-height: 1px; border: 0; padding: 0; }
.bar:hover, .bar.sel { background: var(--accent); }
.barlabs { display: flex; justify-content: space-between; color: var(--dim); font-size: 9px; margin-top: 4px; }
.row { display: grid; grid-template-columns: 18px 1fr 70px; gap: 8px; padding: 3px 0; cursor: pointer; text-transform: uppercase; align-items: center;
  width: 100%; background: none; border: 0; color: inherit; font: inherit; letter-spacing: inherit; text-align: left; }
.row .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative; }
.row .name s { position: absolute; left: 0; bottom: 0; height: 1px; background: #444; text-decoration: none; }
.row .ct { text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; }
.row:hover, .row.sel { color: var(--accent); }
.totals { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 16px; text-transform: uppercase; }
.totals .v { color: var(--hi); font-size: 18px; letter-spacing: 0; }

.pipe { padding: 14px 12px; }
.stage { display: grid; grid-template-columns: 220px 1fr; gap: 16px; align-items: start; }
.node { border: 1px solid #333; padding: 8px 10px; text-transform: uppercase; line-height: 1.6; transition: border-color .2s; }
.node .v { color: var(--hi); font-size: 14px; }
.node .pkt { color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; height: 0; transition: height .2s; }
.node.active { border-color: var(--hi); }
.node.active .pkt { height: 1.6em; }
.spec { line-height: 1.7; padding-top: 8px; max-width: 56ch; }
.spec code { color: var(--hi); }
.wire { width: 1px; height: 22px; margin-left: 20px; background: repeating-linear-gradient(to bottom, #555 0 3px, transparent 3px 6px); }

@media (max-width: 720px) {
  .hud { padding: 12px; }
  .tl { padding-top: calc(12px + env(safe-area-inset-top)); }
  .br { left: 0; right: 0; padding: 12px 12px calc(14px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; text-align: center; }
  .br .btn { display: block; margin: 0; padding: 15px 12px; }
  .bl { right: 0; bottom: calc(128px + env(safe-area-inset-bottom)); }
  .bc { display: none; }
  .callout { font-size: 9px; }
  .main { padding: 0 12px 60px; }
  .grid { grid-template-columns: 1fr; }
  .punch { grid-template-columns: 18px repeat(24, 1fr); gap: 1px; }
  .stage { grid-template-columns: 1fr; gap: 0; }
  .spec { padding: 6px 0 0; font-size: 10px; }
}
```

- [ ] **Step 2: Client data helpers**

```ts
// app/_landing/listen.ts
import type { ListenAt } from "@/lib/landing/query";

const cache = new Map<number, Promise<ListenAt | null>>();

export function fetchListen(ts: number): Promise<ListenAt | null> {
  let p = cache.get(ts);
  if (!p) {
    p = fetch(`/api/landing/listen?ts=${ts}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    cache.set(ts, p);
  }
  return p;
}
```

`lib/landing/query.ts` imports the DB client. Importing only a **type** from it is erased at compile time, so it is safe in a client file. Keep it `import type`.

```ts
// app/_landing/useLandingData.ts
"use client";
import { useEffect, useState } from "react";
import { decodePayload } from "@/lib/landing/payload";
import { prepare, type Prepared } from "@/lib/landing/derive";

export function useLandingData(): { data: Prepared | null; error: boolean } {
  const [state, setState] = useState<{ data: Prepared | null; error: boolean }>({ data: null, error: false });
  useEffect(() => {
    let live = true;
    fetch("/api/landing/points")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((buf) => { if (live) setState({ data: prepare(decodePayload(buf)), error: false }); })
      .catch(() => { if (live) setState({ data: null, error: true }); });
    return () => { live = false; };
  }, []);
  return state;
}
```

- [ ] **Step 3: Server components and the page**

```tsx
// app/_landing/SignInOnly.tsx
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/** Today's landing: used while loading the shell fails or there is no showcase data. */
export function SignInOnly() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <Link href="/auth/login"><Button size="lg">Sign in with ListenBrainz</Button></Link>
    </main>
  );
}
```

```tsx
// app/_landing/Landing.tsx
import { allTimeStats } from "@/lib/db/queries/stats";
import { showcaseUser } from "@/lib/landing/showcase";
import { LandingClient } from "./LandingClient";
import { SignInOnly } from "./SignInOnly";

export async function Landing() {
  const user = showcaseUser();
  let t;
  try { t = await allTimeStats(user); } catch { return <SignInOnly />; }
  if (!t.total_plays) return <SignInOnly />;
  return (
    <LandingClient
      user={user}
      totals={{ listens: t.total_plays, artists: t.distinct_artists, albums: t.distinct_albums, songs: t.distinct_songs }}
    />
  );
}
```

```tsx
// app/page.tsx
import { Suspense } from "react";
import { AlertTriangle } from "lucide-react";
import { Landing } from "./_landing/Landing";
import { SignInOnly } from "./_landing/SignInOnly";

type SP = Promise<{ error?: string; reason?: string }>;

// Signed-in visitors never see this page: proxy.ts sends them to their own
// dashboard. Everyone else gets the showcase landscape and a way to sign in.
export default function Home({ searchParams }: { searchParams: SP }) {
  return (
    <>
      <Suspense fallback={null}>
        <ErrorBanners searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<SignInOnly />}>
        <Landing />
      </Suspense>
    </>
  );
}
```

Keep the existing `ErrorBanners` function below it unchanged, except that its outer `<div className="max-w-md w-full">` becomes `<div className="fixed top-4 inset-x-4 z-20 mx-auto max-w-md">`, so it floats above the HUD.

- [ ] **Step 4: Client layout, HUD and stubs**

```tsx
// app/_landing/LandingClient.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { countMatches, filterLabel, type Filter } from "@/lib/landing/derive";
import type { ListenAt } from "@/lib/landing/query";
import s from "./landing.module.css";
import { Hud } from "./Hud";
import { Instruments } from "./Instruments";
import { fetchListen } from "./listen";
import { Pipeline } from "./Pipeline";
import { Scene } from "./Scene";
import { useLandingData } from "./useLandingData";

export type Totals = { listens: number; artists: number; albums: number; songs: number };

export function LandingClient({ user, totals }: { user: string; totals: Totals }) {
  const { data, error } = useLandingData();
  const [filter, setFilter] = useState<Filter | null>(null);
  const [latest, setLatest] = useState<ListenAt | null>(null);

  useEffect(() => {
    if (data) fetchListen(data.payload.header.lastTs).then(setLatest);
  }, [data]);

  const chip = useMemo(
    () => (filter && data ? `${filterLabel(filter, data)} · ${countMatches(filter, data).toLocaleString("en-US")}` : null),
    [filter, data],
  );

  return (
    <div className={s.root}>
      <Scene data={data} error={error} user={user} filter={filter}>
        <Hud user={user} totals={totals} latest={latest} chip={chip} onClear={() => setFilter(null)} />
      </Scene>
      <main className={s.main}>
        {data && <Instruments data={data} totals={totals} filter={filter} onFilter={setFilter} />}
        <Pipeline totals={totals} latest={latest} />
        <footer className={s.footer}><span>{user}</span><span>pulse</span></footer>
      </main>
    </div>
  );
}
```

```tsx
// app/_landing/Hud.tsx
import Link from "next/link";
import type { ListenAt } from "@/lib/landing/query";
import type { Totals } from "./LandingClient";
import s from "./landing.module.css";

export function Hud({ user, totals, latest, chip, onClear }: {
  user: string; totals: Totals; latest: ListenAt | null; chip: string | null; onClear: () => void;
}) {
  const n = (x: number) => x.toLocaleString("en-US");
  return (
    <>
      <div className={`${s.hud} ${s.tl}`}>
        <div className={s.brand}>PULSE // {user.toUpperCase()}</div>
        <div><b>{n(totals.listens)}</b> LISTENS · <b>{n(totals.artists)}</b> ARTISTS</div>
        {chip && <div className={s.chip}>FILTER ▸ {chip.toUpperCase()}<button type="button" onClick={onClear} aria-label="Clear filter">×</button></div>}
      </div>
      {latest && (
        <div className={`${s.hud} ${s.bl}`}>
          <div className={s.dim}>LATEST ▸</div>
          <div><b>{latest.artist} — {latest.track}</b></div>
        </div>
      )}
      <div className={`${s.hud} ${s.br}`}>
        <Link className={s.btn} href={`/u/${encodeURIComponent(user)}/stats`}>View {user}&apos;s profile →</Link>
        <br />
        <Link className={`${s.btn} ${s.solid}`} href="/auth/login">Sign in with ListenBrainz</Link>
      </div>
      <div className={`${s.hud} ${s.bc}`}>SCROLL ↓</div>
    </>
  );
}
```

On phones the `<br />` sits inside a flex column, so it has no effect. Don't remove it; desktop needs it.

```tsx
// app/_landing/Instruments.tsx — stub, replaced in Task 6
import type { Filter, Prepared } from "@/lib/landing/derive";
import type { Totals } from "./LandingClient";
export function Instruments(_: { data: Prepared; totals: Totals; filter: Filter | null; onFilter: (f: Filter | null) => void }) { return null; }
```

```tsx
// app/_landing/Pipeline.tsx — stub, replaced in Task 7
import type { ListenAt } from "@/lib/landing/query";
import type { Totals } from "./LandingClient";
export function Pipeline(_: { totals: Totals; latest: ListenAt | null }) { return null; }
```

- [ ] **Step 5: Scene component (canvas, pointer, readout, callouts)**

```tsx
// app/_landing/Scene.tsx
"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { callouts, dayStr, filterUniforms, matches, minStr, type Filter, type Prepared } from "@/lib/landing/derive";
import type { ListenAt } from "@/lib/landing/query";
import type { SceneHandle } from "./scene/createScene";
import { topOf } from "./scene/positions";
import { fetchListen } from "./listen";
import s from "./landing.module.css";

type Readout = { i: number; x: number; y: number; pinned: boolean; listen: ListenAt | null };

export function Scene({ data, error, user, filter, children }: {
  data: Prepared | null; error: boolean; user: string; filter: Filter | null; children: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const filterRef = useRef<Filter | null>(filter);
  const [status, setStatus] = useState<"idle" | "ready" | "nogl">("idle");
  const [readout, setReadout] = useState<Readout | null>(null);
  const readoutRef = useRef<Readout | null>(null);
  readoutRef.current = readout;
  const facts = useMemo(() => (data ? callouts(data) : []), [data]);

  // Mount the scene once data is in.
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    let handle: SceneHandle | null = null, dead = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("./scene/createScene")
      .then(({ createScene }) => createScene(canvasRef.current!, data, { reducedMotion: reduced }))
      .then((h) => { if (dead) { h.destroy(); return; } handle = handleRef.current = h; h.setFilter(filterUniforms(filterRef.current)); setStatus("ready"); })
      .catch(() => { if (!dead) setStatus("nogl"); });
    return () => { dead = true; handle?.destroy(); handleRef.current = null; };
  }, [data]);

  // Instruments → shader.
  useEffect(() => {
    filterRef.current = filter;
    handleRef.current?.setFilter(filterUniforms(filter));
    setReadout(null);
  }, [filter]);

  // Scroll dims the scene and fades callouts.
  useEffect(() => {
    const onScroll = () => handleRef.current?.setScroll(window.scrollY / window.innerHeight);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Callouts + readout follow the camera every frame.
  useEffect(() => {
    const h = handleRef.current, wrap = calloutRef.current;
    if (status !== "ready" || !h || !wrap || !data) return;
    const anchors = facts.map((f) => (f.index !== undefined ? h.pointAt(f.index) : topOf(data, f.day)));
    const labels = [...wrap.querySelectorAll<HTMLElement>("[data-callout]")];
    const lines = [...wrap.querySelectorAll<SVGLineElement>("line")];
    const dots = [...wrap.querySelectorAll<SVGCircleElement>("circle")];
    const OFF = [70, 110, 50];
    return h.onFrame(() => {
      const sc = window.scrollY / window.innerHeight;
      wrap.style.opacity = String(Math.max(0, 1 - sc * 3) * (filterRef.current ? 0 : 1));
      const portrait = window.innerHeight > window.innerWidth, topMin = portrait ? 96 : 110;
      anchors.forEach((a, k) => {
        const p = h.project(a[0], a[1], a[2]), el = labels[k];
        if (!p || !el) return;
        const [ax, ay] = p, w = el.offsetWidth, ht = el.offsetHeight;
        const lx = Math.min(window.innerWidth - w - 12, Math.max(12, ax - 6)), ly = Math.max(topMin, ay - (OFF[k] ?? 60) - ht);
        el.style.transform = `translate(${lx}px, ${ly}px)`;
        const bx = Math.min(Math.max(ax, lx), lx + w);
        lines[k].setAttribute("x1", String(bx)); lines[k].setAttribute("y1", String(ly + ht + 3));
        lines[k].setAttribute("x2", String(ax)); lines[k].setAttribute("y2", String(ay - 3));
        dots[k].setAttribute("cx", String(ax)); dots[k].setAttribute("cy", String(ay));
      });
      const r = readoutRef.current;
      if (r) {
        const q = h.project(...h.pointAt(r.i));
        if (q && (Math.abs(q[0] - r.x) > 0.5 || Math.abs(q[1] - r.y) > 0.5)) setReadout({ ...r, x: q[0], y: q[1] });
      }
    });
  }, [status, facts, data]);

  // Pointer: hover (mouse) after 150ms rest, tap pins, desktop drag rotates, touch drags scroll.
  useEffect(() => {
    const hero = heroRef.current;
    if (status !== "ready" || !hero || !data) return;
    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
    let hoverTimer = 0;
    const accept = (i: number) => !filterRef.current || matches(filterRef.current, data, i);
    const show = (i: number, x: number, y: number, pinned: boolean) => {
      setReadout({ i, x, y, pinned, listen: null });
      fetchListen(data.payload.ts[i]).then((listen) =>
        setReadout((cur) => (cur && cur.i === i ? { ...cur, listen } : cur)));
    };
    const isUi = (t: EventTarget | null) => t instanceof Element && !!t.closest("a,button");
    const down = (e: PointerEvent) => { if (!isUi(e.target)) drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; };
    const move = (e: PointerEvent) => {
      const h = handleRef.current; if (!h) return;
      if (drag && e.pointerId === drag.id) {
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
          if (e.pointerType === "touch") { drag = null; return; } // phones: drags scroll the page
          drag.moved = true; hero.setPointerCapture(e.pointerId); setReadout(null);
        }
        if (drag?.moved) { h.rotate(e.movementX, e.movementY); return; }
      }
      if (e.pointerType !== "mouse" || readoutRef.current?.pinned) return;
      window.clearTimeout(hoverTimer);
      hoverTimer = window.setTimeout(() => {
        const i = h.pick(e.clientX, e.clientY, 12, accept);
        if (i < 0) { setReadout(null); return; }
        const q = h.project(...h.pointAt(i)); if (q) show(i, q[0], q[1], false);
      }, 150);
    };
    const up = (e: PointerEvent) => {
      const h = handleRef.current;
      if (!drag || e.pointerId !== drag.id || !h) return;
      const click = !drag.moved; drag = null;
      if (!click) return;
      const i = h.pick(e.clientX, e.clientY, e.pointerType === "touch" ? 28 : 14, accept);
      const q = i >= 0 ? h.project(...h.pointAt(i)) : null;
      if (q && i !== readoutRef.current?.i) show(i, q[0], q[1], true); else setReadout(null);
    };
    const leave = () => { window.clearTimeout(hoverTimer); if (!readoutRef.current?.pinned) setReadout(null); };
    hero.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    hero.addEventListener("pointerleave", leave);
    return () => {
      window.clearTimeout(hoverTimer);
      hero.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      hero.removeEventListener("pointerleave", leave);
    };
  }, [status, data]);

  const r = readout;
  return (
    <>
      <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />
      <div ref={calloutRef} className={s.callouts} aria-hidden="true" style={{ opacity: 0 }}>
        <svg>{facts.map((f) => <g key={f.key}><line /><circle r={3} /></g>)}</svg>
        {facts.map((f) => (
          <div key={f.key} data-callout className={s.callout}><span className={s.dim}>{f.label}</span><b>{f.value}</b></div>
        ))}
      </div>
      <div ref={heroRef} className={s.hero}>
        {children}
        {status === "nogl" && <p className={s.msg}>WebGL unavailable</p>}
        {error && <p className={s.msg}>Data unavailable</p>}
        {r && data && (
          <>
            <div className={s.cross} style={{ left: r.x, top: r.y }} />
            <div
              className={`${s.readout} ${r.pinned ? s.pinned : ""}`}
              style={{ left: Math.min(window.innerWidth - 290, Math.max(8, r.x + 14)), top: r.y + 14 + 90 > window.innerHeight ? r.y - 104 : r.y + 14 }}
            >
              <div className={s.dim}>{dayStr(data.baseMs, data.day[r.i])} · {minStr(data.minute[r.i])}</div>
              <div><b>{r.listen?.track ?? "…"}</b></div>
              <div>{r.listen?.artist ?? data.payload.header.artists[data.payload.artist[r.i]] ?? ""}</div>
              {r.pinned && r.listen?.recordingMbid && (
                <a href={`/u/${encodeURIComponent(user)}/songs/${r.listen.recordingMbid}`}>→ song page</a>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
```

The readout's vertical flip uses a fixed 90 px height estimate. That's acceptable. If it clips on short screens, measure it with a ref.

- [ ] **Step 5b: Fix a known prop-type gap before checking**

`h.project(...h.pointAt(i))` needs `pointAt` to return a tuple type. It does (`[number, number, number]`). If TS complains about spreading, write `const [x, y, z] = h.pointAt(i); h.project(x, y, z)`.

- [ ] **Step 6: Verify by rendering (both sizes, real DB)**

Run:
```bash
npx tsc --noEmit -p . && npm test && npm run build
npx next start -p 3457   # background
```
Then take screenshots of `http://localhost:3457/` at 1440×900 and 390×844 (isMobile, hasTouch) with the prototype's capture script. Copy `.superpowers/shot2.mjs` to `.superpowers/shot-app.mjs` and point it at the URL. Expected:
- the mountain fills the hero
- three callouts with hairlines
- top-left HUD totals
- phone: full-width buttons with "LATEST" above them
- no `pageerror` lines in the script output

Hover a point on desktop. The readout should show a date, time, track and artist.

Measure the client cost in a real browser at `localhost:3457`:
- DevTools → Performance → reload
- `prepare()` plus scene build should be under ~1 s on a laptop
- if it's slower, profile `localize` first

Check the bundle split. Run `ls .next/static/chunks | xargs grep -l "WebGLRenderer" | head`. The three.js chunk should exist on its own. Then run `grep -l WebGLRenderer .next/server/app/u -r | wc -l`, which should print `0`.

---

### Task 6: Instruments linked to the hero

**Files:**
- Modify: `app/_landing/Instruments.tsx` (replace the stub)

**Interfaces:**
- Consumes: `punchCard`, `yearCounts`, `yearOf`, `yearStartDay`, `topArtists`, `dayStr`, `WEEKDAYS`, `Filter`, `Prepared` (Task 2); `Totals` (Task 5).
- Produces: `<Instruments data totals filter onFilter />`. Clicking the active item calls `onFilter(null)`.

- [ ] **Step 1: Implement**

```tsx
// app/_landing/Instruments.tsx
"use client";
import { useMemo } from "react";
import { dayStr, punchCard, topArtists, WEEKDAYS, yearCounts, yearOf, yearStartDay, type Filter, type Prepared } from "@/lib/landing/derive";
import type { Totals } from "./LandingClient";
import s from "./landing.module.css";

const n = (x: number) => x.toLocaleString("en-US");
const same = (a: Filter | null, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

export function Instruments({ data, totals, filter, onFilter }: {
  data: Prepared; totals: Totals; filter: Filter | null; onFilter: (f: Filter | null) => void;
}) {
  const pc = useMemo(() => punchCard(data), [data]);
  const pMax = useMemo(() => Math.max(1, ...pc.flat()), [pc]);
  const years = useMemo(() => {
    const c = yearCounts(data), y0 = yearOf(data.baseMs, 0), y1 = yearOf(data.baseMs, data.maxDay);
    return Array.from({ length: y1 - y0 + 1 }, (_, k) => ({ year: y0 + k, count: c.get(y0 + k) ?? 0 }));
  }, [data]);
  const yMax = Math.max(1, ...years.map((y) => y.count));
  const top = useMemo(() => topArtists(data, 10), [data]);
  const toggle = (f: Filter) => onFilter(same(filter, f) ? null : f);
  const yearsSpan = (data.maxDay / 365.25).toFixed(1);

  return (
    <section className={s.section}>
      <header className={s.sectionHead}><span>{"// 01 — INSTRUMENTS"}</span><span>TAP TO LIGHT UP THE FIELD</span></header>
      <div className={s.grid}>
        <div className={s.gauge}>
          <h4>Weekday × hour</h4>
          <div className={s.punch}>
            <span />
            {Array.from({ length: 24 }, (_, h) => <span key={h} className={s.lab} style={{ textAlign: "center" }}>{h % 6 === 0 ? String(h).padStart(2, "0") : ""}</span>)}
            {WEEKDAYS.map((d, wd) => [
              <span key={d} className={s.lab}>{d}</span>,
              ...pc[wd].map((c, h) => {
                const f: Filter = { kind: "slot", weekday: wd, hour: h }, size = Math.max(8, Math.sqrt(c / pMax) * 100);
                return (
                  <button key={`${d}${h}`} type="button" className={`${s.cell} ${same(filter, f) ? s.sel : ""}`}
                    title={`${d} ${String(h).padStart(2, "0")}:00 · ${n(c)}`} onClick={() => toggle(f)}>
                    <i style={{ width: `${size}%`, height: `${size}%` }} />
                  </button>
                );
              }),
            ])}
          </div>
        </div>
        <div className={s.gauge}>
          <h4>Totals</h4>
          <div className={s.totals}>
            {[["Listens", n(totals.listens)], ["Artists", n(totals.artists)], ["Songs", n(totals.songs)], ["Since", dayStr(data.baseMs, 0)],
              ["Years", yearsSpan], ["Per day", (totals.listens / Math.max(1, data.maxDay)).toFixed(1)]].map(([k, v]) => (
              <div key={k}><div className={s.dim}>{k}</div><div className={s.v}>{v}</div></div>
            ))}
          </div>
        </div>
        <div className={s.gauge}>
          <h4>Listens per year</h4>
          <div className={s.bars}>
            {years.map(({ year, count }) => {
              const f: Filter = { kind: "year", year, from: yearStartDay(data.baseMs, year), to: yearStartDay(data.baseMs, year + 1) };
              return <button key={year} type="button" className={`${s.bar} ${same(filter, f) ? s.sel : ""}`}
                style={{ height: `${(count / yMax) * 100}%` }} title={`${year} · ${n(count)}`} onClick={() => toggle(f)} />;
            })}
          </div>
          <div className={s.barlabs}><span>{years[0]?.year}</span><span>{years[years.length - 1]?.year}</span></div>
        </div>
        <div className={s.gauge}>
          <h4>Top artists</h4>
          {top.map((a, k) => {
            const f: Filter = { kind: "artist", rank: a.rank };
            return (
              <button key={a.rank} type="button" className={`${s.row} ${same(filter, f) ? s.sel : ""}`} onClick={() => toggle(f)}>
                <span className={s.dim}>{String(k + 1).padStart(2, "0")}</span>
                <span className={s.name}>{a.name}<s style={{ width: `${(a.count / top[0].count) * 100}%` }} /></span>
                <span className={s.ct}>{n(a.count)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify by rendering**

Rebuild and restart: `npm run build && npx next start -p 3457`. Then, in a browser at desktop and phone sizes:
- clicking the #1 artist row turns matching points accent red and dims the rest
- the HUD chip reads `FILTER ▸ <ARTIST> · <count>`, and × clears it
- clicking the same row again also clears it
- callouts hide while a filter is active
- a year bar and a punch-card cell each filter as well
- on the phone, the punch card fits 390 px with no horizontal scroll

---

### Task 7: Pipeline section with packet ticker

**Files:**
- Modify: `app/_landing/Pipeline.tsx` (replace the stub)

**Interfaces:**
- Consumes: `Totals` (Task 5), `ListenAt` type (Task 3).
- Produces: `<Pipeline totals latest />`.

- [ ] **Step 1: Implement**

```tsx
// app/_landing/Pipeline.tsx
"use client";
import { useEffect, useState } from "react";
import type { ListenAt } from "@/lib/landing/query";
import type { Totals } from "./LandingClient";
import s from "./landing.module.css";

const n = (x: number) => x.toLocaleString("en-US");

export function Pipeline({ totals, latest }: { totals: Totals; latest: ListenAt | null }) {
  const stages: [string, string, string, React.ReactNode][] = [
    ["01 SOURCE", "ListenBrainz", `${n(totals.listens)} listens`, <>Every play from Spotify, Navidrome and friends is scrobbled to <code>ListenBrainz</code>, the open listen archive run by MetaBrainz. pulse never talks to the players directly.</>],
    ["02 AUTH", "LB OAuth → JWT", "Session 30d", <>Sign in with your ListenBrainz account. The callback mints a signed <code>HS256</code> session cookie, and <code>proxy.ts</code> sends you straight to your own stats.</>],
    ["03 INGEST", "Poll + delta", "Live", <>An open tab polls LB for new listens and asks the server to fetch only the delta. History is backfilled once; duplicates are dropped on <code>(user, listened_at, track)</code>.</>],
    ["04 ENRICH", "MusicBrainz", `${n(totals.songs)} songs`, <>Recording, release and release-group MBIDs are resolved against <code>MusicBrainz</code> for real titles and years, with covers from the Cover Art Archive.</>],
    ["05 STORE", "Postgres", `${n(totals.albums)} albums`, <>Everything lands in Postgres through <code>postgres-js</code>: one row per listen, plus the MusicBrainz catalog it points to.</>],
    ["06 AGGREGATE", "agg_* tables", "Incremental", <>Totals, years and top lists live in <code>agg_*</code> tables, updated by each ingest instead of scanning every listen on each page view.</>],
    ["07 SERVE", "Next.js → you", "Cache Components", <><code>Next.js 16</code> on Vercel serves cached shells instantly and streams the rest in. You are here.</>],
  ];
  const [active, setActive] = useState(0);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setInterval(() => setActive((a) => (a + 1) % 7), reduced ? 2500 : 700);
    return () => window.clearInterval(id);
  }, []);
  const packet = latest ? `▸ ${latest.artist} — ${latest.track}` : "";

  return (
    <section className={s.section}>
      <header className={s.sectionHead}><span>{"// 02 — PIPELINE"}</span><span>HOW A LISTEN GETS HERE</span></header>
      <div className={s.pipe}>
        {stages.map(([num, title, value, spec], k) => (
          <div key={num}>
            {k > 0 && <div className={s.wire} />}
            <div className={s.stage}>
              <div className={`${s.node} ${k === active && packet ? s.active : ""}`}>
                <div className={s.dim}>{num}</div>
                {title.toUpperCase()}
                <div className={s.v}>{value.toUpperCase()}</div>
                <div className={s.pkt}>{k === active ? packet : ""}</div>
              </div>
              <div className={s.spec}>{spec}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

Before shipping, double-check the stage copy against the code: OAuth in `app/auth/`, session TTL in `lib/auth/session.ts` (30 days), the ingest dedupe key in the `listens` primary key, and `agg_*` in `lib/db/aggregates/`. Fix any sentence that is wrong.

- [ ] **Step 2: Verify by rendering**

Rebuild and restart. The section order should be Instruments, then Pipeline. The red packet line should step down the stages about every 0.7 s, showing the latest listen. On the phone the stages stack in one column.

---

### Task 8: e2e coverage and the final check

**Files:**
- Modify: `e2e/render.spec.ts` (append one test)

**Interfaces:**
- Consumes: the live server from the previous tasks.

- [ ] **Step 1: Add the test**

Append to `e2e/render.spec.ts`:

```ts
test("landing shows the scene, both ways in, and a cached points payload", async ({ page }) => {
  await check(page, "/");
  await expect(page.getByRole("link", { name: /sign in with listenbrainz/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /profile/i })).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  const res = await page.request.get("/api/landing/points");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("s-maxage=3600");
  const body = await res.body();
  const headLen = body.readUInt32LE(0);
  const header = JSON.parse(body.subarray(4, 4 + headLen).toString("utf8"));
  expect(header.n).toBeGreaterThan(1000);
  const bad = await page.request.get("/api/landing/listen?ts=abc");
  expect(bad.status()).toBe(400);
});
```

- [ ] **Step 2: Run the suites**

Run (server on :3457 from `next start`, fixtures as in memory `pulse-lb-cache-components`):
```bash
npx tsx e2e/mint-token.mts > /tmp/fx.json
E2E_FIXTURES=/tmp/fx.json npm run e2e -- render.spec.ts instant.spec.ts
npm test
```
Expected:
- everything passes for both the `desktop` and `phone` projects
- the existing visitor test `renders /` still passes (no Account links on `/`)

- [ ] **Step 3: Final checks before handing back**

1. `npx tsc --noEmit -p . && npm run lint`: clean.
2. Screenshots of `/` at 1440×900 and 390×844 against the real DB, compared by eye with `proto-v6.html` at the same sizes.
3. Run `curl -sI http://localhost:3457/` while signed out and check for a 200. A request with the session cookie should get a 307 to `/u/<user>/stats`, since the redirect still works.
4. Report to the user: what was verified, what wasn't, and that nothing is committed.

---

## Self-Review Notes

- **Spec coverage:**
  - data routes: Task 3
  - codec: Task 1
  - client derivations: Task 2
  - scene, wind, camera, reduced motion, dpr cap and pause when hidden: Task 4
  - HUD, buttons, latest, callouts, readout and song link, phone behaviour, error and no-WebGL states, signed-in redirect untouched: Task 5
  - Instruments and filters: Task 6
  - Pipeline and packet: Task 7
  - e2e and render verification: Task 8
  - The DB-size figure is dropped, per the spec.
- **Ordering:** Instruments come before Pipeline in `LandingClient`, numbered 01 and 02.
- **Type names used across tasks:**
  - `Prepared`, `Filter`, `Callout`, `Heightfield`, `LandingPayload`
  - `ListenAt`, `Totals`, `SceneHandle`
  - `filterUniforms`, `topOf`, `pointAt`, `fetchListen`, `showcaseUser`, `showcaseTz`
