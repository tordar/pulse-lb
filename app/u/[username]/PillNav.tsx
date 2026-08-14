"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isTabActive, navTabs } from "@/lib/nav";

/**
 * Desktop section nav — the centred pill in the header. Phones get <TabBar>
 * fixed to the bottom instead, so this hides below md.
 */
export function PillNav({ username, showAccount }: { username: string; showAccount?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="hidden md:inline-flex items-center bg-card border border-card-border rounded-full p-1 shadow-sm"
    >
      {navTabs(username, showAccount).map(({ href, label, Icon }) => {
        const active = isTabActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
              active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"
            }`}
          >
            <Icon size={15} strokeWidth={2} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
