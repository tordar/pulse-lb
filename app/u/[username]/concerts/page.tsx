import Link from "next/link";
import { Ticket } from "lucide-react";
import { concertsTimeline } from "@/lib/db/queries/concerts";
import { buildTimeline } from "@/lib/concerts/timeline";
import { concertStats } from "@/lib/concerts/stats";
import { getSession } from "@/lib/auth/session";
import { Timeline } from "./Timeline";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConcertsPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const [{ concerts, festivals, art }, session] = await Promise.all([concertsTimeline(username), getSession()]);
  const isOwner = session?.lbUsername === username;
  const years = buildTimeline(concerts, festivals);
  const stats = concertStats(concerts, festivals.length);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Ticket size={18} className="text-primary" /> Concerts
        </h2>
        {concerts.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
            <Stat label="Shows" value={stats.shows.toLocaleString()} />
            <Stat label="Artists" value={stats.artists.toLocaleString()} />
            <Stat label="Festivals" value={stats.festivals.toLocaleString()} />
            {stats.mostSeen && (
              <Stat
                label={`Most seen · ${stats.mostSeen.count}×`}
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

function Stat({ label, value, href }: { label: string; value: string; href?: string | null }) {
  return (
    <div className="min-w-0">
      {href ? (
        <Link href={href} className="block truncate text-base font-semibold hover:underline">{value}</Link>
      ) : (
        <div className="truncate text-base font-semibold tabular-nums">{value}</div>
      )}
      <div className="text-xs text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}
