import Link from "next/link";
import { Suspense } from "react";
import { Ticket } from "lucide-react";
import { concertsTimeline, topArtistsSeen } from "@/lib/db/queries/concerts";
import { buildTimeline } from "@/lib/concerts/timeline";
import { concertStats } from "@/lib/concerts/stats";
import { OwnerOnly } from "@/components/OwnerOnly";
import { ListSkeleton, StatRowSkeleton } from "@/components/Skeletons";
import { Timeline } from "./Timeline";
import { OwnerBar } from "./OwnerBar";
import { ConcertsEditProvider } from "./EditMode";

type Params = Promise<{ username: string }>;

export default function ConcertsPage({ params }: { params: Params }) {
  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Ticket size={18} className="text-primary" /> Concerts
        </h2>
        <Suspense fallback={<StatRowSkeleton count={5} />}>
          <Unwrap params={params} part="stats" />
        </Suspense>
      </header>
      <ConcertsEditProvider>
        <div className="space-y-8">
          <Suspense fallback={null}>
            <Unwrap params={params} part="owner" />
          </Suspense>
          <Suspense fallback={<ListSkeleton shape="circle" />}>
            <Unwrap params={params} part="list" />
          </Suspense>
        </div>
      </ConcertsEditProvider>
    </div>
  );
}

async function Unwrap({ params, part }: { params: Params; part: "stats" | "owner" | "list" }) {
  const { username } = await params;
  if (part === "stats") return <ConcertStatsRow username={username} />;
  if (part === "list") return <ConcertList username={username} />;
  return (
    <OwnerOnly username={username}>
      <OwnerBarLoader username={username} />
    </OwnerOnly>
  );
}

async function OwnerBarLoader({ username }: { username: string }) {
  const { festivals } = await concertsTimeline(username);
  return <OwnerBar username={username} festivals={festivals} />;
}

async function ConcertStatsRow({ username }: { username: string }) {
  const [{ concerts, festivals }, topSeen] = await Promise.all([
    concertsTimeline(username),
    topArtistsSeen(username).catch(() => []),
  ]);
  if (concerts.length === 0) return null;
  const stats = concertStats(concerts, festivals.length);
  const top500 = topSeen.find((t) => t.top === 500);
  return (
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
  );
}

async function ConcertList({ username }: { username: string }) {
  const { concerts, festivals, art } = await concertsTimeline(username);
  const years = buildTimeline(concerts, festivals);
  if (years.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center text-sm text-muted-foreground gap-3">
        <Ticket size={32} className="text-subtle-foreground" />
        No concerts yet.
      </div>
    );
  }
  return <Timeline username={username} years={years} festivals={festivals} art={art} />;
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
