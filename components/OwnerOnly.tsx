import { getSession } from "@/lib/auth/session";
import { isOwner } from "@/lib/concerts/owner";

/**
 * Renders its children only for the profile's owner. Reads the session cookie,
 * so it must sit inside <Suspense fallback={null}>: the public page around it
 * never waits on the cookie, and visitors get nothing — no flicker.
 */
export async function OwnerOnly({ username, children }: { username: string; children: React.ReactNode }) {
  return isOwner(await getSession(), username) ? <>{children}</> : null;
}
