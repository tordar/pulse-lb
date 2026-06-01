import Link from "next/link";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import {
  allTimeStats,
  todayStats,
  yearlyListening,
  hourlyDistribution,
  dailyListening,
  availableYears,
  topSongsByYear,
  topAlbumsByYear,
  topArtistsByYear,
} from "@/lib/db/queries/stats";
import { SyncButton } from "./SyncButton";
import { YearlyChart } from "@/components/YearlyChart";
import { HourlyChart } from "@/components/HourlyChart";
import { Heatmap } from "@/components/Heatmap";
import { YearTabs } from "@/components/YearTabs";
import { CoverArt } from "@/components/CoverArt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { username } = await params;
  const sp = await searchParams;

  const state = await withRetry(() =>
    db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
  );
  const allTime = await allTimeStats(username);
  const today = await todayStats(username);
  const yearly = await yearlyListening(username);
  const hourly = await hourlyDistribution(username);
  const daily = await dailyListening(username, 365);
  const recent = await withRetry(() =>
    db.execute<{
      listened_at: string;
      track_name: string;
      artist_name: string;
      release_name: string | null;
    }>(sql`
      SELECT listened_at, track_name, artist_name, release_name
      FROM ${schema.listens}
      WHERE user_name = ${username}
      ORDER BY listened_at DESC LIMIT 10
    `),
  );
  const recentRows = (recent as unknown as { rows: { listened_at: string; track_name: string; artist_name: string; release_name: string | null }[] }).rows;

  const empty = allTime.total_plays === 0;

  const years = empty ? [] : await availableYears(username);
  const selectedYear = years.length
    ? Math.max(years[years.length - 1], Math.min(years[0], parseInt(sp.year ?? "", 10) || years[0]))
    : null;
  const [yearSongs, yearAlbums, yearArtists] = selectedYear
    ? await Promise.all([
        topSongsByYear(username, selectedYear),
        topAlbumsByYear(username, selectedYear),
        topArtistsByYear(username, selectedYear),
      ])
    : [[], [], []];

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {state?.lastSyncedAt
            ? <>Last synced {relTime(state.lastSyncedAt)}</>
            : <>Not synced yet</>}
        </p>
        <SyncButton username={username} />
      </header>

      {empty ? (
        <p className="py-16 text-center text-muted-foreground text-sm">
          No listens yet. Click sync to backfill.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile big value={allTime.total_plays.toLocaleString()} label="plays" />
            <StatTile big value={fmtHours(allTime.effective_ms / 1000 / 3600)} label="listening time" />
            <StatTile value={allTime.distinct_artists.toLocaleString()} label="artists" />
            <StatTile value={allTime.distinct_albums.toLocaleString()} label="albums" />
            <StatTile value={allTime.distinct_songs.toLocaleString()} label="songs" />
            <StatTile
              value={
                allTime.first_played && allTime.last_played
                  ? spanLabel(allTime.first_played, allTime.last_played)
                  : "—"
              }
              label={
                allTime.first_played
                  ? `since ${fmtDate(allTime.first_played)}`
                  : "span"
              }
            />
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card title="Today">
              <div className="flex items-baseline gap-6">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">{today.plays.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">plays</div>
                </div>
                <div>
                  <div className="text-3xl font-semibold tabular-nums">
                    {fmtHours(today.effective_ms / 1000 / 3600)}
                  </div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">listening time</div>
                </div>
              </div>
            </Card>

            <Card title="Coverage">
              <div className="space-y-1">
                <div className="text-sm">
                  Listening time is estimated from MusicBrainz track lengths for plays missing duration. Coverage grows as you click into more albums and artists (the cache fills opportunistically).
                </div>
                <div className="text-xs text-muted-foreground tabular-nums pt-1">
                  {allTime.duration_coverage_pct?.toFixed(1) ?? "0"}% of your plays have a known duration.
                </div>
              </div>
            </Card>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Listening by year</h2>
            <YearlyChart data={yearly} height={260} />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              When you listen <span className="text-subtle-foreground font-normal normal-case">(hour of day, all-time)</span>
            </h2>
            <HourlyChart data={hourly} height={200} />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Last 365 days
            </h2>
            <Heatmap days={daily} />
          </section>

          {selectedYear !== null && years.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Top by year
                </h2>
              </div>
              <YearTabs years={years} active={selectedYear} />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                <YearColumn title="Top songs">
                  {yearSongs.length === 0 ? (
                    <Empty />
                  ) : (
                    yearSongs.map((s, i) => {
                      const href = s.recording_mbid
                        ? `/u/${encodeURIComponent(username)}/songs/${s.recording_mbid}?${new URLSearchParams({ name: s.track_name, artist: s.artist_name })}`
                        : null;
                      return (
                        <YearRow
                          key={i}
                          rank={i + 1}
                          art={{ caaId: s.caa_id, caaReleaseMbid: s.caa_release_mbid }}
                          title={s.track_name}
                          subtitle={s.artist_name}
                          plays={s.plays}
                          ms={Number(s.effective_ms)}
                          href={href}
                        />
                      );
                    })
                  )}
                </YearColumn>
                <YearColumn title="Top artists">
                  {yearArtists.length === 0 ? (
                    <Empty />
                  ) : (
                    yearArtists.map((a, i) => {
                      const href = a.artist_mbid
                        ? `/u/${encodeURIComponent(username)}/artists/${a.artist_mbid}?${new URLSearchParams({ name: a.artist_name, artist: a.artist_name })}`
                        : null;
                      return (
                        <YearRow
                          key={i}
                          rank={i + 1}
                          art={{ caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid }}
                          artShape="circle"
                          title={a.artist_name}
                          subtitle={`${a.distinct_songs.toLocaleString()} songs`}
                          plays={a.plays}
                          ms={Number(a.effective_ms)}
                          href={href}
                        />
                      );
                    })
                  )}
                </YearColumn>
                <YearColumn title="Top albums">
                  {yearAlbums.length === 0 ? (
                    <Empty />
                  ) : (
                    yearAlbums.map((a, i) => {
                      const href = a.release_mbid
                        ? `/u/${encodeURIComponent(username)}/albums/${a.release_mbid}?${new URLSearchParams({ name: a.release_name, artist: a.artist_name })}`
                        : null;
                      return (
                        <YearRow
                          key={i}
                          rank={i + 1}
                          art={{ caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid }}
                          title={a.release_name}
                          subtitle={a.artist_name}
                          plays={a.plays}
                          ms={Number(a.effective_ms)}
                          href={href}
                        />
                      );
                    })
                  )}
                </YearColumn>
              </div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Recent listens
            </h2>
            <ul className="divide-y divide-border text-sm">
              {recentRows.map((r, i) => (
                <li key={i} className="flex gap-3 py-1.5">
                  <span className="text-subtle-foreground tabular-nums w-36">{fmtDateTime(r.listened_at)}</span>
                  <span className="truncate">
                    {r.track_name}
                    <span className="text-subtle-foreground"> · {r.artist_name}</span>
                    {r.release_name && <span className="text-subtle-foreground"> · {r.release_name}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function YearColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ol className="space-y-2">{children}</ol>
    </div>
  );
}

function Empty() {
  return <li className="text-sm text-subtle-foreground italic">no plays</li>;
}

function YearRow({
  rank,
  art,
  artShape = "square",
  title,
  subtitle,
  plays,
  ms,
  href,
}: {
  rank: number;
  art: { caaId: number | null; caaReleaseMbid: string | null };
  artShape?: "square" | "circle";
  title: string;
  subtitle: string;
  plays: number;
  ms: number;
  href: string | null;
}) {
  const hours = ms / 1000 / 3600;
  const inner = (
    <>
      <span className="shrink-0 w-7 h-7 rounded bg-muted text-xs text-muted-foreground tabular-nums grid place-items-center">
        {rank}
      </span>
      <CoverArt
        art={art}
        size={44}
        alt={title}
        className={artShape === "circle" ? "rounded-full" : "rounded"}
      />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        <div className="text-xs text-subtle-foreground tabular-nums pt-0.5">
          ▶ {plays.toLocaleString()}
          {hours > 0 && <span>  ⏱ {fmtHours(hours)}</span>}
        </div>
      </div>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="flex items-center gap-3 py-1.5 hover:bg-muted -mx-2 px-2 rounded">
          {inner}
        </Link>
      ) : (
        <div className="flex items-center gap-3 py-1.5">{inner}</div>
      )}
    </li>
  );
}

function StatTile({ value, label, big = false }: { value: string; label: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-4">
      <div className={`tabular-nums font-semibold ${big ? "text-2xl" : "text-xl"}`}>{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide mt-1">{label}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
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
  if (!isFinite(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 100) {
    const hr = Math.floor(h);
    const m = Math.round((h - hr) * 60);
    return m ? `${hr}h ${m}m` : `${hr}h`;
  }
  return `${Math.round(h).toLocaleString()}h`;
}

function relTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function spanLabel(first: string, last: string): string {
  const e = new Date(first);
  const l = new Date(last);
  const months = Math.floor((l.getTime() - e.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}mo` : `${years}y`;
}
