"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { isTabActive, navTabs } from "@/lib/nav";
import { SearchDock } from "@/components/SearchDock";

/**
 * Phone tab bar — fixed to the bottom, translucent over whatever scrolls
 * beneath it.
 *
 * This is as close to an iOS tab bar as a web page gets: backdrop-filter is
 * real blur, but Liquid Glass's refraction and specular edge are system
 * materials Safari doesn't expose. What sells it is the rest of the
 * convention — bottom placement, safe-area inset, icon over label, a ~49pt
 * row, and a tinted capsule behind the active icon.
 *
 * Search swaps the tabs for the field, the way iOS hands the bar over to a
 * search field rather than stacking one above the other.
 *
 * Below md only; wider screens use <PillNav> in the header.
 */
export function TabBar({ username, showAccount }: { username: string; showAccount?: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [searching, setSearching] = useState(false);
  const tabs = navTabs(username, showAccount);
  // A filter survives closing the field, so keep the button lit while one is on
  // — otherwise a filtered list has nothing on screen explaining itself.
  const filtered = !!params.get("q");

  return (
    <nav
      aria-label="Sections"
      className="
        md:hidden fixed inset-x-0 bottom-0 z-40
        border-t border-white/10
        bg-background/90 supports-[backdrop-filter]:bg-background/60
        backdrop-blur-2xl backdrop-saturate-150
        pb-[env(safe-area-inset-bottom)]
        shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]
      "
    >
      {searching ? (
        <SearchDock username={username} onClose={() => setSearching(false)} />
      ) : (
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
        >
          {tabs.map(({ href, label, Icon }) => {
            const active = isTabActive(href, pathname);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="flex min-h-[49px] flex-col items-center justify-center gap-0.5 py-1.5 transition active:scale-95"
                >
                  <span
                    className={`flex h-7 w-14 items-center justify-center rounded-full transition ${
                      active ? "bg-primary/15 text-primary" : "text-muted-foreground"
                    }`}
                  >
                    <Icon size={20} strokeWidth={active ? 2.4 : 1.9} />
                  </span>
                  <span
                    className={`text-[10px] font-medium tracking-tight ${
                      active ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setSearching(true)}
              aria-expanded={false}
              className="w-full flex min-h-[49px] flex-col items-center justify-center gap-0.5 py-1.5 transition active:scale-95"
            >
              <span
                className={`flex h-7 w-14 items-center justify-center rounded-full transition ${
                  filtered ? "bg-primary/15 text-primary" : "text-muted-foreground"
                }`}
              >
                <Search size={20} strokeWidth={filtered ? 2.4 : 1.9} />
              </span>
              <span
                className={`text-[10px] font-medium tracking-tight ${
                  filtered ? "text-primary" : "text-muted-foreground"
                }`}
              >
                Search
              </span>
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}
