"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "stats", label: "Stats" },
  { slug: "songs", label: "Songs" },
  { slug: "albums", label: "Albums" },
  { slug: "artists", label: "Artists" },
] as const;

export function UserNav({ username }: { username: string }) {
  const pathname = usePathname();
  const base = `/u/${encodeURIComponent(username)}`;

  return (
    <nav className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800">
      {TABS.map((t) => {
        const href = `${base}/${t.slug}`;
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <Link
            key={t.slug}
            href={href}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              active
                ? "border-black dark:border-white font-medium"
                : "border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
