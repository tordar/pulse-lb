import Link from "next/link";
import { Check } from "lucide-react";
import { paymentsConfigured } from "@/lib/stripe";
import { getSession } from "@/lib/auth/session";
import { PricingButtons } from "./PricingButtons";

export default async function PricingPage() {
  const session = await getSession();
  const live = paymentsConfigured();

  return (
    <main className="max-w-4xl mx-auto px-6 py-16">
      <div className="text-center space-y-3 mb-12">
        <h1 className="text-4xl font-bold tracking-tight">Subscribe to keep syncing</h1>
        <p className="text-muted-foreground">
          Public dashboards stay free for everyone. Subscribers can add new listens to their own profile.
        </p>
      </div>

      {!live ? (
        <div className="rounded-md border border-card-border bg-card p-6 text-center text-muted-foreground">
          Payments are not configured yet — coming soon.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          <PlanCard
            title="Annual"
            price="$10"
            sub="/year"
            features={["7-day free trial", "Cancel any time", "All future features included"]}
            plan="annual"
            session={session}
          />
          <PlanCard
            title="Lifetime"
            price="$25"
            sub="once"
            features={["Pay once", "Sync forever", "Support a solo project"]}
            plan="lifetime"
            session={session}
            highlight
          />
        </div>
      )}
    </main>
  );
}

function PlanCard({
  title, price, sub, features, plan, session, highlight,
}: {
  title: string;
  price: string;
  sub: string;
  features: string[];
  plan: "annual" | "lifetime";
  session: Awaited<ReturnType<typeof getSession>>;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-6 space-y-4 ${
        highlight ? "border-primary" : "border-card-border"
      }`}
    >
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-3xl font-bold">
          {price}
          <span className="text-base font-normal text-muted-foreground"> {sub}</span>
        </p>
      </div>
      <ul className="space-y-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check size={16} className="text-primary mt-0.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      {session ? (
        <PricingButtons plan={plan} />
      ) : (
        <Link
          href={`/auth/login?return=${encodeURIComponent("/pricing")}`}
          className="block w-full text-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
        >
          Sign in to subscribe
        </Link>
      )}
    </div>
  );
}
