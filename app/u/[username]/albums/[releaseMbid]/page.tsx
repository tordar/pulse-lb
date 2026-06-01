import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Disc3, Music2, Play, TrendingUp } from "lucide-react";
import { albumDetail } from "@/lib/db/queries/albumDetail";
import { getReleaseMeta } from "@/lib/musicbrainz/client";
import { CoverArt } from "@/components/CoverArt";
import { PlaysPerYearChart } from "@/components/PlaysPerYearChart";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AlbumDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; releaseMbid: string }>;
  searchParams: Promise<{ name?: string; artist?: string }>;
}) {
  const { username, releaseMbid } = await params;
  const sp = await searchParams;
  const detail = await albumDetail(username, releaseMbid, {
    releaseName: sp.name,
    artistName: sp.artist,
  });
  if (!detail) notFound();

  // Best-effort: get full tracklist size from MB for the "N/M played" line.
  // Use the user's most-PLAYED release_mbid for this album rather than
  // whatever happened to be in the URL — the URL might point to a box set
  // edition while most plays were under the standalone album.
  const lookupMbid = detail.header.canonical_release_mbid ?? releaseMbid;
  const meta = await getReleaseMeta(lookupMbid).catch(() => null);
  const totalTracks = meta?.trackCount ?? null;

  const { header, years, tracks } = detail;
  const totalHours = header.total_minutes / 60;
  const span = `${fmtDate(header.first_played)}`;

  return (
    <div className="space-y-8">
      <div className="text-sm">
        <Link
          href={`/u/${encodeURIComponent(username)}/albums`}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={14} /> Albums
        </Link>
      </div>

      <header className="flex flex-col md:flex-row gap-6 items-start">
        <CoverArt
          art={{ caaId: header.caa_id, caaReleaseMbid: header.caa_release_mbid }}
          size={240}
          alt={header.release_name}
          className="rounded-lg shadow-md"
        />
        <div className="flex-1 space-y-2">
          <p className="text-xs text-primary uppercase tracking-wide inline-flex items-center gap-1.5">
            <Disc3 size={13} /> Album
          </p>
          <h1 className="text-3xl font-bold leading-tight">{header.release_name}</h1>
          <p className="text-lg text-foreground/80">{header.artist_name}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm pt-2 text-muted-foreground">
            <Stat label="Plays" value={header.total_plays.toLocaleString()} />
            <Stat label="Listening time" value={fmtHours(totalHours)} />
            <Stat
              label="Tracks played"
              value={
                totalTracks
                  ? `${header.distinct_recordings} / ${totalTracks}`
                  : `${header.distinct_recordings}`
              }
            />
            <Stat label="First played" value={span} />
          </div>
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

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
          <Music2 size={15} className="text-primary" /> Songs <span className="text-subtle-foreground font-normal normal-case">({tracks.length})</span>
        </h2>
        <ol className="divide-y divide-border">
          {tracks.map((t, i) => {
            const songHref = t.recording_mbid
              ? `/u/${encodeURIComponent(username)}/songs/${t.recording_mbid}?${new URLSearchParams({ name: t.track_name, artist: header.artist_name })}`
              : null;
            const row = (
              <>
                <span className="w-8 text-right text-sm text-subtle-foreground tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{t.track_name}</div>
                  <div className="text-xs text-muted-foreground">first played {fmtDate(t.first_played)}</div>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground w-20 text-right">
                  {t.plays.toLocaleString()} plays
                </span>
                {t.minutes > 0 && (
                  <span className="shrink-0 text-xs tabular-nums text-subtle-foreground w-16 text-right">
                    {fmtHours(t.minutes / 60)}
                  </span>
                )}
              </>
            );
            return (
              <li key={`${t.recording_mbid ?? t.track_name}-${i}`}>
                {songHref ? (
                  <Link
                    href={songHref}
                    className="flex items-center gap-3 py-2.5 hover:bg-muted -mx-2 px-2 rounded"
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

function fmtHours(h: number): string {
  if (h < 1 / 60) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  const hr = Math.floor(h);
  const m = Math.round((h - hr) * 60);
  return m ? `${hr}h ${m}m` : `${hr}h`;
}
