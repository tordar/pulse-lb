import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { getSession } from "@/lib/auth/session";
import { getUserByMbId } from "@/lib/auth/users";
import { stripe, priceId, paymentsConfigured } from "@/lib/stripe";

// Lifetime is no longer purchasable (granted manually via SQL). The API only
// accepts "annual"; any other plan is rejected as a bad request.
const Body = z.object({ plan: z.enum(["annual"]) });

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
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.subscriptionStatus === "lifetime") {
    return NextResponse.json({ error: "already_lifetime" }, { status: 409 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const price = priceId(body.plan);
  if (!price) {
    return NextResponse.json({ error: "payments_unavailable" }, { status: 503 });
  }

  const origin = baseUrl(req);
  const checkout = await stripe().checkout.sessions.create({
    mode: body.plan === "annual" ? "subscription" : "payment",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: user.id,
    customer: user.stripeCustomerId ?? undefined,
    customer_email: !user.stripeCustomerId && user.email ? user.email : undefined,
    success_url: `${origin}/account?welcome=true`,
    cancel_url: `${origin}/#pricing`,
    metadata: { user_id: user.id, plan: body.plan },
    ...(body.plan === "annual"
      ? { subscription_data: { metadata: { user_id: user.id, plan: body.plan } } }
      : { payment_intent_data: { metadata: { user_id: user.id, plan: body.plan } } }),
  });

  if (!checkout.url) {
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }

  // Persist the customer id the moment Stripe assigns one, so subsequent
  // Checkout sessions reuse the same Customer (lets us match in the webhook
  // even if the user abandons this one and starts another).
  if (checkout.customer && !user.stripeCustomerId) {
    const customerId =
      typeof checkout.customer === "string" ? checkout.customer : checkout.customer.id;
    await withRetry(() =>
      db
        .update(schema.users)
        .set({ stripeCustomerId: customerId })
        .where(eq(schema.users.id, user.id)),
    );
  }

  return NextResponse.json({ url: checkout.url });
}
