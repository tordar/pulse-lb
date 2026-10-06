import type { Concert } from "@/lib/db/schema";
import { normalizeArtist } from "./match";

export type ConcertStats = {
  shows: number;
  artists: number;
  festivals: number;
  mostSeen: { name: string; mbid: string | null; count: number } | null;
};

export function concertStats(concerts: Concert[], festivals: number): ConcertStats {
  const byArtist = new Map<string, { name: string; mbid: string | null; count: number }>();
  for (const c of concerts) {
    const key = normalizeArtist(c.artistName);
    const cur = byArtist.get(key) ?? { name: c.artistName, mbid: null, count: 0 };
    cur.count++;
    cur.mbid ??= c.artistMbid;
    byArtist.set(key, cur);
  }
  let mostSeen: ConcertStats["mostSeen"] = null;
  for (const a of byArtist.values()) if (a.count > 1 && (!mostSeen || a.count > mostSeen.count)) mostSeen = a;
  return { shows: concerts.length, artists: byArtist.size, festivals, mostSeen };
}
