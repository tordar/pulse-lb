import Link from "next/link";
import { Suspense } from "react";
import { Repeat, Tent, Ticket, Trophy, Users } from "lucide-react";
import { concertsTimeline, topArtistsSeen } from "@/lib/db/queries/concerts";
import { buildTimeline } from "@/lib/concerts/timeline";
import { concertStats } from "@/lib/concerts/stats";
import { OwnerOnly } from "@/components/OwnerOnly";
import { ListSkeleton, StatTilesSkeleton } from "@/components/Skeletons";
import { StatTile } from "@/components/StatTile";
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
        <Suspense fallback={<StatTilesSkeleton />}>
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
    <section className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
      <StatTile icon={Ticket} value={stats.shows.toLocaleString()} label="shows" />
      <StatTile icon={Users} value={stats.artists.toLocaleString()} label="artists" />
      <StatTile icon={Tent} value={stats.festivals.toLocaleString()} label="festivals" />
      {top500 && <StatTile icon={Trophy} value={top500.seen.toLocaleString()} label="of top 500" />}
      {stats.mostSeen && (
        <StatTile
          className="col-span-2"
          icon={Repeat}
          value={
            stats.mostSeen.mbid ? (
              <Link href={`/u/${encodeURIComponent(username)}/artists/${stats.mostSeen.mbid}`} className="hover:underline">
                {stats.mostSeen.name}
              </Link>
            ) : (
              stats.mostSeen.name
            )
          }
          label={`seen most · ${stats.mostSeen.count}×`}
        />
      )}
    </section>
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
