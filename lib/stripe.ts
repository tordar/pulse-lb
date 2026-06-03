import Stripe from "stripe";

let _client: Stripe | null = null;

export function stripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  _client = new Stripe(key);
  return _client;
}

export function priceId(plan: "annual" | "lifetime"): string | null {
  if (plan === "annual") return process.env.STRIPE_PRICE_ANNUAL ?? null;
  return process.env.STRIPE_PRICE_LIFETIME ?? null;
}

export function paymentsConfigured(): boolean {
  return (
    !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_PRICE_ANNUAL &&
    !!process.env.STRIPE_PRICE_LIFETIME
  );
}
