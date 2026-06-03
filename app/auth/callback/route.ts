import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, fetchUserInfo } from "@/lib/auth/oauth";
import { findOrCreateUserFromProfile } from "@/lib/auth/users";
import { setSession } from "@/lib/auth/session";

const STATE_COOKIE = "pulse_oauth_state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  if (errorParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=${encodeURIComponent(errorParam)}`, req.url));
  }
  if (!code || !stateParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=missing_params`, req.url));
  }

  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_missing`, req.url));
  }
  let stored: { state: string; returnTo: string };
  try {
    stored = JSON.parse(stateCookie);
  } catch {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_corrupt`, req.url));
  }
  if (stored.state !== stateParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_mismatch`, req.url));
  }

  let token: string;
  let profile: { sub: string; metabrainz_user_id: number; email?: string };
  try {
    token = await exchangeCodeForToken(code);
    profile = await fetchUserInfo(token);
  } catch {
    return NextResponse.redirect(new URL(`/?error=auth&reason=upstream`, req.url));
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
  const res = NextResponse.redirect(new URL(dest, req.url));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
