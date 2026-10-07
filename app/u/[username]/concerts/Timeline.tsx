"use client";

import { IntentLink } from "@/components/IntentLink";
import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { Concert, Festival } from "@/lib/db/schema";
import type { TimelineYear } from "@/lib/concerts/timeline";
import type { CoverArtRef } from "@/lib/listenbrainz/coverArt";
import { fmtConcertDate, fmtDay, fmtRange } from "@/lib/concerts/format";
import { CoverArt } from "@/components/CoverArt";
import { ConcertForm } from "./ConcertForm";
import { FestivalForm } from "./FestivalForm";
import { DeleteButton } from "./DeleteButton";
import { useEditMode, type Editing } from "./EditMode";
import { deleteConcert, deleteFestival } from "./actions";

export type TimelineProps = {
  username: string;
  years: TimelineYear[];
  festivals: Festival[];
  art: Record<string, CoverArtRef>;
};

type Ctx = {
  username: string;
  festivals: Festival[];
  art: Record<string, CoverArtRef>;
  editMode: boolean;
  editing: Editing | null;
  setEditing: (e: Editing | null) => void;
  close: () => void;
};

const quietBtn = "text-xs text-muted-foreground hover:text-foreground";
const NO_ART: CoverArtRef = { caaId: null, caaReleaseMbid: null };

export function Timeline({ username, years, festivals, art }: TimelineProps) {
  const { editMode, editing, setEditing, close } = useEditMode();
  const ctx: Ctx = { username, festivals, art, editMode, editing, setEditing, close };

  return (
    <div className="space-y-8">
      {years.length === 0 && <p className="text-sm text-muted-foreground">No concerts yet.</p>}
      {years.map((y) => {
        const shows = y.entries.reduce(
          (n, e) => n + (e.kind === "concert" ? 1 : e.days.reduce((m, d) => m + d.concerts.length, 0)), 0);
        return (
          <section key={y.year} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
              <CalendarDays size={15} className="text-primary" /> {y.year}{" "}
              <span className="text-subtle-foreground font-normal normal-case">({shows})</span>
            </h2>
            <ul className="divide-y divide-border">
              {y.entries.map((e) =>
                e.kind === "concert" ? (
                  <ConcertRow key={e.concert.id} ctx={ctx} c={e.concert} />
                ) : (
                  <FestivalRow key={e.festival.id} ctx={ctx} festival={e.festival} days={e.days} />
                ),
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function artistHref(username: string, c: Concert) {
  return c.artistMbid ? `/u/${encodeURIComponent(username)}/artists/${c.artistMbid}` : null;
}

function EditControls({ onEdit, onDelete, deleteLabel }: {
  onEdit: () => void; onDelete: () => Promise<void>; deleteLabel?: string;
}) {
  return (
    <span className="shrink-0 flex gap-3 items-baseline">
      <button type="button" onClick={onEdit} className={quietBtn}>Edit</button>
      <DeleteButton label={deleteLabel} onConfirm={onDelete} />
    </span>
  );
}

/** One list row in the same shape as the Top Artists list: image, title + subtitle, value on the right. */
function Row({ image, title, subtitle, right, href, controls }: {
  image: React.ReactNode; title: React.ReactNode; subtitle?: string | null; right?: string;
  href?: string | null; controls?: React.ReactNode;
}) {
  const body = (
    <>
      {image}
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {right && <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{right}</span>}
    </>
  );
  return (
    <div className="flex items-center gap-3">
      {href ? (
        <IntentLink href={href} className="flex-1 min-w-0 flex items-center gap-3 py-2.5 hover:bg-muted active:bg-muted transition-colors -mx-2 px-2 rounded">
          {body}
        </IntentLink>
      ) : (
        <div className="flex-1 min-w-0 flex items-center gap-3 py-2.5">{body}</div>
      )}
      {controls}
    </div>
  );
}

function ConcertRow({ ctx, c }: { ctx: Ctx; c: Concert }) {
  const { username, editMode, editing, setEditing, close } = ctx;
  if (editMode && editing?.kind === "concert" && editing.id === c.id) {
    return <li className="py-2"><ConcertForm username={username} festivals={ctx.festivals} initial={c} onDone={close} /></li>;
  }
  return (
    <li>
      <Row
        image={<CoverArt art={(c.artistMbid && ctx.art[c.artistMbid]) || NO_ART} size={40} alt={c.artistName} className="rounded-full" />}
        title={c.artistName}
        subtitle={[c.venue, c.city].filter(Boolean).join(", ")}
        right={fmtConcertDate(c.eventDate)}
        href={artistHref(username, c)}
        controls={editMode && (
          <EditControls
            onEdit={() => setEditing({ kind: "concert", id: c.id })}
            onDelete={async () => { await deleteConcert(username, c.id); close(); }}
          />
        )}
      />
    </li>
  );
}

function FestivalRow({
  ctx, festival, days,
}: { ctx: Ctx; festival: Festival; days: { date: string; concerts: Concert[] }[] }) {
  const { username, festivals, editMode, editing, setEditing, close } = ctx;
  const [open, setOpen] = useState(false);
  const sets = days.flatMap((d) => d.concerts);

  if (editMode && editing?.kind === "festival" && editing.id === festival.id) {
    return <li className="py-2"><FestivalForm username={username} initial={festival} onDone={close} /></li>;
  }
  const adding = editMode && editing?.kind === "add-to-festival" && editing.festivalId === festival.id;
  const place = [festival.venue, festival.city].filter(Boolean).join(", ");
  const expanded = open || editMode;

  return (
    <li>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={expanded}
          className="flex-1 min-w-0 flex items-center gap-3 py-2.5 text-left hover:bg-muted active:bg-muted transition-colors -mx-2 px-2 rounded">
          <FestivalImage festival={festival} />
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium">{festival.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {sets.length} {sets.length === 1 ? "artist" : "artists"}{place && ` · ${place}`}
            </div>
          </div>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {fmtRange(festival.startDate, festival.endDate)}
          </span>
          <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition ${expanded ? "rotate-180" : ""}`} />
        </button>
        {editMode && (
          <EditControls
            onEdit={() => setEditing({ kind: "festival", id: festival.id })}
            onDelete={async () => { await deleteFestival(username, festival.id); close(); }}
            deleteLabel="Delete festival"
          />
        )}
      </div>

      {expanded && (
        <div className="pl-[52px] pb-2">
          {days.map((d) => (
            <div key={d.date}>
              {days.length > 1 && (
                <div className="pt-2 text-xs text-subtle-foreground uppercase tracking-wide">{fmtDay(d.date)}</div>
              )}
              <ul className="divide-y divide-border">
                {d.concerts.map((c) => <FestivalSet key={c.id} ctx={ctx} c={c} />)}
              </ul>
            </div>
          ))}
          {editMode && (
            <div className="pt-2 space-y-2">
              <button type="button" onClick={() => setEditing({ kind: "add-to-festival", festivalId: festival.id })} className={quietBtn}>
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
    </li>
  );
}

function FestivalSet({ ctx, c }: { ctx: Ctx; c: Concert }) {
  const { username, editMode, editing, setEditing, close } = ctx;
  if (editMode && editing?.kind === "concert" && editing.id === c.id) {
    return <li className="py-2"><ConcertForm username={username} festivals={ctx.festivals} initial={c} onDone={close} /></li>;
  }
  return (
    <li>
      <Row
        image={<CoverArt art={(c.artistMbid && ctx.art[c.artistMbid]) || NO_ART} size={32} alt={c.artistName} className="rounded-full" />}
        title={c.artistName}
        href={artistHref(username, c)}
        controls={editMode && (
          <EditControls
            onEdit={() => setEditing({ kind: "concert", id: c.id })}
            onDelete={async () => { await deleteConcert(username, c.id); close(); }}
          />
        )}
      />
    </li>
  );
}

// The festival's poster when it has one (a link to an image hosted elsewhere),
// otherwise the same placeholder an artist without cover art gets.
function FestivalImage({ festival }: { festival: Festival }) {
  const [failed, setFailed] = useState(false);
  if (!festival.posterUrl || failed) {
    return <CoverArt art={NO_ART} size={40} alt={festival.name} className="rounded" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary external host; next/image would need it allow-listed
    <img
      src={festival.posterUrl}
      alt={`${festival.name} poster`}
      width={40}
      height={40}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-10 shrink-0 rounded object-cover bg-muted"
    />
  );
}
