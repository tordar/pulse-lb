import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

// Stripe sends events as raw POST bodies; signature verification requires the
// exact bytes, so we read the request body as text (not JSON-parsed) and pass
// it straight to constructEvent.
export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: "no_signature" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  // Idempotency: bail if we've seen this event id before.
  const seen = await withRetry(() =>
    db.query.stripeEvents.findFirst({ where: eq(schema.stripeEvents.id, event.id) }),
  );
  if (seen) return NextResponse.json({ ok: true, deduped: true });

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_failed":
        // Stripe retries automatically; nothing to do server-side.
        break;
      default:
        // Unhandled event type — record it so we don't reprocess on retry.
        break;
    }
    await withRetry(() =>
      db.insert(schema.stripeEvents).values({ id: event.id, type: event.type }),
    );
  } catch (e) {
    // Return 500 so Stripe retries. Idempotency above prevents double-apply.
    console.error("webhook handler failed", event.id, event.type, e);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

async function handleCheckoutCompleted(s: Stripe.Checkout.Session) {
  const userId = s.metadata?.user_id;
  if (!userId) return;
  const plan = s.metadata?.plan;
  const customerId =
    typeof s.customer === "string" ? s.customer : s.customer?.id ?? null;

  if (plan === "lifetime" || s.mode === "payment") {
    await withRetry(() =>
      db
        .update(schema.users)
        .set({
          subscriptionStatus: "lifetime",
          subscriptionKind: "lifetime",
          stripeCustomerId: customerId ?? undefined,
        })
        .where(eq(schema.users.id, userId)),
    );
    return;
  }

  // Subscription path
  const subscriptionId =
    typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
  let currentPeriodEnd: Date | null = null;
  if (subscriptionId) {
    const sub = await stripe().subscriptions.retrieve(subscriptionId);
    currentPeriodEnd = new Date(
      (sub as unknown as { current_period_end: number }).current_period_end * 1000,
    );
  }
  await withRetry(() =>
    db
      .update(schema.users)
      .set({
        subscriptionStatus: "active",
        subscriptionKind: "annual",
        stripeCustomerId: customerId ?? undefined,
        stripeSubscriptionId: subscriptionId ?? undefined,
        currentPeriodEnd: currentPeriodEnd ?? undefined,
      })
      .where(eq(schema.users.id, userId)),
  );
}

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const userId = sub.metadata?.user_id;
  if (!userId) return;
  const currentPeriodEnd = new Date(
    (sub as Stripe.Subscription & { current_period_end: number }).current_period_end * 1000,
  );
  const status =
    sub.status === "canceled" || sub.status === "incomplete_expired"
      ? ("canceled" as const)
      : ("active" as const);
  await withRetry(() =>
    db
      .update(schema.users)
      .set({
        subscriptionStatus: status,
        stripeSubscriptionId: sub.id,
        currentPeriodEnd,
      })
      .where(eq(schema.users.id, userId)),
  );
}
