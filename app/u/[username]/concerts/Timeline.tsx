"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { Concert, Festival } from "@/lib/db/schema";
import type { TimelineYear } from "@/lib/concerts/timeline";
import { fmtConcertDate, fmtDay, fmtRange } from "@/lib/concerts/format";
import { ConcertForm } from "./ConcertForm";
import { FestivalForm } from "./FestivalForm";
import { DeleteButton } from "./DeleteButton";
import { SetlistImport } from "./SetlistImport";
import { deleteConcert, deleteFestival } from "./actions";

export type TimelineProps = {
  username: string;
  years: TimelineYear[];
  festivals: Festival[];
  isOwner: boolean;
};

type Editing =
  | { kind: "new-concert" } | { kind: "new-festival" }
  | { kind: "concert"; id: string } | { kind: "festival"; id: string }
  | { kind: "add-to-festival"; festivalId: string }
  | { kind: "from-setlist"; initial: Partial<Concert> };

type EditCtx = {
  username: string;
  festivals: Festival[];
  isOwner: boolean;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  close: () => void;
};

const editBtn = "text-xs text-muted-foreground hover:text-foreground";

export function Timeline({ username, years, festivals, isOwner }: TimelineProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const router = useRouter();
  const close = useCallback(() => { setEditing(null); router.refresh(); }, [router]);
  const ctx: EditCtx = { username, festivals, isOwner, editing, setEditing, close };

  return (
    <div className="space-y-8">
      {isOwner && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing({ kind: "new-concert" })}
              className="text-sm rounded-md bg-primary text-primary-foreground px-3 py-1.5">Add concert</button>
            <button type="button" onClick={() => setEditing({ kind: "new-festival" })}
              className="text-sm rounded-md border border-card-border px-3 py-1.5">Add festival</button>
          </div>
          <SetlistImport username={username} festivals={festivals}
            onLoaded={(initial) => setEditing({ kind: "from-setlist", initial })} />
          {editing?.kind === "new-concert" && <ConcertForm username={username} festivals={festivals} onDone={close} />}
          {editing?.kind === "from-setlist" && (
            <ConcertForm key={`${editing.initial.setlistUrl}`} username={username} festivals={festivals}
              initial={editing.initial} onDone={close} />
          )}
          {editing?.kind === "new-festival" && <FestivalForm username={username} onDone={close} />}
        </div>
      )}
      {years.length === 0 && <p className="text-sm text-muted-foreground">No concerts yet.</p>}
      {years.map((y) => (
        <section key={y.year} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{y.year}</h2>
          <ul className="divide-y divide-border">
            {y.entries.map((e) =>
              e.kind === "concert" ? (
                <li key={e.concert.id} className="py-2.5">
                  <ConcertLine ctx={ctx} c={e.concert} date={fmtConcertDate(e.date)} />
                </li>
              ) : (
                <FestivalCard key={e.festival.id} ctx={ctx} festival={e.festival} days={e.days} />
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ArtistName({ username, c }: { username: string; c: Concert }) {
  return c.artistMbid ? (
    <Link href={`/u/${encodeURIComponent(username)}/artists/${c.artistMbid}`} className="font-medium hover:underline">
      {c.artistName}
    </Link>
  ) : (
    <span className="font-medium">{c.artistName}</span>
  );
}

function ConcertEditor({ ctx, c }: { ctx: EditCtx; c: Concert }) {
  return <ConcertForm username={ctx.username} festivals={ctx.festivals} initial={c} onDone={ctx.close} />;
}

function ConcertLine({ ctx, c, date }: { ctx: EditCtx; c: Concert; date: string }) {
  const { username, isOwner, editing, setEditing, close } = ctx;
  const isEditing = isOwner && editing?.kind === "concert" && editing.id === c.id;
  return (
    <>
      <div className="flex gap-3 items-baseline text-sm">
        <span className="w-24 shrink-0 text-xs text-subtle-foreground tabular-nums">{date}</span>
        <span className="min-w-0 flex-1 truncate">
          <ArtistName username={username} c={c} />
          {(c.venue || c.city) && (
            <span className="text-subtle-foreground"> · {[c.venue, c.city].filter(Boolean).join(", ")}</span>
          )}
        </span>
        {isOwner && (
          <span className="shrink-0 flex gap-2 items-baseline">
            <button type="button" onClick={() => setEditing({ kind: "concert", id: c.id })} className={editBtn}>Edit</button>
            <DeleteButton onConfirm={async () => { await deleteConcert(username, c.id); close(); }} />
          </span>
        )}
      </div>
      {isEditing && <div className="mt-2"><ConcertEditor ctx={ctx} c={c} /></div>}
    </>
  );
}

function FestivalCard({
  ctx, festival, days,
}: { ctx: EditCtx; festival: Festival; days: { date: string; concerts: Concert[] }[] }) {
  const { username, festivals, isOwner, editing, setEditing, close } = ctx;
  const [open, setOpen] = useState(false);
  const count = days.reduce((n, d) => n + d.concerts.length, 0);
  const editingThis = isOwner && editing?.kind === "festival" && editing.id === festival.id;
  const adding = isOwner && editing?.kind === "add-to-festival" && editing.festivalId === festival.id;
  return (
    <li className="py-2.5">
      <div className="flex gap-3 items-baseline">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="min-w-0 flex-1 flex gap-3 items-baseline text-sm text-left"
        >
          <span className="w-24 shrink-0 text-xs text-subtle-foreground tabular-nums">
            {fmtRange(festival.startDate, festival.endDate)}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">
            {festival.name}
            <span className="font-normal text-subtle-foreground">
              {" "}· {count} {count === 1 ? "artist" : "artists"}
              {festival.city && ` · ${festival.city}`}
            </span>
          </span>
          <ChevronDown size={14} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
        </button>
        {isOwner && (
          <span className="shrink-0 flex gap-2 items-baseline">
            <button type="button" onClick={() => setEditing({ kind: "festival", id: festival.id })} className={editBtn}>Edit</button>
            <DeleteButton
              label="Delete festival"
              onConfirm={async () => { await deleteFestival(username, festival.id); close(); }}
            />
          </span>
        )}
      </div>
      {editingThis && <div className="mt-2"><FestivalForm username={username} initial={festival} onDone={close} /></div>}
      {open && (
        <div className="mt-2 ml-[6.75rem] space-y-2">
          {days.map((d) => (
            <div key={d.date}>
              <div className="text-xs text-subtle-foreground">{fmtDay(d.date)}</div>
              <ul className="text-sm">
                {d.concerts.map((c) => (
                  <li key={c.id} className="py-0.5">
                    {isOwner ? <ConcertLine ctx={ctx} c={c} date="" /> : <ArtistName username={username} c={c} />}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {isOwner && (
            <div className="space-y-2">
              <button type="button" onClick={() => setEditing({ kind: "add-to-festival", festivalId: festival.id })} className={editBtn}>
                Add artist
              </button>
              {adding && (
                <ConcertForm
                  username={username}
                  festivals={festivals}
                  initial={{ festivalId: festival.id, eventDate: festival.startDate, venue: festival.venue, city: festival.city, country: festival.country }}
                  onDone={close}
                />
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
