"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCOUNT_TAB, isTabActive, navTabs, type NavTab } from "@/lib/nav";

/**
 * Desktop section nav — the centred pill in the header. Phones get <TabBar>
 * fixed to the bottom instead, so this hides below md. The owner's Account
 * pill arrives as a child (see <AccountPill>), streamed in after the cookie
 * check so the tabs never wait on it.
 */
export function PillNav({ username, children }: { username: string; children?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sections"
      className="hidden md:inline-flex items-center bg-card border border-card-border rounded-full p-1 shadow-sm"
    >
      {navTabs(username).map((tab) => (
        <PillLink key={tab.href} tab={tab} active={isTabActive(tab.href, pathname)} />
      ))}
      {children}
    </nav>
  );
}

export function AccountPill() {
  const pathname = usePathname();
  return <PillLink tab={ACCOUNT_TAB} active={isTabActive(ACCOUNT_TAB.href, pathname)} />;
}

function PillLink({ tab: { href, label, Icon }, active }: { tab: NavTab; active: boolean }) {
  return (
    <Link
      prefetch
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
}
