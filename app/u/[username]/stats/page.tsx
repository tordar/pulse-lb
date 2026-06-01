import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { SyncButton } from "./SyncButton";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Row<T> = { rows: T[] };

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  const state = await withRetry(() =>
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
  );
  const totalsRes = await withRetry(() =>
    db.execute<{ total: number; earliest: string | null; latest: string | null }>(sql`
      SELECT COUNT(*)::int AS total,
             MIN(listened_at) AS earliest,
             MAX(listened_at) AS latest
      FROM ${schema.listens} WHERE user_name = ${username}
    `),
  );
  const topArtistsRes = await withRetry(() =>
    db.execute<{ artist_name: string; plays: number }>(sql`
      SELECT artist_name, COUNT(*)::int AS plays
      FROM ${schema.listens}
      WHERE user_name = ${username} AND artist_name IS NOT NULL
      GROUP BY artist_name ORDER BY plays DESC LIMIT 10
    `),
  );
  const topAlbumsRes = await withRetry(() =>
    db.execute<{ release_name: string; artist_name: string; plays: number }>(sql`
      SELECT release_name, artist_name, COUNT(*)::int AS plays
      FROM ${schema.listens}
      WHERE user_name = ${username} AND release_name IS NOT NULL
      GROUP BY release_name, artist_name ORDER BY plays DESC LIMIT 10
    `),
  );
  const topSongsRes = await withRetry(() =>
    db.execute<{ track_name: string; artist_name: string; plays: number }>(sql`
      SELECT track_name, artist_name, COUNT(*)::int AS plays
      FROM ${schema.listens}
      WHERE user_name = ${username}
      GROUP BY track_name, artist_name ORDER BY plays DESC LIMIT 10
    `),
  );
  const recentRes = await withRetry(() =>
    db.execute<{ listened_at: string; track_name: string; artist_name: string; release_name: string | null }>(sql`
      SELECT listened_at, track_name, artist_name, release_name
      FROM ${schema.listens}
      WHERE user_name = ${username}
      ORDER BY listened_at DESC LIMIT 8
    `),
  );

  const totals = (totalsRes as Row<{ total: number; earliest: string | null; latest: string | null }>).rows?.[0] ?? { total: 0, earliest: null, latest: null };
  const topArtists = (topArtistsRes as Row<{ artist_name: string; plays: number }>).rows ?? [];
  const topAlbums = (topAlbumsRes as Row<{ release_name: string; artist_name: string; plays: number }>).rows ?? [];
  const topSongs = (topSongsRes as Row<{ track_name: string; artist_name: string; plays: number }>).rows ?? [];
  const recent = (recentRes as Row<{ listened_at: string; track_name: string; artist_name: string; release_name: string | null }>).rows ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <p className="text-sm text-gray-500">
          {totals.total.toLocaleString()} listens
          {totals.earliest && totals.latest && (
            <> · {fmtDate(totals.earliest)} → {fmtDate(totals.latest)} ({spanLabel(totals.earliest, totals.latest)})</>
          )}
          {state?.lastSyncedAt && <> · last synced {relTime(state.lastSyncedAt)}</>}
        </p>
        <SyncButton username={username} />
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Panel title="Top 10 artists" empty={topArtists.length === 0 ? (totals.total === 0 ? "click sync" : "loading…") : null}>
          <ol className="font-mono text-sm space-y-1">
            {topArtists.map((r, i) => (
              <li key={r.artist_name} className="flex justify-between gap-3">
                <span className="truncate">{String(i + 1).padStart(2, " ")}. {r.artist_name}</span>
                <span className="text-gray-500 tabular-nums">{r.plays.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Top 10 albums" empty={topAlbums.length === 0 ? (totals.total === 0 ? "click sync" : "loading…") : null}>
          <ol className="font-mono text-sm space-y-1">
            {topAlbums.map((r, i) => (
              <li key={`${r.release_name}-${r.artist_name}`} className="flex justify-between gap-3">
                <span className="truncate">
                  {String(i + 1).padStart(2, " ")}. {r.release_name}
                  <span className="text-gray-400"> · {r.artist_name}</span>
                </span>
                <span className="text-gray-500 tabular-nums">{r.plays.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Top 10 songs" empty={topSongs.length === 0 ? (totals.total === 0 ? "click sync" : "loading…") : null}>
          <ol className="font-mono text-sm space-y-1">
            {topSongs.map((r, i) => (
              <li key={`${r.track_name}-${r.artist_name}`} className="flex justify-between gap-3">
                <span className="truncate">
                  {String(i + 1).padStart(2, " ")}. {r.track_name}
                  <span className="text-gray-400"> · {r.artist_name}</span>
                </span>
                <span className="text-gray-500 tabular-nums">{r.plays.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Recent listens" className="md:col-span-2 lg:col-span-3" empty={recent.length === 0 ? "no listens yet" : null}>
          <ul className="font-mono text-sm space-y-1">
            {recent.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className="text-gray-400 tabular-nums">{fmtDateTime(r.listened_at)}</span>
                <span className="truncate">
                  {r.track_name}
                  <span className="text-gray-400"> · {r.artist_name}</span>
                  {r.release_name && <span className="text-gray-400"> · {r.release_name}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children, empty, className = "" }: { title: string; children: React.ReactNode; empty?: string | null; className?: string }) {
  return (
    <section className={`rounded-lg border border-gray-200 p-4 ${className}`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{title}</h2>
      {empty ? <p className="text-gray-400 text-sm italic">{empty}</p> : children}
    </section>
  );
}

function fmtDate(s: string): string {
  return new Date(s).toISOString().slice(0, 10);
}

function fmtDateTime(s: string): string {
  return new Date(s).toISOString().slice(0, 16).replace("T", " ");
}

function relTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function spanLabel(earliest: string, latest: string): string {
  const e = new Date(earliest);
  const l = new Date(latest);
  const months = Math.floor((l.getTime() - e.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}mo` : `${years}y`;
}
