import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";

export type DbUser = typeof schema.users.$inferSelect;

export async function getUserByMbId(mbAccountId: number): Promise<DbUser | null> {
  const row = await withRetry(() =>
    db.query.users.findFirst({
      where: eq(schema.users.mbAccountId, mbAccountId),
    }),
  );
  return row ?? null;
}

export async function getUserByLbUsername(lbUsername: string): Promise<DbUser | null> {
  const row = await withRetry(() =>
    db.query.users.findFirst({
      where: eq(schema.users.listenbrainzUsername, lbUsername),
    }),
  );
  return row ?? null;
}

export type MbProfile = {
  mbAccountId: number;
  lbUsername: string;
  email: string | null;
};

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
  const inserted = await withRetry(() =>
    db
      .insert(schema.users)
      .values({
        mbAccountId: p.mbAccountId,
        listenbrainzUsername: p.lbUsername,
        email: p.email,
        trialEndsAt: sql`now() + interval '7 days'`,
        subscriptionStatus: "trial",
      })
      .returning(),
  );
  return inserted[0];
}

export function isAllowedToSync(user: DbUser | null): boolean {
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
