import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PillNav } from "../u/[username]/PillNav";
import { NowPlaying } from "../u/[username]/NowPlaying";
import { getSession } from "@/lib/auth/session";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect(`/auth/login?return=${encodeURIComponent("/account")}`);
  }
  const username = session.lbUsername;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-background/70 border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4 flex-wrap">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          >
            <ChevronLeft size={16} />
            <span className="font-semibold text-foreground">pulse</span>
            <span className="text-subtle-foreground mx-0.5">/</span>
            <span>{username}</span>
          </Link>
          <PillNav username={username} showAccount />
          <NowPlaying username={username} />
        </div>
      </header>
      {children}
    </div>
  );
}
