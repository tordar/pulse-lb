import Link from "next/link";
import { Suspense } from "react";
import { ChevronLeft } from "lucide-react";
import { AccountPill, PillNav } from "./PillNav";
import { TabBar } from "@/components/TabBar";
import { AccountLink } from "@/components/AccountLink";
import { NowPlaying } from "./NowPlaying";
import { OwnerOnly } from "@/components/OwnerOnly";
import { Sk } from "@/components/Skeletons";
import { allTimeStats } from "@/lib/db/queries/stats";

type Params = Promise<{ username: string }>;

// No cookie read up here: everything public renders without waiting on the
// session. The username is URL data, so each piece that needs it awaits
// params inside its own Suspense — the header frame is part of the shared
// App Shell and paints instantly.
export default function UserLayout({ children, params }: { children: React.ReactNode; params: Params }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-background/70 border-b border-border/60">
        {/* 3-column grid on md+ (1fr auto 1fr) keeps the pills dead-centre
            regardless of how wide the breadcrumb or now-playing pill is. */}
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap md:grid md:grid-cols-[1fr_auto_1fr]">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 md:justify-self-start"
          >
            <ChevronLeft size={16} />
            <span className="font-semibold text-foreground">pulse</span>
            <span className="text-subtle-foreground mx-0.5">/</span>
            <Suspense fallback={<Sk className="h-4 w-16" />}>
              <Username params={params} />
            </Suspense>
          </Link>
          <div className="hidden md:block md:justify-self-center">
            <Suspense fallback={<Sk className="h-[42px] w-[520px] rounded-full" />}>
              <HeaderNav params={params} />
            </Suspense>
          </div>
          <div className="min-w-0 md:justify-self-end flex items-center gap-2">
            <Suspense fallback={null}>
              <HeaderRight params={params} />
            </Suspense>
          </div>
        </div>
      </header>
      {/* Bottom padding clears the fixed phone tab bar (49pt row + the home
          indicator) so the last row is never trapped under it. */}
      <div className="max-w-7xl mx-auto px-6 py-6 pb-[calc(env(safe-area-inset-bottom)+5rem)] md:pb-6">
        {children}
      </div>
      <Suspense fallback={null}>
        <BottomTabs params={params} />
      </Suspense>
    </div>
  );
}

async function Username({ params }: { params: Params }) {
  const { username } = await params;
  return <span>{username}</span>;
}

async function HeaderNav({ params }: { params: Params }) {
  const { username } = await params;
  return (
    <PillNav username={username}>
      <Suspense fallback={null}>
        <OwnerOnly username={username}>
          <AccountPill />
        </OwnerOnly>
      </Suspense>
    </PillNav>
  );
}

async function HeaderRight({ params }: { params: Params }) {
  const { username } = await params;
  // Same cached row the stats tiles render from, so the poller starts exactly
  // where the numbers on screen stop.
  const { last_played } = await allTimeStats(username);
  const cursor = last_played ? Math.floor(new Date(last_played).getTime() / 1000) : null;
  return (
    <>
      <NowPlaying username={username} cursor={cursor} />
      <Suspense fallback={null}>
        <OwnerOnly username={username}>
          <AccountLink />
        </OwnerOnly>
      </Suspense>
    </>
  );
}

async function BottomTabs({ params }: { params: Params }) {
  const { username } = await params;
  return <TabBar username={username} />;
}
