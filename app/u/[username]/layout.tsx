import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PillNav } from "./PillNav";
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
          <div className="md:justify-self-center">
            <PillNav username={username} showAccount={isOwner} />
          </div>
          <div className="min-w-0 md:justify-self-end">
            <NowPlaying username={username} />
          </div>
        </div>
      </header>
      <div className="max-w-7xl mx-auto px-6 py-6">{children}</div>
    </div>
  );
}
