import Link from "next/link";
import { Suspense } from "react";
import { BarChart3, Calendar, Clock, Disc3, Music2, Play, TrendingUp, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { eq, sql } from "drizzle-orm";
import { db, schema, execute } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { fmtHours } from "@/lib/format";
import {
  allTimeStats,
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
import { GlobalSearch } from "./GlobalSearch";
import { DayTimeline } from "./DayTimeline";
import { getSession } from "@/lib/auth/session";
import { getShowListenSource } from "@/lib/auth/users";
import { SourceDot } from "@/components/SourceDot";
import { SignInButton } from "@/components/SignInButton";
import { YearlyChart } from "@/components/YearlyChart";
import { HourlyChart } from "@/components/HourlyChart";
import { YearActivity } from "@/components/YearActivity";
import { YearTabs } from "@/components/YearTabs";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { TopList, type TopListItem } from "@/components/TopList";
import { ListSkeleton, PageSkeleton, Sk } from "@/components/Skeletons";
import { songKey, artistKey, albumKey } from "@/lib/sync/keys";

type Params = Promise<{ username: string }>;
type SP = Promise<{ year?: string; day?: string }>;

export default function StatsPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  return (
    <div className="space-y-8">
      <Suspense fallback={<Sk className="h-5 w-40" />}>
        <StatsHeader params={params} />
      </Suspense>
      <Suspense fallback={<PageSkeleton />}>
        <StatsBody params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// Live, per request: sync state, and who is looking (owner gets SyncButton).
async function StatsHeader({ params }: { params: Params }) {
  const { username } = await params;
  const [session, state, allTime] = await Promise.all([
    getSession(),
    withRetry(() => db.query.syncState.findFirst({ where: eq(schema.syncState.userName, username) })),
    allTimeStats(username),
  ]);
  const isOwner = session?.lbUsername === username;
  const empty = allTime.total_plays === 0;
  return (
    <header className="space-y-3">
      {/* Sync info and search share one row on large screens; flex-wrap
          drops the full-width search onto its own line below lg. For owners
          SyncButton owns the whole block so its progress bar and insert
          stream span the full width. */}
      {isOwner ? (
        <SyncButton
          username={username}
          lastSynced={
            <p className="text-sm text-muted-foreground shrink-0">
              {state?.lastSyncedAt
                ? <>Last synced {relTime(state.lastSyncedAt)}</>
                : <>Not synced yet</>}
            </p>
          }
          search={!empty ? <GlobalSearch username={username} /> : null}
        />
      ) : (
        <div className="flex items-baseline gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground flex-1 shrink-0">
            {state?.lastSyncedAt
              ? <>Last synced {relTime(state.lastSyncedAt)}</>
              : <>Not synced yet</>}
          </p>
          {!empty && <GlobalSearch username={username} />}
        </div>
      )}
      {isOwner ? null : session ? (
        <p className="text-sm text-muted-foreground">
          Viewing @{username}&apos;s profile. <Link href={`/u/${session.lbUsername}/stats`} className="underline">Your dashboard</Link>.
        </p>
      ) : (
        <SignInButton returnTo={`/u/${username}/stats`} label="Sign in to sync your own listens" />
      )}
    </header>
  );
}

async function StatsBody({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ username }, sp] = await Promise.all([params, searchParams]);
  // Profile owner's display preference (not the viewer's) — defaults off.
  const showSource = await getShowListenSource(username).catch(() => false);
  const yearParam = parseInt(sp.year ?? "", 10) || null;
  return (
    <StatsPanels
      username={username}
      yearParam={yearParam}
      day={sp.day ?? null}
      dayDetail={
        sp.day ? (
          <Suspense fallback={null}>
            <DayDetailLoader username={username} day={sp.day} yearParam={yearParam} showSource={showSource} />
          </Suspense>
        ) : null
      }
      recent={
        <Suspense fallback={<ListSkeleton rows={10} />}>
          <RecentListens username={username} showSource={showSource} />
        </Suspense>
      }
    />
  );
}

// The aggregate panels. Every query here goes through the per-user tag cache.
async function StatsPanels({
  username, yearParam, day, dayDetail, recent,
}: {
  username: string;
  yearParam: number | null;
  day: string | null;
  dayDetail: React.ReactNode;
  recent: React.ReactNode;
}) {
  const [allTime, yearly, hourly, years] = await Promise.all([
    allTimeStats(username),
    yearlyListening(username),
    hourlyDistribution(username),
    availableYears(username),
  ]);
  const empty = allTime.total_plays === 0;
  const selectedYear = years.length
    ? Math.max(years[years.length - 1], Math.min(years[0], yearParam ?? years[0]))
    : null;

  // Prev/next neighbours for the year nav (years[] is descending).
  const yearIdx = selectedYear !== null ? years.indexOf(selectedYear) : -1;
  const nextYear = yearIdx > 0 ? years[yearIdx - 1] : null;
  const prevYear = yearIdx >= 0 && yearIdx < years.length - 1 ? years[yearIdx + 1] : null;

  const [daily, yearSongs, yearAlbums, yearArtists] = selectedYear
    ? await Promise.all([
        dailyListeningByYear(username, selectedYear),
        topSongsByYear(username, selectedYear),
        topAlbumsByYear(username, selectedYear),
        topArtistsByYear(username, selectedYear),
      ])
    : [[], [], [], []];

  const qs = (name: string, artist: string) =>
    new URLSearchParams({ name, artist }).toString();
  const u = encodeURIComponent(username);

  // matchKey buckets each row the same way the aggregate tables do, so listens
  // arriving mid-sync can be added to the right row client-side.
  const songItems: TopListItem[] = yearSongs.map((s) => ({
    key: s.recording_mbid ?? `${s.track_name}|${s.artist_name}`,
    matchKey: songKey(s.recording_mbid, s.track_name, s.artist_name),
    title: s.track_name,
    subtitle: s.artist_name,
    plays: s.plays,
    effectiveMs: Number(s.effective_ms),
    caaId: s.caa_id,
    caaReleaseMbid: s.caa_release_mbid,
    href: s.recording_mbid
      ? `/u/${u}/songs/${s.recording_mbid}?${qs(s.track_name, s.artist_name)}`
      : null,
  }));

  const artistItems: TopListItem[] = yearArtists.map((a) => ({
    key: a.artist_mbid ?? a.artist_name,
    matchKey: artistKey(a.artist_name),
    title: a.artist_name,
    subtitle: `${a.distinct_songs.toLocaleString()} songs`,
    plays: a.plays,
    effectiveMs: Number(a.effective_ms),
    caaId: a.caa_id,
    caaReleaseMbid: a.caa_release_mbid,
    href: a.artist_mbid
      ? `/u/${u}/artists/${a.artist_mbid}?${qs(a.artist_name, a.artist_name)}`
      : null,
  }));

  const albumItems: TopListItem[] = yearAlbums.map((a) => ({
    key: a.release_mbid ?? `${a.release_name}|${a.artist_name}`,
    matchKey: albumKey(a.release_name, a.artist_name),
    title: a.release_name,
    subtitle: a.artist_name,
    plays: a.plays,
    effectiveMs: Number(a.effective_ms),
    caaId: a.caa_id,
    caaReleaseMbid: a.caa_release_mbid,
    href: a.release_mbid
      ? `/u/${u}/albums/${a.release_mbid}?${qs(a.release_name, a.artist_name)}`
      : null,
  }));

  return (
    <>
      {empty ? (
        <div className="py-24 flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <Play size={36} className="text-subtle-foreground" />
          No listens yet. Click sync to backfill.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatTile icon={Play} big value={<AnimatedNumber value={allTime.total_plays} live="plays" />} label="plays" />
            <StatTile
              icon={Clock}
              big
              value={
                <AnimatedNumber
                  value={Number(allTime.effective_ms)}
                  format="durationMs"
                  live="durationMs"
                />
              }
              label="listening time"
            />
            <StatTile icon={Users} value={<AnimatedNumber value={allTime.distinct_artists} />} label="artists" />
            <StatTile icon={Disc3} value={<AnimatedNumber value={allTime.distinct_albums} />} label="albums" />
            <StatTile icon={Music2} value={<AnimatedNumber value={allTime.distinct_songs} />} label="songs" />
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
                  <TopList kind="song" items={songItems} />
                </YearColumn>
                <YearColumn title="Top Artists" icon={Users}>
                  <TopList kind="artist" items={artistItems} artShape="circle" />
                </YearColumn>
                <YearColumn title="Top Albums" icon={Disc3}>
                  <TopList kind="album" items={albumItems} />
                </YearColumn>
              </div>
            </section>
          )}

          <section className="space-y-3">
            <SectionHeading icon={TrendingUp} extra="(hours listened)">Listening by year</SectionHeading>
            <YearlyChart data={yearly} height={260} />
          </section>

          <section className="space-y-3">
            <SectionHeading icon={Clock} extra="(hour of day, all-time)">When you listen</SectionHeading>
            <HourlyChart data={hourly} height={200} />
          </section>

          {selectedYear !== null && (
            <section className="rounded-lg border border-card-border bg-card p-5 space-y-4">
              <YearActivity
                days={daily}
                year={selectedYear}
                activeDate={day}
                heading={<SectionHeading icon={Calendar}>{selectedYear}</SectionHeading>}
                nav={<YearNav year={selectedYear} prevYear={prevYear} nextYear={nextYear} />}
              />
              {dayDetail}
            </section>
          )}

          {recent}
        </>
      )}
    </>
  );
}

async function DayDetailLoader({
  username, day, yearParam, showSource,
}: { username: string; day: string; yearParam: number | null; showSource: boolean }) {
  const summary = await dayDetail(username, day);
  if (!summary) return null;
  return <DayDetailBlock username={username} day={summary} year={yearParam ?? Number(day.slice(0, 4))} showSource={showSource} />;
}

async function RecentListens({ username, showSource }: { username: string; showSource: boolean }) {
  const recent = await withRetry(() =>
    execute<{ listened_at: string; track_name: string; artist_name: string; release_name: string | null; source: string | null }>(sql`
      SELECT listened_at, track_name, artist_name, release_name, source
      FROM ${schema.listens}
      WHERE user_name = ${username}
      ORDER BY listened_at DESC LIMIT 10
    `),
  );
  const rows = (recent as unknown as { rows: { listened_at: string; track_name: string; artist_name: string; release_name: string | null; source: string | null }[] }).rows;
  return (
    <section className="space-y-3">
      <SectionHeading icon={Clock}>Recent listens</SectionHeading>
      <ul className="divide-y divide-border text-sm">
        {rows.map((r, i) => {
          const { date, time } = splitDateTime(r.listened_at);
          return (
            <li key={i} className="flex gap-3 py-2 items-baseline">
              <span className="text-subtle-foreground tabular-nums shrink-0 text-xs leading-tight whitespace-nowrap">
                <span className="block">{date}</span>
                <span className="block">{time}</span>
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-foreground">{r.track_name}</span>
                <span className="text-subtle-foreground"> · {r.artist_name}</span>
                {r.release_name && <span className="text-subtle-foreground"> · {r.release_name}</span>}
              </span>
              {showSource && <SourceDot source={r.source} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}


function DayDetailBlock({
  username,
  day,
  year,
  showSource,
}: {
  username: string;
  day: import("@/lib/db/queries/stats").DaySummary;
  year: number;
  showSource: boolean;
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
        <>
        <DayTimeline listens={day.listens} />
        <ul className="divide-y divide-border text-sm max-h-[420px] overflow-y-auto overflow-x-hidden pr-1">
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
                {showSource && <SourceDot source={l.source} />}
              </>
            );
            return (
              <li key={i}>
                {href ? (
                  <Link
                    href={href}
                    className="flex items-center gap-3 py-1.5 hover:bg-muted active:bg-muted transition-colors -mx-2 px-2 rounded"
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
        </>
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
      {children}
    </div>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
  big = false,
}: {
  icon?: LucideIcon;
  // A node, not a string: the numeric tiles pass <AnimatedNumber>, which counts
  // from the old figure to the new one when a sync lands fresh aggregates.
  value: React.ReactNode;
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

function fmtDate(s: string): string {
  return new Date(s).toISOString().slice(0, 10);
}

function splitDateTime(s: string): { date: string; time: string } {
  const iso = new Date(s).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
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
