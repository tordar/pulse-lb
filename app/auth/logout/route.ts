import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  await clearSession();
  // See callback/route.ts: honor APP_URL so self-hosters behind a proxy land
  // on their public URL after sign-out, not the internal req origin.
  const base = process.env.APP_URL?.replace(/\/+$/, "") || req.nextUrl.origin;
  return NextResponse.redirect(new URL("/", base), { status: 303 });
}
