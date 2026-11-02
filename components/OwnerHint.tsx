"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

const KEY = "pulse:owner";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const subscribe = () => () => {};

/**
 * Suspense fallback for <OwnerOnly>: shows the owner's controls straight away
 * when this browser last saw the owner's session for this profile, so they
 * don't blink out while the cookie check streams in after a layout change
 * (e.g. leaving /account). <OwnerOnly> replaces it with the real answer.
 * Without `username` it takes the profile from the URL, so a fallback can
 * render before the route's params have resolved.
 */
export function OwnerHint({ username, children }: { username?: string; children: React.ReactNode }) {
  const owner = useOwnerHint();
  if (owner === null) return null;
  return username !== undefined
    ? owner === username ? <>{children}</> : null
    : <PathMatch owner={owner}>{children}</PathMatch>;
}

/** The profile name this browser last saw the owner's session for. Always
 *  null while prerendering, so callers can gate URL reads behind it. */
export function useOwnerHint(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

// Split out so usePathname only runs client-side, never in the prerendered
// shell (Cache Components rejects URL data outside Suspense).
function PathMatch({ owner, children }: { owner: string; children: React.ReactNode }) {
  return usePathUsername() === owner ? <>{children}</> : null;
}

/** The profile in a /u/<username>/… URL, else null. */
export function usePathUsername(): string | null {
  const m = usePathname().match(/^\/u\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Records (or clears) the hint once the session has been checked. */
export function RememberOwner({ username, owner }: { username: string; owner: boolean }) {
  useEffect(() => {
    try {
      if (owner) localStorage.setItem(KEY, username);
      else if (localStorage.getItem(KEY) === username) localStorage.removeItem(KEY);
    } catch {
      /* private mode: no hint, same as before */
    }
  }, [username, owner]);
  return null;
}
