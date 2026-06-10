import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getUserByMbId } from "@/lib/auth/users";
import { paymentsConfigured } from "@/lib/stripe";
import { AccountActions } from "./AccountActions";
import { SourceToggle } from "./SourceToggle";

export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect(`/auth/login?return=${encodeURIComponent("/account")}`);
  }
  const user = await getUserByMbId(session.mbAccountId);
  if (!user) redirect("/auth/logout");

  const { welcome } = await searchParams;
  const isProcessing =
    welcome === "true" && !["active", "lifetime"].includes(user.subscriptionStatus ?? "");

  return (
    <main className="max-w-2xl mx-auto px-6 py-12 space-y-8">
      {isProcessing && (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 text-amber-100 p-4 text-sm">
          Processing your payment — refresh in a moment.
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          @{user.listenbrainzUsername}
          {user.email && <> · {user.email}</>}
        </p>
      </div>

      <Section title="Subscription">
        <SubscriptionBlock user={user} live={paymentsConfigured()} />
      </Section>

      <Section title="Display">
        <SourceToggle initial={user.showListenSource} />
      </Section>

      <Section title="Session">
        <AccountActions hasCustomer={!!user.stripeCustomerId} />
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-card-border bg-card p-6 space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function SubscriptionBlock({
  user,
  live,
}: {
  user: NonNullable<Awaited<ReturnType<typeof getUserByMbId>>>;
  live: boolean;
}) {
  if (user.subscriptionStatus === "lifetime") {
    return <p className="text-sm">Lifetime plan — thank you 🙂</p>;
  }
  if (user.subscriptionStatus === "active" && user.currentPeriodEnd) {
    return (
      <div className="text-sm space-y-1">
        <p>Active until {user.currentPeriodEnd.toISOString().slice(0, 10)}.</p>
      </div>
    );
  }
  if (user.subscriptionStatus === "canceled" && user.currentPeriodEnd) {
    return (
      <div className="text-sm space-y-2">
        <p>Canceled. Sync stops {user.currentPeriodEnd.toISOString().slice(0, 10)}.</p>
        <Link href="/#pricing" className="underline text-primary">Resubscribe</Link>
      </div>
    );
  }
  if (user.subscriptionStatus === "trial" && user.trialEndsAt) {
    const daysLeft = Math.max(
      0,
      Math.ceil((user.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );
    return (
      <div className="text-sm space-y-2">
        <p>Trial: {daysLeft} day{daysLeft === 1 ? "" : "s"} left.</p>
        {live && (
          <Link href="/#pricing" className="underline text-primary">
            Subscribe to keep syncing
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="text-sm space-y-2">
      <p>No active subscription. Sync is disabled.</p>
      {live && (
        <Link href="/#pricing" className="underline text-primary">
          Subscribe
        </Link>
      )}
    </div>
  );
}
