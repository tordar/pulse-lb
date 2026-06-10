import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, fetchUserInfo } from "@/lib/auth/oauth";
import { findOrCreateUserFromProfile } from "@/lib/auth/users";
import { setSession } from "@/lib/auth/session";

const STATE_COOKIE = "pulse_oauth_state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  // Browser-facing redirect origin. Self-hosters behind a reverse proxy / on a
  // non-localhost URL must set APP_URL; otherwise req.nextUrl.origin reflects
  // the internal address the server sees (e.g. localhost:3000), which sends
  // users to the wrong host after sign-in.
  const base = process.env.APP_URL?.replace(/\/+$/, "") || req.nextUrl.origin;
  if (errorParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=${encodeURIComponent(errorParam)}`, base));
  }
  if (!code || !stateParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=missing_params`, base));
  }

  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_missing`, base));
  }
  let stored: { state: string; returnTo: string };
  try {
    stored = JSON.parse(stateCookie);
  } catch {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_corrupt`, base));
  }
  if (stored.state !== stateParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_mismatch`, base));
  }

  let token: string;
  let profile: { sub: string; metabrainz_user_id: number; email?: string };
  try {
    token = await exchangeCodeForToken(code);
    profile = await fetchUserInfo(token);
  } catch {
    return NextResponse.redirect(new URL(`/?error=auth&reason=upstream`, base));
  }

  const user = await findOrCreateUserFromProfile({
    mbAccountId: profile.metabrainz_user_id,
    lbUsername: profile.sub,
    email: profile.email ?? null,
  });

  await setSession({
    uid: user.id,
    mbAccountId: user.mbAccountId,
    lbUsername: user.listenbrainzUsername,
  });

  const dest =
    stored.returnTo && stored.returnTo.startsWith("/")
      ? stored.returnTo
      : `/u/${encodeURIComponent(user.listenbrainzUsername)}/stats`;
  const res = NextResponse.redirect(new URL(dest, base));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
