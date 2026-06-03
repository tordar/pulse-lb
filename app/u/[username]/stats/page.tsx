import Link from "next/link";
import { BarChart3, Calendar, Clock, Disc3, Music2, Play, TrendingUp, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import {
  allTimeStats,
  todayStats,
  yearlyListening,
  hourlyDistribution,
  dailyListeningByYear,
  dayDetail,
  availableYears,
  topSongsByYear,
  topAlbumsByYear,
  topArtistsByYear,
} from "@/lib/db/queries/stats";
import { SyncButton } from "./SyncButton";
import { YearNav } from "./YearNav";
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
  searchParams: Promise<{ year?: string; day?: string }>;
}) {
  const { username } = await params;
  const sp = await searchParams;

  // Year-independent queries run in parallel. Cached ones (allTime, yearly,
  // hourly, availableYears) hit the per-user tag cache; uncached ones (state,
  // todayStats, recent listens) hit the DB but in parallel rather than serial.
  const [state, allTime, today, yearly, hourly, recent, years] = await Promise.all([
    withRetry(() =>
      db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) }),
    ),
    allTimeStats(username),
    todayStats(username),
    yearlyListening(username),
    hourlyDistribution(username),
    withRetry(() =>
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
    ),
    availableYears(username),
  ]);
  const recentRows = (recent as unknown as { rows: { listened_at: string; track_name: string; artist_name: string; release_name: string | null }[] }).rows;

  const empty = allTime.total_plays === 0;
  const selectedYear = years.length
    ? Math.max(years[years.length - 1], Math.min(years[0], parseInt(sp.year ?? "", 10) || years[0]))
    : null;

  // Prev/next neighbours for the year nav (years[] is descending).
  const yearIdx = selectedYear !== null ? years.indexOf(selectedYear) : -1;
  const nextYear = yearIdx > 0 ? years[yearIdx - 1] : null;
  const prevYear = yearIdx >= 0 && yearIdx < years.length - 1 ? years[yearIdx + 1] : null;

  const [daily, yearSongs, yearAlbums, yearArtists, daySummary] = selectedYear
    ? await Promise.all([
        dailyListeningByYear(username, selectedYear),
        topSongsByYear(username, selectedYear),
        topAlbumsByYear(username, selectedYear),
        topArtistsByYear(username, selectedYear),
        sp.day ? dayDetail(username, sp.day) : Promise.resolve(null),
      ])
    : [[], [], [], [], null];

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {state?.lastSyncedAt
            ? <>Last synced {relTime(state.lastSyncedAt)}</>
            : <>Not synced yet</>}
        </p>
        <SyncButton username={username} />
      </header>

      {empty ? (
        <div className="py-24 flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <Play size={36} className="text-subtle-foreground" />
          No listens yet. Click sync to backfill.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile icon={Play} big value={allTime.total_plays.toLocaleString()} label="plays" />
            <StatTile icon={Clock} big value={fmtHours(allTime.effective_ms / 1000 / 3600)} label="listening time" />
            <StatTile icon={Users} value={allTime.distinct_artists.toLocaleString()} label="artists" />
            <StatTile icon={Disc3} value={allTime.distinct_albums.toLocaleString()} label="albums" />
            <StatTile icon={Music2} value={allTime.distinct_songs.toLocaleString()} label="songs" />
            <StatTile
              icon={Calendar}
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

          {selectedYear !== null && years.length > 0 && (
            <section className="rounded-lg border border-card-border bg-card">
              <div className="p-5 pb-0 space-y-4">
                <h2 className="text-lg font-semibold">Top Songs, Artists &amp; Albums by Year</h2>
                <YearTabs years={years} active={selectedYear} />
              </div>
              <div
                key={selectedYear}
                className="p-5 grid gap-8 md:grid-cols-2 lg:grid-cols-3 fade-in"
              >
                <YearColumn title="Top Songs" icon={Music2}>
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
                <YearColumn title="Top Artists" icon={Users}>
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
                <YearColumn title="Top Albums" icon={Disc3}>
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
            <SectionHeading icon={TrendingUp}>Listening by year</SectionHeading>
            <YearlyChart data={yearly} height={260} />
          </section>

          <section className="space-y-3">
            <SectionHeading icon={Clock} extra="(hour of day, all-time)">When you listen</SectionHeading>
            <HourlyChart data={hourly} height={200} />
          </section>

          {selectedYear !== null && (
            <section className="rounded-lg border border-card-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <SectionHeading icon={Calendar}>{selectedYear}</SectionHeading>
                <YearNav year={selectedYear} prevYear={prevYear} nextYear={nextYear} />
              </div>
              <Heatmap
                days={daily}
                activeDate={sp.day ?? null}
                hrefFor={(date) => {
                  const next = new URLSearchParams({ year: String(selectedYear) });
                  next.set("day", date);
                  return `?${next}`;
                }}
              />
              {daySummary && <DayDetailBlock username={username} day={daySummary} year={selectedYear} />}
            </section>
          )}

          <section className="space-y-3">
            <SectionHeading icon={Clock}>Recent listens</SectionHeading>
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

function DayDetailBlock({
  username,
  day,
  year,
}: {
  username: string;
  day: import("@/lib/db/queries/stats").DaySummary;
  year: number;
}) {
  const date = new Date(`${day.date}T00:00:00Z`);
  const human = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const hours = day.effective_ms / 1000 / 3600;
  const closeHref = `?${new URLSearchParams({ year: String(year) })}`;

  return (
    <div key={day.date} className="fade-in mt-2 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wide text-primary inline-flex items-center gap-1.5">
            <Calendar size={13} /> {human}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            <strong className="text-foreground font-medium tabular-nums">{day.plays.toLocaleString()}</strong> plays
            {hours >= 1 / 60 && (
              <>
                {" · "}
                <strong className="text-foreground font-medium tabular-nums">{fmtHours(hours)}</strong> listening
              </>
            )}
            {" · "}
            <strong className="text-foreground font-medium tabular-nums">{day.distinct_tracks}</strong> distinct songs
            {" · "}
            <strong className="text-foreground font-medium tabular-nums">{day.distinct_artists}</strong> artists
          </p>
        </div>
        <Link
          href={closeHref}
          scroll={false}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          aria-label="Close day detail"
        >
          ✕ Close
        </Link>
      </div>

      {day.listens.length === 0 ? (
        <p className="text-sm text-subtle-foreground italic">No listens this day.</p>
      ) : (
        <ul className="divide-y divide-border text-sm max-h-[420px] overflow-y-auto pr-1">
          {day.listens.map((l, i) => {
            const time = new Date(l.listened_at).toISOString().slice(11, 16);
            const href = l.recording_mbid
              ? `/u/${encodeURIComponent(username)}/songs/${l.recording_mbid}?${new URLSearchParams({ name: l.track_name, artist: l.artist_name })}`
              : null;
            const row = (
              <>
                <span className="w-12 shrink-0 tabular-nums text-subtle-foreground">{time}</span>
                <span className="flex-1 min-w-0 truncate">
                  {l.track_name}
                  <span className="text-subtle-foreground"> · {l.artist_name}</span>
                  {l.release_name && <span className="text-subtle-foreground"> · {l.release_name}</span>}
                </span>
              </>
            );
            return (
              <li key={i}>
                {href ? (
                  <Link
                    href={href}
                    className="flex items-center gap-3 py-1.5 hover:bg-muted -mx-2 px-2 rounded"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 py-1.5">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function YearColumn({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-5 h-5 text-muted-foreground" />
        <h3 className="font-semibold text-lg">{title}</h3>
      </div>
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
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-8 h-8 rounded-md bg-muted text-xs font-medium text-muted-foreground tabular-nums grid place-items-center mt-0.5">
        {rank}
      </span>
      <CoverArt
        art={art}
        size={64}
        alt={title}
        className={`mt-0.5 ${artShape === "circle" ? "rounded-full" : "rounded-md"}`}
      />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm break-words">{title}</p>
        <p className="text-xs text-muted-foreground break-words mb-2">{subtitle}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          <div className="flex items-center gap-1">
            <Play className="w-3 h-3" />
            <span>{plays.toLocaleString()}</span>
          </div>
          {hours > 0 && (
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{fmtHours(hours)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block p-2 rounded-md hover:bg-muted/50 transition-colors">
          {inner}
        </Link>
      ) : (
        <div className="p-2 rounded-md">{inner}</div>
      )}
    </li>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
  big = false,
}: {
  icon?: LucideIcon;
  value: string;
  label: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-4 space-y-2">
      {Icon && <Icon size={16} className="text-primary" />}
      <div className={`tabular-nums font-semibold ${big ? "text-2xl" : "text-xl"}`}>{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}

function SectionHeading({ icon: Icon, children, extra }: { icon: LucideIcon; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-2">
      <Icon size={15} className="text-primary" />
      <span>{children}</span>
      {extra && <span className="text-subtle-foreground font-normal normal-case">{extra}</span>}
    </h2>
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
