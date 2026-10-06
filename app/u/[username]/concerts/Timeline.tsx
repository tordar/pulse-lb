"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MapPin } from "lucide-react";
import type { Concert, Festival } from "@/lib/db/schema";
import type { TimelineYear } from "@/lib/concerts/timeline";
import type { CoverArtRef } from "@/lib/listenbrainz/coverArt";
import { fmtDay } from "@/lib/concerts/format";
import { CoverArt } from "@/components/CoverArt";
import { ConcertForm } from "./ConcertForm";
import { FestivalForm } from "./FestivalForm";
import { DeleteButton } from "./DeleteButton";
import { SetlistImport } from "./SetlistImport";
import { deleteConcert, deleteFestival } from "./actions";

export type TimelineProps = {
  username: string;
  years: TimelineYear[];
  festivals: Festival[];
  art: Record<string, CoverArtRef>;
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
  art: Record<string, CoverArtRef>;
  isOwner: boolean;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  close: () => void;
};

const editBtn = "text-xs text-muted-foreground hover:text-foreground";
const NO_ART: CoverArtRef = { caaId: null, caaReleaseMbid: null };
const MAX_FACES = 8;

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const month = (d: string) => utc(d).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase();
const day = (d: string) => String(utc(d).getUTCDate());

// "8 / AUG" for one day, "9–10 / AUG" for a run, "30–2 / JUL–AUG" across months.
function dateBlock(start: string, end: string = start) {
  if (start === end) return { day: day(start), month: month(start) };
  const m = month(start) === month(end) ? month(start) : `${month(start)}–${month(end)}`;
  return { day: `${day(start)}–${day(end)}`, month: m };
}

export function Timeline({ username, years, festivals, art, isOwner }: TimelineProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const router = useRouter();
  const close = useCallback(() => { setEditing(null); router.refresh(); }, [router]);
  const ctx: EditCtx = { username, festivals, art, isOwner, editing, setEditing, close };

  return (
    <div className="space-y-10">
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
      {years.map((y) => {
        const shows = y.entries.reduce(
          (n, e) => n + (e.kind === "concert" ? 1 : e.days.reduce((m, d) => m + d.concerts.length, 0)), 0);
        return (
          <section key={y.year} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h2 className="text-2xl font-bold tabular-nums">{y.year}</h2>
              <div className="h-px flex-1 bg-border self-center" />
              <span className="text-xs text-muted-foreground tabular-nums">
                {shows} {shows === 1 ? "show" : "shows"}
              </span>
            </div>
            <ul className="grid gap-3 md:grid-cols-2">
              {y.entries.map((e) =>
                e.kind === "concert" ? (
                  <li key={e.concert.id} className="min-w-0"><ConcertTicket ctx={ctx} c={e.concert} /></li>
                ) : (
                  <li key={e.festival.id} className="min-w-0 md:col-span-2">
                    <FestivalTicket ctx={ctx} festival={e.festival} days={e.days} />
                  </li>
                ),
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The ticket shell: a date stub, a perforation with notches, and the body. */
function Stub({ start, end, children }: { start: string; end?: string; children: React.ReactNode }) {
  const d = dateBlock(start, end);
  return (
    <div className="relative flex h-full rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="w-20 shrink-0 flex flex-col items-center justify-center py-3 px-1 text-center bg-muted/40">
        <span className={`${d.day.length > 2 ? "text-base" : "text-xl"} font-bold leading-none tabular-nums whitespace-nowrap`}>{d.day}</span>
        <span className="mt-1 text-[10px] font-semibold tracking-widest text-primary">{d.month}</span>
      </div>
      <div className="relative border-l border-dashed border-card-border">
        <span className="absolute -left-[7px] -top-[7px] size-3.5 rounded-full bg-background border border-card-border" />
        <span className="absolute -left-[7px] -bottom-[7px] size-3.5 rounded-full bg-background border border-card-border" />
      </div>
      <div className="min-w-0 flex-1 p-3">{children}</div>
    </div>
  );
}

function artistHref(username: string, c: Concert) {
  return c.artistMbid ? `/u/${encodeURIComponent(username)}/artists/${c.artistMbid}` : null;
}

function Face({ ctx, c, size }: { ctx: EditCtx; c: Concert; size: number }) {
  return (
    <CoverArt
      art={(c.artistMbid && ctx.art[c.artistMbid]) || NO_ART}
      size={size}
      alt={c.artistName}
      className="rounded-full ring-2 ring-card"
    />
  );
}

function OwnerControls({ onEdit, onDelete, deleteLabel }: {
  onEdit: () => void; onDelete: () => Promise<void>; deleteLabel?: string;
}) {
  return (
    <span className="shrink-0 flex gap-2 items-baseline">
      <button type="button" onClick={onEdit} className={editBtn}>Edit</button>
      <DeleteButton label={deleteLabel} onConfirm={onDelete} />
    </span>
  );
}

function ConcertTicket({ ctx, c }: { ctx: EditCtx; c: Concert }) {
  const { username, isOwner, editing, setEditing, close } = ctx;
  if (isOwner && editing?.kind === "concert" && editing.id === c.id) {
    return <ConcertForm username={username} festivals={ctx.festivals} initial={c} onDone={close} />;
  }
  const href = artistHref(username, c);
  const place = [c.venue, c.city].filter(Boolean).join(", ");
  return (
    <Stub start={c.eventDate}>
      <div className="flex items-center gap-3 h-full">
        <Face ctx={ctx} c={c} size={44} />
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} className="block truncate font-semibold hover:underline">{c.artistName}</Link>
          ) : (
            <div className="truncate font-semibold">{c.artistName}</div>
          )}
          {place && (
            <div className="truncate text-xs text-muted-foreground inline-flex items-center gap-1 max-w-full">
              <MapPin size={11} className="shrink-0" /> <span className="truncate">{place}</span>
            </div>
          )}
        </div>
        {isOwner && (
          <OwnerControls
            onEdit={() => setEditing({ kind: "concert", id: c.id })}
            onDelete={async () => { await deleteConcert(username, c.id); close(); }}
          />
        )}
      </div>
    </Stub>
  );
}

function FestivalTicket({
  ctx, festival, days,
}: { ctx: EditCtx; festival: Festival; days: { date: string; concerts: Concert[] }[] }) {
  const { username, festivals, isOwner, editing, setEditing, close } = ctx;
  const [open, setOpen] = useState(false);
  const sets = days.flatMap((d) => d.concerts);
  const editingThis = isOwner && editing?.kind === "festival" && editing.id === festival.id;
  const adding = isOwner && editing?.kind === "add-to-festival" && editing.festivalId === festival.id;
  const place = [festival.venue, festival.city].filter(Boolean).join(", ");

  if (editingThis) return <FestivalForm username={username} initial={festival} onDone={close} />;

  return (
    <Stub start={festival.startDate} end={festival.endDate}>
      <div className="flex gap-4">
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold tracking-widest text-primary">FESTIVAL</div>
            <div className="truncate text-lg font-bold uppercase tracking-tight">{festival.name}</div>
            {place && (
              <div className="truncate text-xs text-muted-foreground inline-flex items-center gap-1 max-w-full">
                <MapPin size={11} className="shrink-0" /> <span className="truncate">{place}</span>
              </div>
            )}
          </div>
          {isOwner && (
            <OwnerControls
              onEdit={() => setEditing({ kind: "festival", id: festival.id })}
              onDelete={async () => { await deleteFestival(username, festival.id); close(); }}
              deleteLabel="Delete festival"
            />
          )}
        </div>

        {sets.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex -space-x-2 shrink-0">
              {sets.slice(0, MAX_FACES).map((c) => <Face key={c.id} ctx={ctx} c={c} size={32} />)}
              {sets.length > MAX_FACES && (
                <span className="size-8 rounded-full ring-2 ring-card bg-muted text-[11px] font-medium flex items-center justify-center">
                  +{sets.length - MAX_FACES}
                </span>
              )}
            </div>
            <p className="min-w-0 text-sm text-muted-foreground line-clamp-2">
              {sets.map((c) => c.artistName).join(" · ")}
            </p>
          </div>
        )}

        {(days.length > 1 || isOwner) && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
            className={`${editBtn} inline-flex items-center gap-1`}>
            {open ? "Hide days" : "By day"}
            <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />
          </button>
        )}

        {open && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pt-1">
            {days.map((d) => (
              <div key={d.date} className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">{fmtDay(d.date)}</div>
                <ul className="space-y-1.5">
                  {d.concerts.map((c) => <SetRow key={c.id} ctx={ctx} c={c} />)}
                </ul>
              </div>
            ))}
            {isOwner && (
              <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                <button type="button" onClick={() => setEditing({ kind: "add-to-festival", festivalId: festival.id })} className={editBtn}>
                  + Add artist
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
      </div>
      {festival.posterUrl && <Poster url={festival.posterUrl} name={festival.name} />}
      </div>
    </Stub>
  );
}

function SetRow({ ctx, c }: { ctx: EditCtx; c: Concert }) {
  const { username, isOwner, editing, setEditing, close } = ctx;
  if (isOwner && editing?.kind === "concert" && editing.id === c.id) {
    return <li><ConcertForm username={username} festivals={ctx.festivals} initial={c} onDone={close} /></li>;
  }
  const href = artistHref(username, c);
  return (
    <li className="flex items-center gap-2 text-sm">
      <Face ctx={ctx} c={c} size={24} />
      {href ? (
        <Link href={href} className="min-w-0 flex-1 truncate hover:underline">{c.artistName}</Link>
      ) : (
        <span className="min-w-0 flex-1 truncate">{c.artistName}</span>
      )}
      {isOwner && (
        <OwnerControls
          onEdit={() => setEditing({ kind: "concert", id: c.id })}
          onDelete={async () => { await deleteConcert(username, c.id); close(); }}
        />
      )}
    </li>
  );
}

// Posters are links to images hosted elsewhere, so a dead link just hides the
// poster instead of showing a broken image.
function Poster({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 self-start" title={`${name} poster`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external host; next/image would need it allow-listed */}
      <img
        src={url}
        alt={`${name} poster`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-20 sm:w-28 aspect-[2/3] rounded-md object-cover border border-card-border bg-muted transition hover:opacity-90"
      />
    </a>
  );
}
