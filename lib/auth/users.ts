import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { userCached } from "@/lib/db/queries/cache";

export type DbUser = typeof schema.users.$inferSelect;

export async function getUserByMbId(mbAccountId: number): Promise<DbUser | null> {
  const row = await withRetry(() =>
    db.query.users.findFirst({
      where: eq(schema.users.mbAccountId, mbAccountId),
    }),
  );
  return row ?? null;
}

/**
 * Display-only read for the "listen source" dots, called on every detail and
 * stats render — i.e. on every page a crawler can reach. Cached under the
 * user tag (see lib/db/queries/cache) so those renders don't wake Neon; it
 * selects the one column on purpose rather than caching the whole users row,
 * which carries subscription and Stripe fields. app/account/actions.ts drops
 * the tag when the toggle changes.
 */
export function getShowListenSource(lbUsername: string): Promise<boolean> {
  return userCached(lbUsername, ["showListenSource", lbUsername], async () => {
    const row = await withRetry(() =>
      db.query.users.findFirst({
        columns: { showListenSource: true },
        where: eq(schema.users.listenbrainzUsername, lbUsername),
      }),
    );
    return row?.showListenSource ?? false;
  });
}

export type MbProfile = {
  mbAccountId: number;
  lbUsername: string;
  email: string | null;
};

// LB usernames that get lifetime status on first sign-in instead of a trial.
// These accounts existed before paid signup launched.
const GRANDFATHERED_USERNAMES = new Set(["tordar", "powerole"]);

/**
 * Find-or-create. New row → trial starts now + 7 days. Existing row →
 * refresh lb_username/email only; preserve subscription_status, trial_ends_at,
 * and all Stripe fields. This is what protects pre-seeded "lifetime" users
 * from being downgraded to "trial" on their first sign-in.
 */
export async function findOrCreateUserFromProfile(p: MbProfile): Promise<DbUser> {
  const existing = await getUserByMbId(p.mbAccountId);
  if (existing) {
    await withRetry(() =>
      db
        .update(schema.users)
        .set({ listenbrainzUsername: p.lbUsername, email: p.email })
        .where(eq(schema.users.id, existing.id)),
    );
    return { ...existing, listenbrainzUsername: p.lbUsername, email: p.email };
  }
  const isGrandfathered = GRANDFATHERED_USERNAMES.has(p.lbUsername);
  const inserted = await withRetry(() =>
    db
      .insert(schema.users)
      .values({
        mbAccountId: p.mbAccountId,
        listenbrainzUsername: p.lbUsername,
        email: p.email,
        ...(isGrandfathered
          ? { subscriptionStatus: "lifetime" as const, subscriptionKind: "lifetime" as const }
          : { subscriptionStatus: "trial" as const, trialEndsAt: sql`now() + interval '7 days'` }),
      })
      .returning(),
  );
  return inserted[0];
}

export function isAllowedToSync(user: DbUser | null): boolean {
  // Self-host: no paywall. Auth/authorization is enforced upstream in the
  // sync route; this gate is purely about subscription status.
  if (process.env.SELF_HOST === "true") return true;
  if (!user) return false;
  if (user.subscriptionStatus === "lifetime") return true;
  const now = new Date();
  if (
    user.subscriptionStatus === "active" &&
    user.currentPeriodEnd &&
    user.currentPeriodEnd > now
  ) {
    return true;
  }
  if (
    user.subscriptionStatus === "trial" &&
    user.trialEndsAt &&
    user.trialEndsAt > now
  ) {
    return true;
  }
  // 'canceled' falls through here when current_period_end has passed.
  return false;
}
