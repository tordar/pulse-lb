import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getUserByMbId } from "@/lib/auth/users";
import { stripe, paymentsConfigured } from "@/lib/stripe";

function baseUrl(req: NextRequest): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  if (!paymentsConfigured()) {
    return NextResponse.json({ error: "payments_unavailable" }, { status: 503 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = await getUserByMbId(session.mbAccountId);
  if (!user?.stripeCustomerId) {
    return NextResponse.json({ error: "no_customer" }, { status: 400 });
  }
  const portal = await stripe().billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${baseUrl(req)}/account`,
  });
  return NextResponse.json({ url: portal.url });
}
