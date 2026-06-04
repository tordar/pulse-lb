"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Music2, Disc3, Users, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const TABS: { slug: string; label: string; Icon: LucideIcon }[] = [
  { slug: "stats", label: "Stats", Icon: BarChart3 },
  { slug: "songs", label: "Songs", Icon: Music2 },
  { slug: "albums", label: "Albums", Icon: Disc3 },
  { slug: "artists", label: "Artists", Icon: Users },
];

export function PillNav({ username, showAccount }: { username: string; showAccount?: boolean }) {
  const pathname = usePathname();
  const base = `/u/${encodeURIComponent(username)}`;

  return (
    <nav className="inline-flex items-center bg-card border border-card-border rounded-full p-1 shadow-sm">
      {TABS.map(({ slug, label, Icon }) => {
        const href = `${base}/${slug}`;
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={slug}
            href={href}
            aria-label={label}
            className={`inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:bg-muted"
            }`}
          >
            <Icon size={15} strokeWidth={2} />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
      {showAccount && (
        <Link
          href="/account"
          aria-label="Account settings"
          title="Account settings"
          className={`inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
            pathname?.startsWith("/account")
              ? "bg-primary text-primary-foreground"
              : "text-foreground/80 hover:bg-muted"
          }`}
        >
          <Settings size={15} strokeWidth={2} />
          <span className="hidden sm:inline">Account</span>
        </Link>
      )}
    </nav>
  );
}
