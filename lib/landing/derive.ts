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

/** Where a listen that arrived after the payload sits on the mountain: day and minute on the payload's axes, artist rank. */
export function livePoint(p: Prepared, ts: number, artistName: string): { day: number; minute: number; artist: number } {
  const ms = ts * 1000, local = ms + offsetFinder(p.payload.header.tz)(ms);
  const localDay = Math.floor(local / DAY_MS), rank = p.payload.header.artists.indexOf(artistName);
  return {
    day: localDay - Math.round(p.baseMs / DAY_MS),
    minute: Math.floor((local - localDay * DAY_MS) / 6e4),
    artist: rank < 0 ? OTHER_ARTIST : rank,
  };
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
