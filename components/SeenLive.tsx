import { Ticket } from "lucide-react";
import type { ArtistConcert } from "@/lib/db/queries/concerts";
import { fmtConcertDate, fmtDay } from "@/lib/concerts/format";

export function SeenLive({ concerts }: { concerts: ArtistConcert[] }) {
  if (concerts.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
        <Ticket size={15} className="text-primary" /> Seen live{" "}
        <span className="text-subtle-foreground font-normal normal-case">({concerts.length})</span>
      </h2>
      <ul className="divide-y divide-border text-sm">
        {concerts.map((c) => (
          <li key={c.id} className="flex gap-3 py-2 items-baseline">
            <span className="text-subtle-foreground tabular-nums shrink-0 text-xs whitespace-nowrap">
              {c.festivalName ? fmtDay(c.eventDate) + " " + c.eventDate.slice(0, 4) : fmtConcertDate(c.eventDate)}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {c.festivalName ?? c.venue ?? "Unknown venue"}
              {c.city && <span className="text-subtle-foreground"> · {c.city}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
