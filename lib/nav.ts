import { BarChart3, Music2, Disc3, Users, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavTab = { href: string; label: string; Icon: LucideIcon };

/**
 * The sections, in order. Shared so the desktop pill nav and the phone tab bar
 * can never drift apart.
 */
export function navTabs(username: string, showAccount?: boolean): NavTab[] {
  const base = `/u/${encodeURIComponent(username)}`;
  const tabs: NavTab[] = [
    { href: `${base}/stats`, label: "Stats", Icon: BarChart3 },
    { href: `${base}/songs`, label: "Songs", Icon: Music2 },
    { href: `${base}/albums`, label: "Albums", Icon: Disc3 },
    { href: `${base}/artists`, label: "Artists", Icon: Users },
  ];
  if (showAccount) tabs.push({ href: "/account", label: "Account", Icon: Settings });
  return tabs;
}

export function isTabActive(href: string, pathname: string | null): boolean {
  return pathname === href || !!pathname?.startsWith(`${href}/`);
}
