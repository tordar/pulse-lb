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
