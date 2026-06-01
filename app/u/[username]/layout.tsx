import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PillNav } from "./PillNav";

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
      <header className="px-6 pt-6 pb-2">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
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
          <div className="hidden md:block w-[1px]" aria-hidden />
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-6">{children}</div>
    </div>
  );
}
