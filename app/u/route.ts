import { NextRequest, NextResponse } from "next/server";
import { getListenCount } from "@/lib/listenbrainz/client";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("username");
  const username = raw?.trim().toLowerCase();
  if (!username) return NextResponse.redirect(new URL("/", req.url));

  // Reject obviously invalid usernames before pinging LB
  if (!/^[a-z0-9_.-]{1,64}$/.test(username)) {
    return NextResponse.redirect(new URL(`/onboarding?error=invalid&username=${encodeURIComponent(username)}`, req.url));
  }

  const count = await getListenCount(username).catch(() => null);
  if (count === null) {
    return NextResponse.redirect(
      new URL(`/onboarding?error=notfound&username=${encodeURIComponent(username)}`, req.url),
    );
  }
  return NextResponse.redirect(new URL(`/u/${encodeURIComponent(username)}/stats`, req.url));
}
