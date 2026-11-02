"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ACCOUNT_TAB, isTabActive, navTabs, type NavTab } from "@/lib/nav";
import { OwnerHint, useOwnerHint, usePathUsername } from "@/components/OwnerHint";
import { Sk } from "@/components/Skeletons";

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

const NAV_SKELETON = <Sk className="h-[42px] w-[260px] lg:w-[520px] rounded-full" />;

/**
 * The header's fallback while params stream. For the owner it's the real nav
 * built from the URL, so going back from /account doesn't blank the pills;
 * everyone else (and the prerendered shell) gets the skeleton.
 */
export function PathPillNav() {
  return useOwnerHint() === null ? NAV_SKELETON : <UrlPillNav />;
}

function UrlPillNav() {
  const username = usePathUsername();
  if (!username) return NAV_SKELETON;
  return (
    <PillNav username={username}>
      <OwnerHint username={username}>
        <AccountPill />
      </OwnerHint>
    </PillNav>
  );
}

export function AccountPill() {
  const pathname = usePathname();
  return <PillLink tab={ACCOUNT_TAB} active={isTabActive(ACCOUNT_TAB.href, pathname)} fullPrefetch={false} />;
}

function PillLink({
  tab: { href, label, Icon },
  active,
  fullPrefetch = true,
}: {
  tab: NavTab;
  active: boolean;
  fullPrefetch?: boolean;
}) {
  return (
    <Link
      prefetch={fullPrefetch ? true : undefined}
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={`inline-flex items-center gap-2 px-3 lg:px-4 py-1.5 rounded-full text-sm font-medium transition active:scale-95 ${
        active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"
      }`}
    >
      <Icon size={15} strokeWidth={2} />
      {/* Tablet widths can't fit the labels beside the breadcrumb and the
          now-playing pill: icons only until lg. */}
      <span className="hidden lg:inline">{label}</span>
    </Link>
  );
}
