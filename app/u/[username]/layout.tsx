import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PillNav } from "./PillNav";
import { TabBar } from "@/components/TabBar";
import { AccountLink } from "@/components/AccountLink";
import { NowPlaying } from "./NowPlaying";
import { getSession } from "@/lib/auth/session";

export default async function UserLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const session = await getSession();
  const isOwner = session?.lbUsername === username;

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
            <span>{username}</span>
          </Link>
          <div className="hidden md:block md:justify-self-center">
            <PillNav username={username} showAccount={isOwner} />
          </div>
          <div className="min-w-0 md:justify-self-end flex items-center gap-2">
            <NowPlaying username={username} />
            {isOwner && <AccountLink />}
          </div>
        </div>
      </header>
      {/* Bottom padding clears the fixed phone tab bar (49pt row + the home
          indicator) so the last row is never trapped under it. */}
      <div className="max-w-7xl mx-auto px-6 py-6 pb-[calc(env(safe-area-inset-bottom)+5rem)] md:pb-6">
        {children}
      </div>
      <TabBar username={username} />
    </div>
  );
}
