import type { Concert, Festival } from "@/lib/db/schema";

export type TimelineEntry =
  | { kind: "concert"; date: string; concert: Concert }
  | { kind: "festival"; date: string; festival: Festival; days: { date: string; concerts: Concert[] }[] };
export type TimelineYear = { year: number; entries: TimelineEntry[] };

export function buildTimeline(concerts: Concert[], festivals: Festival[]): TimelineYear[] {
  const entries: TimelineEntry[] = [];
  const byFestival = new Map<string, Concert[]>();
  for (const c of concerts) {
    if (c.festivalId) {
      const list = byFestival.get(c.festivalId) ?? [];
      list.push(c);
      byFestival.set(c.festivalId, list);
    } else {
      entries.push({ kind: "concert", date: c.eventDate, concert: c });
    }
  }
  for (const f of festivals) {
    const days = new Map<string, Concert[]>();
    for (const c of byFestival.get(f.id) ?? []) {
      days.set(c.eventDate, [...(days.get(c.eventDate) ?? []), c]);
    }
    entries.push({
      kind: "festival",
      date: f.startDate,
      festival: f,
      days: [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, cs]) => ({ date, concerts: cs.sort((x, y) => x.artistName.localeCompare(y.artistName)) })),
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));

  const years: TimelineYear[] = [];
  for (const e of entries) {
    const year = Number(e.date.slice(0, 4));
    if (years.at(-1)?.year !== year) years.push({ year, entries: [] });
    years.at(-1)!.entries.push(e);
  }
  return years;
}
