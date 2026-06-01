import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PillNav } from "./PillNav";
import { NowPlaying } from "./NowPlaying";

export default async function UserLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-background/70 border-b border-border/60">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <ChevronLeft size={16} />
            <span className="font-semibold text-foreground">pulse</span>
            <span className="text-subtle-foreground mx-0.5">/</span>
            <span>{username}</span>
          </Link>
          <PillNav username={username} />
          <NowPlaying username={username} />
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-6">{children}</div>
    </div>
  );
}
