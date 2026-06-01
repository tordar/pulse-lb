"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "stats", label: "Stats" },
  { slug: "songs", label: "Songs" },
  { slug: "albums", label: "Albums" },
  { slug: "artists", label: "Artists" },
] as const;

export function PillNav({ username }: { username: string }) {
  const pathname = usePathname();
  const base = `/u/${encodeURIComponent(username)}`;

  return (
    <nav className="inline-flex items-center bg-card border border-card-border rounded-full p-1 shadow-sm">
      {TABS.map((t) => {
        const href = `${base}/${t.slug}`;
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={t.slug}
            href={href}
            className={`px-5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:bg-muted"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
