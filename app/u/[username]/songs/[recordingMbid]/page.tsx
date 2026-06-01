import Link from "next/link";
import { notFound } from "next/navigation";
import { songDetail } from "@/lib/db/queries/songDetail";
import { CoverArt } from "@/components/CoverArt";
import { PlaysPerYearChart } from "@/components/PlaysPerYearChart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SongDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; recordingMbid: string }>;
  searchParams: Promise<{ name?: string; artist?: string }>;
}) {
  const { username, recordingMbid } = await params;
  const sp = await searchParams;
  const detail = await songDetail(username, recordingMbid, {
    trackName: sp.name,
    artistName: sp.artist,
  });
  if (!detail) notFound();

  const { header, years, albums, recent } = detail;
  const totalHours = header.total_minutes / 60;
  const playsPerDay =
    header.total_plays /
    Math.max(1, daysBetween(header.first_played, header.last_played));

  return (
    <div className="space-y-8">
      <div className="text-sm">
        <Link
          href={`/u/${encodeURIComponent(username)}/songs`}
          className="text-muted-foreground hover:text-foreground"
        >
          ← Songs
        </Link>
      </div>

      <header className="flex flex-col md:flex-row gap-6 items-start">
        <CoverArt
          art={{ caaId: header.caa_id, caaReleaseMbid: header.caa_release_mbid }}
          size={240}
          alt={header.track_name}
          className="rounded-lg shadow-md"
        />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-muted-foreground">Song</p>
          <h1 className="text-3xl font-bold leading-tight">{header.track_name}</h1>
          <p className="text-lg text-foreground/80">{header.artist_name}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm pt-2 text-muted-foreground">
            <Stat label="Plays" value={header.total_plays.toLocaleString()} />
            <Stat label="Listening time" value={fmtHours(totalHours)} />
            <Stat label="First played" value={fmtDate(header.first_played)} />
            <Stat label="Last played" value={fmtDate(header.last_played)} />
            {playsPerDay >= 0.01 && (
              <Stat label="≈ per day" value={playsPerDay.toFixed(2)} />
            )}
          </div>
        </div>
      </header>

      {years.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Plays by year
          </h2>
          <PlaysPerYearChart data={years} metric="plays" />
        </section>
      )}

      {albums.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            On albums <span className="text-subtle-foreground font-normal normal-case">({albums.length})</span>
          </h2>
          <ol className="divide-y divide-border">
            {albums.map((a, i) => {
              const inner = (
                <>
                  <span className="w-8 text-right text-sm text-subtle-foreground tabular-nums">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{a.release_name}</div>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {a.plays.toLocaleString()} plays
                  </span>
                </>
              );
              return (
                <li key={`${a.release_name}-${i}`}>
                  {a.release_mbid ? (
                    <Link
                      href={`/u/${encodeURIComponent(username)}/albums/${a.release_mbid}?${new URLSearchParams({ name: a.release_name, artist: header.artist_name })}`}
                      className="flex items-center gap-3 py-2.5 hover:bg-muted -mx-2 px-2 rounded"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-2.5">{inner}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent listens
          </h2>
          <ul className="divide-y divide-border text-sm">
            {recent.map((r, i) => (
              <li key={i} className="flex gap-3 py-1.5">
                <span className="text-subtle-foreground tabular-nums w-36">{fmtDateTime(r.listened_at)}</span>
                <span className="truncate text-muted-foreground">
                  {r.release_name ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <strong className="font-medium text-foreground">{value}</strong>{" "}
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function fmtDate(s: string): string {
  return new Date(s).toISOString().slice(0, 10);
}

function fmtDateTime(s: string): string {
  return new Date(s).toISOString().slice(0, 16).replace("T", " ");
}

function fmtHours(h: number): string {
  if (h < 1 / 60) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  const hr = Math.floor(h);
  const m = Math.round((h - hr) * 60);
  return m ? `${hr}h ${m}m` : `${hr}h`;
}

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24);
}
