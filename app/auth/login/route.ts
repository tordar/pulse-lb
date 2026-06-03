import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthorizeUrl } from "@/lib/auth/oauth";

const STATE_COOKIE = "pulse_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

export async function GET(req: NextRequest) {
  const state = randomBytes(32).toString("hex");
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url);
  // Capture the post-login destination so the callback can route back.
  const returnTo = req.nextUrl.searchParams.get("return") ?? "/";
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
