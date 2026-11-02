import { getSession } from "@/lib/auth/session";
import { isOwner } from "@/lib/concerts/owner";
import { RememberOwner } from "./OwnerHint";

/**
 * Renders its children only for the profile's owner. Reads the session cookie,
 * so it must sit inside <Suspense fallback={null}>: the public page around it
 * never waits on the cookie, and visitors get nothing — no flicker. Header
 * controls use <OwnerHint> as that fallback so the owner sees no flicker either.
 */
export async function OwnerOnly({ username, children }: { username: string; children: React.ReactNode }) {
  const owner = isOwner(await getSession(), username);
  return (
    <>
      {owner && children}
      <RememberOwner username={username} owner={owner} />
    </>
  );
}
