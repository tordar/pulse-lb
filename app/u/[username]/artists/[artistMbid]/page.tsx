import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Clock, Disc3, Music2, TrendingUp, Users } from "lucide-react";
import { artistDetail } from "@/lib/db/queries/artistDetail";
import { getUserByLbUsername } from "@/lib/auth/users";
import { SourceDot } from "@/components/SourceDot";
import { CoverArt } from "@/components/CoverArt";
import { PlaysPerYearChart } from "@/components/PlaysPerYearChart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ArtistDetailPage({
  params,
}: {
  params: Promise<{ username: string; artistMbid: string }>;
}) {
  const { username, artistMbid } = await params;
  const [detail, showSource] = await Promise.all([
    artistDetail(username, artistMbid),
    getUserByLbUsername(username)
      .then((u) => u?.showListenSource ?? false)
      .catch(() => false),
  ]);
  if (!detail) notFound();

  const { header, years, topSongs, topAlbums, recent } = detail;
  const totalHours = header.total_minutes / 60;

  return (
    <div className="space-y-8">
      <div className="text-sm">
        <Link
          href={`/u/${encodeURIComponent(username)}/artists`}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={14} /> Artists
        </Link>
      </div>

      <header className="space-y-4 text-center md:text-left">
        <p className="text-xs text-primary uppercase tracking-wide inline-flex items-center gap-1.5">
          <Users size={13} /> Artist
        </p>
        <h1 className="text-4xl font-bold leading-tight">{header.artist_name}</h1>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm md:flex md:flex-wrap md:gap-x-8 md:gap-y-2">
          <Stat label="Plays" value={header.total_plays.toLocaleString()} />
          <Stat label="Listening time" value={fmtHours(totalHours)} />
          <Stat label="Songs" value={header.distinct_tracks.toLocaleString()} />
          <Stat label="Albums" value={header.distinct_albums.toLocaleString()} />
          <Stat label="First played" value={fmtDate(header.first_played)} />
          <Stat label="Last played" value={fmtDate(header.last_played)} />
        </div>
      </header>

      {years.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
            <TrendingUp size={15} className="text-primary" /> Plays by year
          </h2>
          <PlaysPerYearChart data={years} metric="plays" />
        </section>
      )}

      {topAlbums.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
            <Disc3 size={15} className="text-primary" /> Top albums <span className="text-subtle-foreground font-normal normal-case">({topAlbums.length})</span>
          </h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {topAlbums.map((a) => {
              const href = a.release_mbid
                ? `/u/${encodeURIComponent(username)}/albums/${a.release_mbid}?${new URLSearchParams({ name: a.release_name, artist: header.artist_name })}`
                : null;
              const inner = (
                <>
                  <CoverArt
                    art={{ caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid }}
                    size={200}
                    alt={a.release_name}
                    className="w-full h-auto aspect-square rounded-md"
                  />
                  <div className="space-y-0.5">
                    <div className="truncate text-sm font-medium">{a.release_name}</div>
                    <div className="text-xs text-subtle-foreground tabular-nums">{a.plays.toLocaleString()} plays</div>
                  </div>
                </>
              );
              return (
                <li key={a.release_name} className="space-y-2">
                  {href ? <Link href={href} className="block space-y-2 transition active:scale-[0.98] active:opacity-80">{inner}</Link> : inner}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {topSongs.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
            <Music2 size={15} className="text-primary" /> Top songs <span className="text-subtle-foreground font-normal normal-case">({topSongs.length})</span>
          </h2>
          <ol className="divide-y divide-border">
            {topSongs.map((s, i) => {
              const href = s.recording_mbid
                ? `/u/${encodeURIComponent(username)}/songs/${s.recording_mbid}?${new URLSearchParams({ name: s.track_name, artist: header.artist_name })}`
                : null;
              const row = (
                <>
                  <span className="w-8 text-right text-sm text-subtle-foreground tabular-nums">{i + 1}</span>
                  <CoverArt
                    art={{ caaId: s.caa_id, caaReleaseMbid: s.caa_release_mbid }}
                    size={40}
                    alt={s.track_name}
                    className="rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">{s.track_name}</div>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {s.plays.toLocaleString()} plays
                  </span>
                </>
              );
              return (
                <li key={`${s.track_name}-${i}`}>
                  {href ? (
                    <Link
                      href={href}
                      className="flex items-center gap-3 py-2.5 hover:bg-muted active:bg-muted transition-colors -mx-2 px-2 rounded"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-2.5">{row}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {recent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
            <Clock size={15} className="text-primary" /> Recent listens
          </h2>
          <ul className="divide-y divide-border text-sm">
            {recent.map((r, i) => {
              const [date, time] = fmtDateTime(r.listened_at).split(" ");
              return (
                <li key={i} className="flex gap-3 py-1.5 items-baseline">
                  <span className="text-subtle-foreground tabular-nums shrink-0 text-xs leading-tight whitespace-nowrap">
                    <span className="block">{date}</span>
                    <span className="block">{time}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.track_name}
                    {r.release_name && (
                      <span className="text-subtle-foreground"> · {r.release_name}</span>
                    )}
                  </span>
                  {showSource && <SourceDot source={r.source} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-base font-semibold text-foreground tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
    </div>
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
