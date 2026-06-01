import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username")?.trim();
  if (!username) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.redirect(new URL(`/u/${encodeURIComponent(username)}`, req.url));
}
