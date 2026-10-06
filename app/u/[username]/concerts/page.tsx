import Link from "next/link";
import { Ticket } from "lucide-react";
import { concertsTimeline, topArtistsSeen } from "@/lib/db/queries/concerts";
import { buildTimeline } from "@/lib/concerts/timeline";
import { concertStats } from "@/lib/concerts/stats";
import { getSession } from "@/lib/auth/session";
import { Timeline } from "./Timeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConcertsPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [{ concerts, festivals, art }, topSeen, session] = await Promise.all([
    concertsTimeline(username),
    topArtistsSeen(username).catch(() => []),
    getSession(),
  ]);
  const isOwner = session?.lbUsername === username;
  const years = buildTimeline(concerts, festivals);
  const stats = concertStats(concerts, festivals.length);
  const top500 = topSeen.find((t) => t.top === 500);

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Ticket size={18} className="text-primary" /> Concerts
        </h2>
        {concerts.length > 0 && (
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 text-sm md:flex md:flex-wrap md:gap-x-8 md:gap-y-2">
            <Stat label="Shows" value={stats.shows.toLocaleString()} />
            <Stat label="Artists" value={stats.artists.toLocaleString()} />
            <Stat label="Festivals" value={stats.festivals.toLocaleString()} />
            {top500 && <Stat label="Of top 500" value={top500.seen.toLocaleString()} />}
            {stats.mostSeen && (
              <Stat
                className="col-span-2"
                label={`Seen most · ${stats.mostSeen.count}×`}
                value={stats.mostSeen.name}
                href={stats.mostSeen.mbid ? `/u/${encodeURIComponent(username)}/artists/${stats.mostSeen.mbid}` : null}
              />
            )}
          </div>
        )}
      </header>
      {years.length === 0 && !isOwner ? (
        <div className="py-16 flex flex-col items-center text-sm text-muted-foreground gap-3">
          <Ticket size={32} className="text-subtle-foreground" />
          No concerts yet.
        </div>
      ) : (
        <Timeline username={username} years={years} festivals={festivals} art={art} isOwner={isOwner} />
      )}
    </div>
  );
}

function Stat({ label, value, href, className = "" }: {
  label: string; value: string; href?: string | null; className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      {href ? (
        <Link href={href} className="block truncate text-base font-semibold text-foreground hover:underline">{value}</Link>
      ) : (
        <div className="truncate text-base font-semibold text-foreground tabular-nums">{value}</div>
      )}
      <div className="text-xs text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
