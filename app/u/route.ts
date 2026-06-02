import { NextRequest, NextResponse } from "next/server";
import { getListenCount } from "@/lib/listenbrainz/client";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("username");
  const username = raw?.trim().toLowerCase();
  if (!username) return NextResponse.redirect(new URL("/", req.url));

  // Reject obviously invalid usernames before pinging LB
  if (!/^[a-z0-9_.-]{1,64}$/.test(username)) {
    return NextResponse.redirect(
      new URL(`/onboarding?error=invalid&username=${encodeURIComponent(username)}`, req.url),
    );
  }

  // getListenCount returns null on a clean 404 (user doesn't exist); throws on
  // anything else (network error, 5xx, timeout). Treat those very differently:
  // a 404 means "create an account" — anything else means "LB is having a
  // moment, refresh shortly" and we shouldn't send the visitor to onboarding.
  let count: number | null;
  try {
    count = await getListenCount(username);
  } catch {
    return NextResponse.redirect(
      new URL(`/?error=upstream&username=${encodeURIComponent(username)}`, req.url),
    );
  }
  if (count === null) {
    return NextResponse.redirect(
      new URL(`/onboarding?error=notfound&username=${encodeURIComponent(username)}`, req.url),
    );
  }
  return NextResponse.redirect(new URL(`/u/${encodeURIComponent(username)}/stats`, req.url));
}
