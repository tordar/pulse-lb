# Pulse-LB Auth + Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MetaBrainz OAuth sign-in, a 7-day trial gate on the sync action, and Stripe-powered Annual ($10/yr) and Lifetime ($25) subscription options — without changing the public-read behavior of any dashboard route.

**Architecture:** Two new tables (`users`, `stripe_events`). Three new route groups (`/auth/*`, `/api/stripe/*`, `/account`, `/pricing`). One new authorization check inside `POST /api/sync/[username]`. Session via signed JWT cookie (`jose`, HS256). Stripe via hosted Checkout + Customer Portal. No middleware-level auth — gates live at the two write paths only. Soft-degrades gracefully when Stripe env vars are missing (the pre-MetaBrainz-approval state).

**Tech Stack:** Next.js 16 App Router · React 19 · Drizzle ORM 0.45 + Neon HTTP · `jose` for JWT · `stripe` Node SDK · Zod for input validation.

**Spec:** `docs/superpowers/specs/2026-06-03-auth-payments-design.md`

**Working directory for all tasks:** `/Users/tordartommervik/Documents/code/pulse-lb`. Run every command from there. Commit to `main`.

---

## Prerequisites (do these BEFORE Task 1)

The implementer cannot complete Task 3 without an MB OAuth app registered, and Task 7 without a Stripe account. These are 10-minute one-time setup steps the user (Tordar) does manually.

1. **Register MetaBrainz OAuth application:**
   - Sign in at https://musicbrainz.org/account/applications
   - Create application: name "pulse-lb", type "Confidential", redirect URIs:
     - `http://localhost:3000/auth/callback`
     - `https://pulse-lb.vercel.app/auth/callback`
   - Note the `Client ID` and `Client Secret` — these go into env vars.

2. **Create Stripe account:**
   - Sign up at https://stripe.com if not already.
   - Stay in **Test mode** for now (toggle in dashboard top-right).
   - Note the `Publishable key` and `Secret key` from the Developers → API keys page.

3. **Add to local `.env`** (Vercel env vars come later, at deploy time):
   ```
   METABRAINZ_CLIENT_ID=<from step 1>
   METABRAINZ_CLIENT_SECRET=<from step 1>
   METABRAINZ_REDIRECT_URI=http://localhost:3000/auth/callback
   JWT_SECRET=<generate with: openssl rand -base64 32>
   STRIPE_SECRET_KEY=<test mode secret from step 2>
   STRIPE_WEBHOOK_SECRET=<will be set in Task 9, leave blank for now>
   STRIPE_PRICE_ANNUAL=<will be set after products are created in Task 9>
   STRIPE_PRICE_LIFETIME=<will be set after products are created in Task 9>
   ```

The plan assumes these credentials exist in `.env`. The Stripe products themselves are created later (Task 9). The grandfather script (Task 4) needs the LB API only — no MB OAuth required.

---

## File map

**Create:**
- `lib/auth/session.ts` — JWT cookie I/O
- `lib/auth/users.ts` — `users` table CRUD
- `lib/auth/oauth.ts` — MB OAuth: authorize URL + token exchange + profile fetch
- `lib/stripe.ts` — Stripe client + product config + gate helper
- `app/auth/login/route.ts` — GET, redirect to MB authorize
- `app/auth/callback/route.ts` — GET, exchange + set cookie
- `app/auth/logout/route.ts` — POST, clear cookie
- `app/api/stripe/checkout/route.ts` — POST, create Checkout Session
- `app/api/stripe/portal/route.ts` — POST, create Portal session
- `app/api/stripe/webhook/route.ts` — POST, handle Stripe events
- `app/pricing/page.tsx` — pricing UI
- `app/account/page.tsx` — account UI (server component)
- `app/account/AccountActions.tsx` — client component for buttons
- `components/SignInButton.tsx` — reusable "Sign in with ListenBrainz" CTA
- `scripts/grandfather-users.ts` — pre-seed lifetime status for existing users
- `drizzle/0005_<auto>.sql` — drizzle-generated migration

**Modify:**
- `lib/db/schema.ts` — append `users` + `stripeEvents` tables
- `app/api/sync/[username]/route.ts` — auth gate at top of POST
- `app/u/[username]/stats/SyncButton.tsx` — handle 401/402/403 responses
- `app/u/[username]/stats/page.tsx` — server-side session read; conditional sync UI
- `app/page.tsx` — logged-in vs logged-out states
- `app/onboarding/page.tsx` — last step → "Sign in with ListenBrainz"
- `package.json` — add `jose`, `stripe`

**No tests:** the project has no test framework. Verification is manual: dev server + curl + Stripe CLI + actual browser sign-in. Same pattern as the aggregate-tables work that just shipped.

---

## Task 1: Install dependencies + schema + migration

**Files:**
- Modify: `package.json`
- Modify: `lib/db/schema.ts`
- Create: `drizzle/0005_<auto>.sql`

- [ ] **Step 1: Install deps**

```bash
npm install jose stripe
```

Expected: lockfile updated, no errors. Confirm with `grep '"jose"\|"stripe"' package.json` — both should appear in `dependencies`.

- [ ] **Step 2: Add `users` and `stripeEvents` tables to `lib/db/schema.ts`**

Append to the end of the file (after `syncJobs`):

```ts
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  mbAccountId: integer("mb_account_id").notNull().unique(),
  listenbrainzUsername: text("listenbrainz_username").notNull().unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  subscriptionStatus: text("subscription_status").$type<
    "trial" | "active" | "canceled" | "lifetime"
  >(),
  subscriptionKind: text("subscription_kind").$type<"annual" | "lifetime">(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
});

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`

Expected: drizzle-kit prints `Your SQL migration file ➜ drizzle/0005_<two_words>.sql`. Inspect the file — it should contain two `CREATE TABLE` statements (`users`, `stripe_events`) plus a unique constraint / index on `users.mb_account_id` and `users.listenbrainz_username`.

If anything else changes (drizzle picks up unrelated drift), abort and ask the controller — do not apply.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:migrate`

Expected: `migrated` printed. Verify with:
```bash
psql "$DATABASE_URL" -c "\dt users; \dt stripe_events;"
```
Both tables listed.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json lib/db/schema.ts drizzle/0005_*.sql drizzle/meta/
git commit -m "feat(db): users + stripe_events tables and jose/stripe deps"
```

---

## Task 2: Auth library — session, users, oauth

**Files:**
- Create: `lib/auth/session.ts`
- Create: `lib/auth/users.ts`
- Create: `lib/auth/oauth.ts`

- [ ] **Step 1: Create `lib/auth/session.ts`**

```ts
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "pulse_session";
const ALGO = "HS256";
const ONE_DAY = 60 * 60 * 24;
const SESSION_TTL_SECONDS = 30 * ONE_DAY;

export type Session = {
  uid: string;            // users.id
  mbAccountId: number;
  lbUsername: string;
};

function secretKey(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(raw);
}

export async function setSession(session: Session): Promise<void> {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: ALGO })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALGO] });
    if (
      typeof payload.uid !== "string" ||
      typeof payload.mbAccountId !== "number" ||
      typeof payload.lbUsername !== "string"
    ) {
      return null;
    }
    return {
      uid: payload.uid,
      mbAccountId: payload.mbAccountId,
      lbUsername: payload.lbUsername,
    };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
```

- [ ] **Step 2: Create `lib/auth/users.ts`**

```ts
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
```

- [ ] **Step 3: Create `lib/auth/oauth.ts`**

```ts
import { z } from "zod";

const AUTHORIZE_URL = "https://musicbrainz.org/oauth2/authorize";
const TOKEN_URL = "https://musicbrainz.org/oauth2/token";
const USERINFO_URL = "https://musicbrainz.org/oauth2/userinfo";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("METABRAINZ_CLIENT_ID"),
    response_type: "code",
    redirect_uri: requireEnv("METABRAINZ_REDIRECT_URI"),
    scope: "profile",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

const TokenResponse = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
});

export async function exchangeCodeForToken(code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: requireEnv("METABRAINZ_CLIENT_ID"),
    client_secret: requireEnv("METABRAINZ_CLIENT_SECRET"),
    redirect_uri: requireEnv("METABRAINZ_REDIRECT_URI"),
    grant_type: "authorization_code",
    code,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${res.status}`);
  }
  const json = await res.json();
  return TokenResponse.parse(json).access_token;
}

// The MetaBrainz /oauth2/userinfo response. `sub` is the LB/MB username.
// `metabrainz_user_id` is the stable integer we key on.
const UserInfo = z.object({
  sub: z.string(),
  metabrainz_user_id: z.number(),
  email: z.string().email().optional(),
});

export type MbUserInfo = z.infer<typeof UserInfo>;

export async function fetchUserInfo(accessToken: string): Promise<MbUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`OAuth userinfo fetch failed: ${res.status}`);
  }
  return UserInfo.parse(await res.json());
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`

Expected: no output (clean pass).

- [ ] **Step 5: Commit**

```bash
git add lib/auth/
git commit -m "feat(auth): session JWT cookie + users CRUD + MetaBrainz OAuth helpers"
```

---

## Task 3: Auth routes — /auth/login, /auth/callback, /auth/logout

**Files:**
- Create: `app/auth/login/route.ts`
- Create: `app/auth/callback/route.ts`
- Create: `app/auth/logout/route.ts`

- [ ] **Step 1: Create `app/auth/login/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthorizeUrl } from "@/lib/auth/oauth";

const STATE_COOKIE = "pulse_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

export async function GET(req: NextRequest) {
  const state = randomBytes(32).toString("hex");
  const url = buildAuthorizeUrl(state);
  const res = NextResponse.redirect(url);
  // Capture the post-login destination so the callback can route back.
  const returnTo = req.nextUrl.searchParams.get("return") ?? "/";
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
```

- [ ] **Step 2: Create `app/auth/callback/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken, fetchUserInfo } from "@/lib/auth/oauth";
import { findOrCreateUserFromProfile } from "@/lib/auth/users";
import { setSession } from "@/lib/auth/session";

const STATE_COOKIE = "pulse_oauth_state";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const stateParam = req.nextUrl.searchParams.get("state");
  const errorParam = req.nextUrl.searchParams.get("error");
  if (errorParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=${encodeURIComponent(errorParam)}`, req.url));
  }
  if (!code || !stateParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=missing_params`, req.url));
  }

  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_missing`, req.url));
  }
  let stored: { state: string; returnTo: string };
  try {
    stored = JSON.parse(stateCookie);
  } catch {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_corrupt`, req.url));
  }
  if (stored.state !== stateParam) {
    return NextResponse.redirect(new URL(`/?error=auth&reason=state_mismatch`, req.url));
  }

  let token: string;
  let profile: { sub: string; metabrainz_user_id: number; email?: string };
  try {
    token = await exchangeCodeForToken(code);
    profile = await fetchUserInfo(token);
  } catch {
    return NextResponse.redirect(new URL(`/?error=auth&reason=upstream`, req.url));
  }

  const user = await findOrCreateUserFromProfile({
    mbAccountId: profile.metabrainz_user_id,
    lbUsername: profile.sub,
    email: profile.email ?? null,
  });

  await setSession({
    uid: user.id,
    mbAccountId: user.mbAccountId,
    lbUsername: user.listenbrainzUsername,
  });

  const dest =
    stored.returnTo && stored.returnTo.startsWith("/")
      ? stored.returnTo
      : `/u/${encodeURIComponent(user.listenbrainzUsername)}/stats`;
  const res = NextResponse.redirect(new URL(dest, req.url));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
```

- [ ] **Step 3: Create `app/auth/logout/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
```

303 + POST so it isn't accidentally triggered by a GET (link prefetch) and the client gets a clean redirect after.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` — clean.

- [ ] **Step 5: Manual smoke test of the OAuth flow**

Restart the dev server (`npm run dev`) so it picks up the new env vars.

In a browser:
1. Visit `http://localhost:3000/auth/login` → should redirect to `musicbrainz.org/oauth2/authorize` with the right `client_id` and `redirect_uri`.
2. Sign in / grant consent.
3. Should redirect to `http://localhost:3000/auth/callback?code=...&state=...`.
4. Callback should redirect to `/u/<your-lb-username>/stats`.
5. Verify the cookie was set:
   ```bash
   psql "$DATABASE_URL" -c "SELECT id, listenbrainz_username, subscription_status, trial_ends_at FROM users;"
   ```
   Expected: a row with your LB username and `trial_ends_at ≈ now + 7 days`.

If callback returns 500 or an error redirect with `reason=upstream`, check the dev server log for the actual exception — most common is a wrong `METABRAINZ_REDIRECT_URI` not matching what's registered in the MB app.

- [ ] **Step 6: Commit**

```bash
git add app/auth/
git commit -m "feat(auth): /auth/login, /auth/callback, /auth/logout routes"
```

---

## Task 4: Grandfather script — pre-seed lifetime users

**Files:**
- Create: `scripts/grandfather-users.ts`

The script looks up each distinct `user_name` in `listens`, fetches their MB account ID via the public LB API (the `/user/{name}` endpoint returns user metadata including the integer ID), and inserts a `users` row with `subscription_status='lifetime'`. Idempotent — re-runnable.

- [ ] **Step 1: Verify the API endpoint returns the integer ID**

```bash
curl -s 'https://api.listenbrainz.org/1/user/tordar' | python3 -m json.tool | head -20
```

Expected: a JSON object with at least `user_id` (integer) and `musicbrainz_id` (string username). If the structure is different, adapt the script accordingly — the load-bearing field is the integer ID.

- [ ] **Step 2: Write the script**

```ts
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

type LbUserResponse = { user_id?: number; musicbrainz_id?: string };

async function fetchMbIdFor(lbUsername: string): Promise<number | null> {
  const res = await fetch(`https://api.listenbrainz.org/1/user/${encodeURIComponent(lbUsername)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as LbUserResponse;
  return typeof json.user_id === "number" ? json.user_id : null;
}

async function main() {
  const distinct = (await sql`
    SELECT DISTINCT user_name FROM listens ORDER BY user_name
  `) as Array<{ user_name: string }>;

  if (distinct.length === 0) {
    console.log("No users in listens — nothing to grandfather.");
    return;
  }

  console.log(`Grandfathering ${distinct.length} existing user(s) as lifetime…`);
  for (const { user_name } of distinct) {
    const mbId = await fetchMbIdFor(user_name);
    if (mbId == null) {
      console.warn(`  ${user_name} — could not resolve MB ID, skipping`);
      continue;
    }

    // ON CONFLICT on mb_account_id: don't downgrade if a row already exists.
    const inserted = await sql`
      INSERT INTO users (
        mb_account_id, listenbrainz_username, subscription_status
      ) VALUES (
        ${mbId}, ${user_name}, 'lifetime'
      )
      ON CONFLICT (mb_account_id) DO UPDATE SET listenbrainz_username = EXCLUDED.listenbrainz_username
      RETURNING id, subscription_status
    ` as Array<{ id: string; subscription_status: string }>;

    const row = inserted[0];
    console.log(`  ${user_name} — mb_id=${mbId} status=${row.subscription_status}`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run it**

Run: `npx tsx scripts/grandfather-users.ts`

Expected output:
```
Grandfathering 2 existing user(s) as lifetime…
  powerole — mb_id=<n> status=lifetime
  tordar — mb_id=<n> status=lifetime
Done.
```

- [ ] **Step 4: Verify the rows**

```bash
psql "$DATABASE_URL" -c "SELECT listenbrainz_username, mb_account_id, subscription_status FROM users ORDER BY listenbrainz_username;"
```

Expected: two rows, both `subscription_status = lifetime`. If you already signed in during Task 3 Step 5 and that created a `trial` row for yourself, it'll have been upgraded to `lifetime` by the `ON CONFLICT` clause via mb_account_id.

- [ ] **Step 5: Commit**

```bash
git add scripts/grandfather-users.ts
git commit -m "chore(auth): grandfather existing users as lifetime"
```

---

## Task 5: Sync route gate

**Files:**
- Modify: `app/api/sync/[username]/route.ts`

- [ ] **Step 1: Add imports**

At the top of `app/api/sync/[username]/route.ts`, add:

```ts
import { getSession } from "@/lib/auth/session";
import { getUserByMbId, isAllowedToSync } from "@/lib/auth/users";
```

- [ ] **Step 2: Add the gate at the start of `POST`**

Inside the `POST` handler, immediately after destructuring `username` from params and BEFORE the `chainDepth` line, insert:

```ts
const session = await getSession();
const isSelfTriggeredHeader = (req.headers.get("x-pulse-chain") ?? "0") !== "0";

// The self-continuation chain re-POSTs to the same route from inside Vercel's
// after() block. Those re-entrant calls don't carry a session cookie; we
// identify them by the chain header and let them through. User-initiated
// POSTs (chain header missing or "0") MUST be authenticated and authorized.
if (!isSelfTriggeredHeader) {
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.lbUsername !== username) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const user = await getUserByMbId(session.mbAccountId);
  if (!isAllowedToSync(user)) {
    return NextResponse.json({ error: "subscription_required" }, { status: 402 });
  }
}
```

The `isSelfTriggeredHeader` check is important: the existing chain-continuation logic at the bottom of the `after()` block re-POSTs to the same route with `x-pulse-chain: <depth>`. Those re-entries originate from our server, not a user, and have no session cookie. If we gate them, the chain breaks. The header was already used (compared to `0`) inside the existing logic as `isSelfTriggered`; we reuse the same convention here.

- [ ] **Step 3: Typecheck and smoke test the gate**

Run: `npx tsc --noEmit -p tsconfig.json` — clean.

Manual test (dev server should be running):

```bash
# Unauthenticated → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/sync/powerole
# Expected: 401

# Authenticated as yourself (cookie from a real sign-in) but trying to sync someone else → 403
# Sign in via browser first, copy the pulse_session cookie value, then:
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "cookie: pulse_session=<paste>" \
  http://localhost:3000/api/sync/someone_else
# Expected: 403

# Authenticated as yourself, syncing your own account → 200 (or 202)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "cookie: pulse_session=<paste>" \
  http://localhost:3000/api/sync/<your_lb_username>
# Expected: 200
```

If you're grandfathered as lifetime (Task 4 ran), the third call succeeds. To prove the 402 path works, manually downgrade yourself temporarily:

```bash
psql "$DATABASE_URL" -c "UPDATE users SET subscription_status = NULL WHERE listenbrainz_username = 'tordar';"
# repeat the third curl → expect 402
psql "$DATABASE_URL" -c "UPDATE users SET subscription_status = 'lifetime' WHERE listenbrainz_username = 'tordar';"
```

- [ ] **Step 4: Commit**

```bash
git add app/api/sync/[username]/route.ts
git commit -m "feat(sync): auth + subscription gate on POST"
```

---

## Task 6: SyncButton 402 handling + stats page session UI

**Files:**
- Modify: `app/u/[username]/stats/SyncButton.tsx`
- Modify: `app/u/[username]/stats/page.tsx`
- Create: `components/SignInButton.tsx`

- [ ] **Step 1: Create `components/SignInButton.tsx`**

```tsx
import Link from "next/link";

export function SignInButton({
  returnTo,
  label = "Sign in with ListenBrainz",
}: {
  returnTo?: string;
  label?: string;
}) {
  const href = returnTo
    ? `/auth/login?return=${encodeURIComponent(returnTo)}`
    : "/auth/login";
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
    >
      {label}
    </Link>
  );
}
```

- [ ] **Step 2: Modify SyncButton.tsx — handle 401/402/403 responses**

In `app/u/[username]/stats/SyncButton.tsx`, find the existing `trigger` function (the one that POSTs to `/api/sync/${username}`). It currently looks like:

```ts
async function trigger() {
  seenRef.current = new Set();
  setStream([]);
  setPages(0);
  setError(null);
  setSynced(false);
  await fetch(`/api/sync/${username}`, { method: "POST" });
  startPolling();
}
```

Replace it with:

```ts
async function trigger() {
  seenRef.current = new Set();
  setStream([]);
  setPages(0);
  setError(null);
  setSynced(false);
  setGate(null);
  const res = await fetch(`/api/sync/${username}`, { method: "POST" });
  if (res.status === 401) {
    setGate("signin");
    return;
  }
  if (res.status === 402) {
    setGate("paywall");
    return;
  }
  if (res.status === 403) {
    setGate("forbidden");
    return;
  }
  startPolling();
}
```

Add a `gate` state above the function (near the other useStates):

```ts
const [gate, setGate] = useState<null | "signin" | "paywall" | "forbidden">(null);
```

In the JSX where the existing button is rendered, wrap or replace based on `gate`. Find the existing button block:

```tsx
<Button onClick={trigger} disabled={running} size="sm">
  <RefreshCw size={14} className={running ? "animate-spin" : ""} />
  {running ? "Syncing…" : "Sync now"}
</Button>
```

Replace with:

```tsx
{gate === "signin" ? (
  <Link
    href={`/auth/login?return=${encodeURIComponent(`/u/${username}/stats`)}`}
    className="text-sm font-medium text-primary hover:underline"
  >
    Sign in to sync →
  </Link>
) : gate === "paywall" ? (
  <Link
    href="/pricing"
    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
  >
    Subscribe to sync
  </Link>
) : gate === "forbidden" ? (
  <span className="text-sm text-muted-foreground">Sign in as @{username} to sync</span>
) : (
  <Button onClick={trigger} disabled={running} size="sm">
    <RefreshCw size={14} className={running ? "animate-spin" : ""} />
    {running ? "Syncing…" : "Sync now"}
  </Button>
)}
```

Add `import Link from "next/link";` at the top if it isn't already there.

- [ ] **Step 3: Modify the stats page to gate sync visibility server-side**

In `app/u/[username]/stats/page.tsx`, near the top of the component (after `username` is destructured from params, before the data fetches), add:

```ts
import { getSession } from "@/lib/auth/session";
// ...
const session = await getSession();
const isOwner = session?.lbUsername === username;
```

Find the `<SyncButton username={username} />` render line. Replace with:

```tsx
{isOwner ? (
  <SyncButton username={username} />
) : session ? (
  <p className="text-sm text-muted-foreground">
    Viewing @{username}&apos;s profile. <Link href={`/u/${session.lbUsername}/stats`} className="underline">Your dashboard</Link>.
  </p>
) : (
  <SignInButton returnTo={`/u/${username}/stats`} label="Sign in to sync your own listens" />
)}
```

Add the `Link` and `SignInButton` imports at the top of the file:
```ts
import Link from "next/link";
import { SignInButton } from "@/components/SignInButton";
```
(`Link` may already be imported — leave that.)

- [ ] **Step 4: Typecheck + smoke test**

Run: `npx tsc --noEmit -p tsconfig.json` — clean.

Browser test:
1. Open `http://localhost:3000/u/powerole/stats` in an incognito window (logged out). Sync area should show "Sign in to sync your own listens" CTA.
2. In your normal window (signed in as yourself), visit `/u/powerole/stats`. Sync area should show "Viewing @powerole's profile. Your dashboard."
3. Visit `/u/<your_lb_username>/stats`. SyncButton should render normally.

To exercise the paywall branch, temporarily downgrade yourself again as in Task 5, then click Sync. Expected: button switches to "Subscribe to sync" linking to `/pricing` (which 404s for now — Task 8 builds it).

- [ ] **Step 5: Commit**

```bash
git add components/SignInButton.tsx app/u/[username]/stats/
git commit -m "feat(stats): session-aware sync UI + 402 paywall handling"
```

---

## Task 7: Stripe library + Checkout route

**Files:**
- Create: `lib/stripe.ts`
- Create: `app/api/stripe/checkout/route.ts`

- [ ] **Step 1: Create `lib/stripe.ts`**

```ts
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
```

- [ ] **Step 2: Create `app/api/stripe/checkout/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { getSession } from "@/lib/auth/session";
import { getUserByMbId } from "@/lib/auth/users";
import { stripe, priceId, paymentsConfigured } from "@/lib/stripe";

const Body = z.object({ plan: z.enum(["annual", "lifetime"]) });

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
    cancel_url: `${origin}/pricing`,
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` — clean. If Stripe SDK complains about an `apiVersion` mismatch, accept the default (the SDK picks the latest its types know about; pinning here is unnecessary churn).

- [ ] **Step 4: Commit**

```bash
git add lib/stripe.ts app/api/stripe/checkout/
git commit -m "feat(stripe): client + Checkout session creation route"
```

(No products are configured yet, so the route returns 503 if called. Task 9 creates the products and wires the webhook; at that point this route starts returning real Checkout URLs.)

---

## Task 8: Stripe Customer Portal route + Pricing page + Account page + Homepage + Onboarding

**Files:**
- Create: `app/api/stripe/portal/route.ts`
- Create: `app/pricing/page.tsx`
- Create: `app/account/page.tsx`
- Create: `app/account/AccountActions.tsx`
- Modify: `app/page.tsx`
- Modify: `app/onboarding/page.tsx`

- [ ] **Step 1: Create the Portal route**

`app/api/stripe/portal/route.ts`:

```ts
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
```

- [ ] **Step 2: Create the Pricing page**

`app/pricing/page.tsx`:

```tsx
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
```

And the client child `app/pricing/PricingButtons.tsx`:

```tsx
"use client";

import { useState } from "react";

export function PricingButtons({ plan }: { plan: "annual" | "lifetime" }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? `error ${res.status}`);
        return;
      }
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={go}
        disabled={loading}
        className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
      >
        {loading ? "Loading…" : "Subscribe"}
      </button>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </>
  );
}
```

- [ ] **Step 3: Create the Account page**

`app/account/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { getUserByMbId } from "@/lib/auth/users";
import { paymentsConfigured } from "@/lib/stripe";
import { AccountActions } from "./AccountActions";

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
        <Link href="/pricing" className="underline text-primary">Resubscribe</Link>
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
          <Link href="/pricing" className="underline text-primary">
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
        <Link href="/pricing" className="underline text-primary">
          Subscribe
        </Link>
      )}
    </div>
  );
}
```

And `app/account/AccountActions.tsx`:

```tsx
"use client";

import { useState } from "react";

export function AccountActions({ hasCustomer }: { hasCustomer: boolean }) {
  const [loading, setLoading] = useState<"" | "portal" | "logout">("");

  async function openPortal() {
    setLoading("portal");
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      if (!res.ok) return;
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } finally {
      setLoading("");
    }
  }

  async function logout() {
    setLoading("logout");
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/auth/logout";
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <div className="flex flex-wrap gap-3">
      {hasCustomer && (
        <button
          onClick={openPortal}
          disabled={loading !== ""}
          className="px-3 py-1.5 rounded-md border border-card-border text-sm hover:bg-muted disabled:opacity-60"
        >
          {loading === "portal" ? "Opening…" : "Manage billing"}
        </button>
      )}
      <button
        onClick={logout}
        disabled={loading !== ""}
        className="px-3 py-1.5 rounded-md border border-card-border text-sm hover:bg-muted disabled:opacity-60"
      >
        Sign out
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Update the homepage**

Replace the body of `app/page.tsx` with:

```tsx
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SignInButton } from "@/components/SignInButton";
import { getSession } from "@/lib/auth/session";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string; username?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  const upstreamErr = sp.error === "upstream";
  const authErr = sp.error === "auth";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-xl space-y-10">
        <div className="space-y-3">
          <h1 className="text-5xl font-bold tracking-tight">pulse</h1>
          <p className="text-lg text-muted-foreground">
            Your listening history, visualized. Powered by{" "}
            <a
              href="https://listenbrainz.org"
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              ListenBrainz
            </a>
            .
          </p>
        </div>

        {upstreamErr && (
          <div className="flex gap-3 items-start p-4 rounded-md border border-amber-900/60 bg-amber-950/30 text-amber-100 text-sm">
            <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-400" />
            <div className="space-y-1">
              <p className="font-medium">ListenBrainz looks unreachable right now.</p>
              <p className="text-amber-100/80">
                Try again in a minute. Live status at{" "}
                <a href="https://status.metabrainz.org/" target="_blank" rel="noreferrer" className="underline">
                  status.metabrainz.org
                </a>.
              </p>
            </div>
          </div>
        )}

        {authErr && (
          <div className="p-4 rounded-md border border-amber-900/60 bg-amber-950/30 text-amber-100 text-sm">
            Sign-in failed{sp.reason ? ` (${sp.reason})` : ""}. Please try again.
          </div>
        )}

        {session ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Signed in as <strong className="text-foreground">@{session.lbUsername}</strong>.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href={`/u/${encodeURIComponent(session.lbUsername)}/stats`}>
                <Button size="lg">Your dashboard</Button>
              </Link>
              <Link href="/account">
                <Button size="lg" variant="outline">Account</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <SignInButton />
            <p className="text-sm text-muted-foreground">
              No ListenBrainz account?{" "}
              <Link href="/onboarding" className="text-primary hover:underline">
                See how to set up
              </Link>{" "}
              — takes ~30 seconds once you have your Spotify export.
            </p>
          </div>
        )}

        <form action="/u" className="space-y-3 pt-6 border-t border-border">
          <label className="block text-sm font-medium" htmlFor="username">
            Browse any public profile
          </label>
          <div className="flex gap-2">
            <input
              id="username"
              name="username"
              required
              defaultValue={sp.username ?? ""}
              placeholder="e.g. tordar"
              className="flex-1 border border-border bg-card rounded-md px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" size="lg" variant="outline">View</Button>
          </div>
        </form>
      </div>
    </main>
  );
}
```

`Button` already supports a `variant` prop in this project (check `components/ui/Button.tsx` and use whatever variant it offers for "secondary/outline"; if it's named differently substitute accordingly).

- [ ] **Step 5: Update onboarding final step**

In `app/onboarding/page.tsx`, find the fourth step (`"Come back here and enter your username"`) and replace its `body` content. The new step is:

```ts
{
  title: "Sign in with ListenBrainz",
  body: (
    <>
      Sign in to pulse using your ListenBrainz account. We&apos;ll mirror your listens
      from LB into our database and show you the dashboard. First sync takes a few
      minutes for a large library; subsequent visits are instant.
    </>
  ),
  link: { href: "/auth/login", label: "Sign in with ListenBrainz" },
},
```

Also remove (or update) the bottom-of-page text that says "Already have a ListenBrainz account with data? Go to the username form." It now reads "Already have a ListenBrainz account?" with a link to `/auth/login`.

- [ ] **Step 6: Typecheck + smoke test**

Run: `npx tsc --noEmit -p tsconfig.json` — clean.

Browser:
1. Logged-out homepage shows "Sign in with ListenBrainz" CTA + the "browse any profile" form below.
2. Logged-in homepage shows "Signed in as @you" + Dashboard / Account buttons.
3. `/account` (logged in) shows your status block. Lifetime users see "Lifetime plan — thank you". The "Manage billing" button only appears when `stripeCustomerId` is set (it won't be yet — that's fine).
4. `/pricing` (logged out) shows "Sign in to subscribe" CTAs on both cards. Logged in: "Subscribe" buttons which POST to `/api/stripe/checkout` → 503 ("payments not configured") at this point.
5. `/onboarding` shows the updated step 4 with "Sign in with ListenBrainz" link.

- [ ] **Step 7: Commit**

```bash
git add app/api/stripe/portal/ app/pricing/ app/account/ app/page.tsx app/onboarding/page.tsx
git commit -m "feat(payments): pricing + account pages, portal route, home/onboarding rewire"
```

---

## Task 9: Stripe webhook + product creation + go-live

**Files:**
- Create: `app/api/stripe/webhook/route.ts`

This task creates the webhook handler AND walks through creating the Stripe products and wiring the webhook secret. After this task, payments are end-to-end functional in test mode.

- [ ] **Step 1: Write the webhook route**

`app/api/stripe/webhook/route.ts`:

```ts
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
    currentPeriodEnd = new Date(sub.current_period_end * 1000);
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
  const currentPeriodEnd = new Date(sub.current_period_end * 1000);
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
```

- [ ] **Step 2: Create the two Stripe products**

In the Stripe dashboard (test mode):
1. Products → Add product:
   - Name: "pulse Annual"
   - Pricing: Recurring, $10.00 USD, Yearly
   - Save. Copy the **Price ID** (`price_...`).
2. Products → Add product:
   - Name: "pulse Lifetime"
   - Pricing: One-time, $25.00 USD
   - Save. Copy the **Price ID** (`price_...`).

Update `.env`:
```
STRIPE_PRICE_ANNUAL=price_<annual>
STRIPE_PRICE_LIFETIME=price_<lifetime>
```

Restart the dev server so the env vars are read.

- [ ] **Step 3: Wire the webhook locally with Stripe CLI**

Install Stripe CLI if you don't have it: `brew install stripe/stripe-cli/stripe` (macOS) or follow https://stripe.com/docs/stripe-cli.

Run in a separate terminal:
```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

The CLI prints a signing secret like `whsec_...`. Copy it into `.env`:
```
STRIPE_WEBHOOK_SECRET=whsec_<that one>
```

Restart the dev server. Keep `stripe listen` running.

- [ ] **Step 4: End-to-end subscribe test**

1. In the browser: sign in as yourself (you're `lifetime` from grandfathering — that's fine, the test exercises the flow even though you don't strictly need to subscribe).
2. Actually, for the test, undo grandfathering temporarily:
   ```bash
   psql "$DATABASE_URL" -c "UPDATE users SET subscription_status='trial', trial_ends_at=now()+interval '7 days' WHERE listenbrainz_username='tordar';"
   ```
3. Visit `/pricing` → click "Subscribe" on Annual.
4. Stripe Checkout opens with test mode banner. Use test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP. Submit.
5. Stripe redirects back to `/account?welcome=true`. You should see either the new "Active until …" state, or briefly the "Processing your payment" banner before refreshing.
6. Webhook activity in the `stripe listen` terminal — verify `checkout.session.completed` was received and forwarded.
7. DB check:
   ```bash
   psql "$DATABASE_URL" -c "SELECT listenbrainz_username, subscription_status, subscription_kind, current_period_end FROM users WHERE listenbrainz_username='tordar';"
   ```
   Expected: `subscription_status='active'`, `subscription_kind='annual'`, `current_period_end` ~1 year out.
8. Restore your lifetime grandfathered status:
   ```bash
   psql "$DATABASE_URL" -c "UPDATE users SET subscription_status='lifetime', subscription_kind='lifetime' WHERE listenbrainz_username='tordar';"
   ```

If anything fails: the `stripe listen` output shows the request/response between Stripe and your local server. Most common issue is `STRIPE_WEBHOOK_SECRET` not being read because the dev server wasn't restarted after editing `.env`.

- [ ] **Step 5: Lifetime flow test**

Repeat steps 2–7 of Step 4 but choose Lifetime on `/pricing`. Expected DB end-state: `subscription_status='lifetime'`, `subscription_kind='lifetime'`. Then restore as in step 8.

- [ ] **Step 6: Commit**

```bash
git add app/api/stripe/webhook/
git commit -m "feat(stripe): webhook handler for checkout + subscription lifecycle"
```

Do NOT commit `.env`. Verify with `git status` — `.env` should already be gitignored.

---

## Task 10: Push + production environment configuration

This is the deploy-and-verify-prod task. No code changes.

- [ ] **Step 1: Push**

```bash
git push
```

Vercel auto-deploys. Watch the deployment in the Vercel dashboard.

- [ ] **Step 2: Add production env vars in Vercel**

Project Settings → Environment Variables, add for **Production** scope:
```
METABRAINZ_CLIENT_ID
METABRAINZ_CLIENT_SECRET
METABRAINZ_REDIRECT_URI=https://pulse-lb.vercel.app/auth/callback
JWT_SECRET
STRIPE_SECRET_KEY                  # still test-mode for now
STRIPE_WEBHOOK_SECRET              # see step 3
STRIPE_PRICE_ANNUAL                # same as local for test mode
STRIPE_PRICE_LIFETIME              # same as local for test mode
```

Redeploy after saving (Vercel does this automatically).

- [ ] **Step 3: Create the production webhook endpoint in Stripe**

Stripe Dashboard (test mode for now) → Developers → Webhooks → Add endpoint:
- URL: `https://pulse-lb.vercel.app/api/stripe/webhook`
- Events to send:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Save. Copy the **Signing secret** (`whsec_...`).

Update Vercel env: `STRIPE_WEBHOOK_SECRET=<that one>`. Redeploy.

- [ ] **Step 4: End-to-end prod test**

In an incognito browser, repeat the subscribe + lifetime flow from Task 9 Steps 4–5 against `https://pulse-lb.vercel.app`. DB row for your user gets updated via the prod webhook.

If the OAuth callback fails on prod, the most common reason is `METABRAINZ_REDIRECT_URI` mismatching what's registered in the MB app — fix it in the MB app settings or in Vercel env, redeploy.

- [ ] **Step 5: Switch to live mode (when you're ready to charge real money)**

ONLY do this step after the MetaBrainz email response approves the tier and you're ready to launch:

1. In Stripe dashboard, flip to **Live mode** (top-right toggle).
2. Create the two products again in live mode. Copy the new live price IDs.
3. In Vercel env: replace `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ANNUAL`, `STRIPE_PRICE_LIFETIME` with the live-mode equivalents.
4. Create a new live webhook endpoint pointing at the same `/api/stripe/webhook` URL. Copy the new live signing secret to `STRIPE_WEBHOOK_SECRET`.
5. Redeploy.

This step is reversible — flip back to test keys if anything goes sideways.

- [ ] **Step 6: No commit needed**

This task is configuration-only. Nothing to commit.

---

## Self-review checklist (already run before saving)

**1. Spec coverage:**
- Data model (users + stripe_events, `subscription_status` enum) → Task 1
- MetaBrainz OAuth flow (state cookie, callback, token exchange, userinfo) → Tasks 2 + 3
- Authorization model (gate at sync route only, public reads stay public) → Task 5
- Find-or-create semantics (lifetime preserved on re-sign-in) → Task 2 (`findOrCreateUserFromProfile`)
- Pre-seeding existing users → Task 4
- Stripe Checkout (annual + lifetime, hosted) → Task 7
- Customer Portal → Task 8
- Webhook + idempotency → Task 9
- Soft degradation when env vars missing → Task 7 (`paymentsConfigured()`), referenced in Tasks 7+8+9
- Account page with status block → Task 8
- Pricing page → Task 8
- Homepage logged-in vs logged-out → Task 8
- Onboarding final-step copy → Task 8
- SyncButton 402/401/403 handling → Task 6
- Stats page session-aware UI → Task 6
- Migration + rollout → Tasks 1, 4, 10

Every spec section maps to a task.

**2. Placeholder scan:** No TBDs. All code complete. Tests are manual (matching the codebase's no-test-framework convention) with concrete steps and expected outputs.

**3. Type consistency:**
- `Session` type — defined in Task 2 (`lib/auth/session.ts`), used in Tasks 3, 5, 6, 7, 8, 9.
- `findOrCreateUserFromProfile` signature `(MbProfile) → DbUser` — defined Task 2, called Task 3.
- `isAllowedToSync(user)` — defined Task 2, called Task 5.
- `paymentsConfigured()` — defined Task 7, called Tasks 7, 8.
- `priceId(plan)` — defined Task 7, called Task 7.
- All `session.lbUsername` references match the `lbUsername` field name in the `Session` type.
- All `user.subscriptionStatus` references use the same enum values: `'trial' | 'active' | 'canceled' | 'lifetime'`.
- Webhook event handlers refer to `user_id` in metadata — set in Task 7's Checkout session creation, read in Task 9's handler.

No inconsistencies.
