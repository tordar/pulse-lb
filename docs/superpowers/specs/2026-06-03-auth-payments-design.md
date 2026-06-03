# Pulse-LB Auth + Payments

**Date:** 2026-06-03
**Status:** Approved — ready for implementation planning

## Problem

Pulse-lb currently has no user accounts. Anyone can navigate to `/u/<lb_username>/stats` and trigger sync via the SyncButton. To launch as a paid SaaS at $10/year with a 7-day trial — the direction in memory — we need:

1. A way to identify "who is signing in" and which LB username they own.
2. A gate on the sync action so unpaid users can't keep adding data to our DB indefinitely.
3. A payment flow (annual subscription + lifetime option).
4. Existing users (`powerole`, `tordar`) preserved without friction.

We do NOT need: gated reads (dashboards stay public — matches Last.fm / ListenBrainz themselves), session management beyond cookies, team accounts, or coupons.

## Goals

- Identify users via MetaBrainz OAuth (same identity provider as the data source).
- Gate the sync route behind a 7-day no-card trial OR active subscription OR lifetime.
- Single Stripe-hosted Checkout flow with two products: annual recurring ($10/yr) and lifetime one-time ($25).
- Preserve `/u/<username>/stats` as a public read surface so the demo link (`/u/tordar/stats`) keeps working.
- Pre-seed existing users with `lifetime` status so they never see a paywall.

## Non-goals

- Waitlist mode / beta toggle. We'll go straight to paid signup once MetaBrainz approves the API tier. Until then, the code ships with a soft-degradation path: missing Stripe env vars → "payments coming soon" placeholder.
- Private dashboards. Stats are public by design.
- Email notifications (trial-ending, payment-failed). Stripe sends its own for failures; trial state is visible in the UI.
- Multiple device sessions / "sign out everywhere".
- Coupons, family plans, proration between annual and lifetime.
- Stripe Elements / embedded checkout. Hosted Checkout only.

## Architecture

Three new layers added to the existing codebase:

```
┌────────────────────────────────────────────────────────────────┐
│  /  (homepage)                                                  │
│   ├─ logged out → "Sign in with ListenBrainz" + public demo     │
│   └─ logged in  → "Go to your dashboard" + "/account"           │
├────────────────────────────────────────────────────────────────┤
│  AUTH LAYER (new)                                               │
│   GET  /auth/login         → MetaBrainz OAuth authorize         │
│   GET  /auth/callback      → upsert user, set JWT cookie        │
│   POST /auth/logout                                             │
│   lib/auth/{session,users}.ts                                   │
├────────────────────────────────────────────────────────────────┤
│  PAYMENTS LAYER (new)                                           │
│   GET  /pricing            → public, two product cards          │
│   GET  /account            → signed-in only, subscription state │
│   POST /api/stripe/checkout                                     │
│   POST /api/stripe/portal                                       │
│   POST /api/stripe/webhook                                      │
├────────────────────────────────────────────────────────────────┤
│  EXISTING (unchanged for unsigned visitors)                     │
│   GET  /u/<lb_username>/stats     PUBLIC                        │
│   GET  /u/<lb_username>/{songs,artists,albums}  PUBLIC          │
│   POST /api/sync/<lb_username>    GATED (NEW)                   │
└────────────────────────────────────────────────────────────────┘
```

The sync gate is the **only** authorization decision in the system. Every read path stays public.

## Data model

Two new tables:

```sql
CREATE TABLE users (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  mb_account_id           INTEGER      UNIQUE NOT NULL,
  listenbrainz_username   TEXT         UNIQUE NOT NULL,
  email                   TEXT,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  trial_ends_at           TIMESTAMPTZ,
  subscription_status     TEXT,          -- 'trial' | 'active' | 'canceled' | 'lifetime' | NULL
  subscription_kind       TEXT,          -- 'annual' | 'lifetime' | NULL
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  current_period_end      TIMESTAMPTZ
);
CREATE INDEX users_lb_username ON users (listenbrainz_username);

-- Webhook idempotency. Stripe retries failed deliveries; we want each event
-- applied exactly once.
CREATE TABLE stripe_events (
  id            TEXT         PRIMARY KEY,
  type          TEXT         NOT NULL,
  processed_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

**Why `mb_account_id` is the stable key:** LB usernames are mutable. A user can rename themselves on MetaBrainz; the integer `mb_account_id` from their OAuth profile never changes. We use it to match incoming OAuth callbacks to existing rows.

**Pre-seeded rows:** one-off script `scripts/grandfather-users.ts` inserts a row for each existing `user_name` in `listens` (`powerole`, `tordar`) with `subscription_status='lifetime'`. The `mb_account_id` is fetched from the public MB profile API at script time. On their first sign-in after launch, the OAuth callback finds the existing row by `mb_account_id` and updates `listenbrainz_username` + `email` from the fresh profile (but does NOT downgrade `subscription_status`).

## MetaBrainz OAuth flow

Standard OAuth 2.0 authorization-code flow against MusicBrainz's OAuth endpoints (the unified identity provider for the whole MetaBrainz family, including ListenBrainz).

```
Authorize: https://musicbrainz.org/oauth2/authorize
Token:     https://musicbrainz.org/oauth2/token
Profile:   https://musicbrainz.org/oauth2/userinfo
```

**Routes added:**

| Route | Method | Behavior |
|---|---|---|
| `/auth/login` | GET | Mint random `state` (32 bytes hex), set `pulse_oauth_state` cookie (10-min TTL, HttpOnly, SameSite=Lax), redirect to MusicBrainz authorize URL with `client_id`, `response_type=code`, `redirect_uri`, `scope=profile`, `state`. |
| `/auth/callback` | GET | Verify state cookie matches `state` query param. Exchange `code` for access token. Fetch profile via `/oauth2/userinfo`. Find-or-create `users` row by `mb_account_id` (see "Find-or-create semantics" below). Sign JWT, set `pulse_session` cookie. Redirect to `/u/<lb_username>/stats`. |
| `/auth/logout` | POST | Clear `pulse_session` cookie. Redirect to `/`. |

**Session cookie:** signed JWT (HS256 via `jose`), payload `{ uid: string, mb_account_id: number, lb_username: string, exp: number }`. 30-day expiry, sliding (refreshed by middleware-style helper on each authenticated request). Cookie attrs: `HttpOnly`, `SameSite=Lax`, `Secure` in production.

**Scope:** `profile` only. Sync uses the public `/user/{name}/listens` LB endpoint which doesn't require an OAuth token, so we don't ask for write/listen scopes.

**Find-or-create semantics in the callback:**
- **Row missing for this `mb_account_id`** (new signup): INSERT with `trial_ends_at = now() + interval '7 days'`, `subscription_status = 'trial'`, `listenbrainz_username` and `email` from the OAuth profile.
- **Row exists** (returning user, including pre-seeded grandfathered accounts): UPDATE `listenbrainz_username` and `email` from the fresh profile. Do NOT touch `trial_ends_at`, `subscription_status`, or any Stripe fields.

This ensures grandfathered `lifetime` users don't get a trial overwriting their status, and lapsed users who return after a cancellation don't get a free trial reset.

**OAuth app registration:**
- Application name: "pulse-lb"
- Redirect URIs:
  - `http://localhost:3000/auth/callback` (local dev)
  - `https://pulse-lb.vercel.app/auth/callback` (production)
- Scopes requested: `profile`

**Environment variables added:**
```
METABRAINZ_CLIENT_ID
METABRAINZ_CLIENT_SECRET
METABRAINZ_REDIRECT_URI          # full URL, varies by env
JWT_SECRET                        # 32+ random bytes, base64
```

## Authorization model

**Read paths:** all stay public. `/u/<lb_username>/stats`, `/u/<lb_username>/{songs,artists,albums}`, all detail pages — no auth required. Anyone can browse anyone's dashboard.

**Write path (the gate):** `POST /api/sync/[username]` adds an early authorization block before the existing job-creation logic:

```ts
const session = await getSession();
if (!session) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
if (session.lb_username !== username) {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

const user = await getUserByMbId(session.mb_account_id);
if (!isAllowedToSync(user)) {
  return NextResponse.json({ error: "subscription_required" }, { status: 402 });
}
```

`isAllowedToSync(user)` returns true when ANY of:
- `user.subscription_status === 'lifetime'`
- `user.subscription_status === 'active'` AND `user.current_period_end > now()`
- `user.subscription_status === 'trial'` AND `user.trial_ends_at > now()`

Otherwise 402, and the SyncButton swaps to a "Subscribe to sync" CTA linking to `/pricing`.

**No middleware-level enforcement.** We do not run an auth middleware over the whole app. Public reads stay public; the two gates are at the write paths (sync route, Stripe routes), checked locally.

**Session helper module:** new file `lib/auth/session.ts` exposing:
```ts
getSession(): Promise<Session | null>           // reads + verifies pulse_session
setSession(session: SessionPayload): Promise<void>
clearSession(): Promise<void>
```

Plus `lib/auth/users.ts` for users-table CRUD: `getUserByMbId`, `getUserByLbUsername`, `upsertFromMbProfile`.

## Stripe integration

**Products (created once in the Stripe dashboard):**
- Annual subscription — $10/year — `STRIPE_PRICE_ANNUAL`
- Lifetime one-time — $25 — `STRIPE_PRICE_LIFETIME`

**Routes:**

| Route | Method | Behavior |
|---|---|---|
| `/api/stripe/checkout` | POST | Body: `{ plan: "annual" \| "lifetime" }`. Requires session. Creates Stripe Checkout Session (subscription or payment mode depending on plan). Returns `{ url }`. Sets `client_reference_id = users.id` and metadata `{ user_id }` so the webhook can match. |
| `/api/stripe/portal` | POST | Requires session + existing `stripe_customer_id`. Creates Customer Portal session. Returns `{ url }`. |
| `/api/stripe/webhook` | POST | Verifies `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`. Dedupes via `stripe_events`. Handles event types below. |
| `/pricing` | GET | Public. Two product cards. If `STRIPE_PRICE_ANNUAL` or `STRIPE_PRICE_LIFETIME` env vars are missing, renders "Payments coming soon" placeholder (soft-degradation for the pre-MB-approval window). |
| `/account` | GET | Requires session. Shows subscription state + actions. |

**Webhook event handling:**

| Event | Action |
|---|---|
| `checkout.session.completed` mode=subscription | Set `subscription_status='active'`, `subscription_kind='annual'`, save `stripe_subscription_id`, `stripe_customer_id`, `current_period_end` |
| `checkout.session.completed` mode=payment | Set `subscription_status='lifetime'`, `subscription_kind='lifetime'`, save `stripe_customer_id` |
| `customer.subscription.updated` | Sync `current_period_end`. If `cancel_at_period_end=true` and we're past the end → `subscription_status='canceled'` |
| `customer.subscription.deleted` | `subscription_status='canceled'`. Sync still allowed until `current_period_end` passes (the gate uses the timestamp) |
| `invoice.payment_failed` | Log. Stripe retries automatically; don't change status on first failure |

All handlers are idempotent: same event ID seen twice = no-op.

**Trial → subscription handoff:** if a user is mid-trial and pays, the webhook flips `subscription_status` to `active` or `lifetime`. The `trial_ends_at` timestamp stays in the row (harmless; gate OR's both conditions).

**Environment variables added:**
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_ANNUAL
STRIPE_PRICE_LIFETIME
```

## UI changes

**Homepage (`/`):**

*Logged out:* hero + primary CTA "Sign in with ListenBrainz" → `/auth/login`. Secondary "see tordar's profile" link. The existing "type any LB username" form stays for public browsing.

*Logged in:* personal greeting, link to own dashboard, link to `/account`.

**Onboarding (`/onboarding`):** the final step copy changes from "type your username" to "Sign in with ListenBrainz". Everything else stays.

**Stats page (`/u/<username>/stats`):**
- Own stats + signed-in → SyncButton visible. Trial banner if mid-trial.
- Own stats + signed-out → "Sign in to sync" CTA replaces SyncButton.
- Someone else's stats → "This is <username>'s profile" notice replaces SyncButton.

**Account page (`/account`):**
- Identity: LB username, email (from MB profile if available).
- Status block, depending on state:
  - Trial → "Trial: N days left. [Subscribe]"
  - Active annual → "Active until <date>. [Manage billing]"
  - Lifetime → "Lifetime plan — thank you 🙂"
  - Canceled → "Canceled. Sync stops <date>. [Resubscribe]"
- "Sign out" button.

**Pricing page (`/pricing`):** two cards (Annual / Lifetime). CTAs route through `/auth/login?return=/pricing` if not signed in. Soft-degradation placeholder when env vars missing.

**SyncButton client component:** one new branch — receives 402 → switches to "Subscribe to sync" CTA linking to `/pricing`. Existing state machine otherwise unchanged.

## Flows

**Signup:**
```
/ (logged out) → "Sign in with ListenBrainz"
→ /auth/login (set state cookie, redirect)
→ MusicBrainz authorize → user grants
→ /auth/callback (verify state, exchange code, fetch profile,
                  upsert user with trial_ends_at = now+7d, set session cookie)
→ /u/<lb_username>/stats (own dashboard, trial banner shown)
```

**Subscribe:**
```
/account → "Subscribe" → /pricing → choose Annual or Lifetime
→ POST /api/stripe/checkout → Stripe-hosted Checkout
→ user pays → Stripe webhook → users row updated
→ redirect /account?welcome=true (polls once if webhook hasn't landed)
→ status now "active" or "lifetime"
```

**Cancel:**
```
/account → "Manage billing" → POST /api/stripe/portal → Stripe Portal
→ user clicks Cancel → webhook fires (cancel_at_period_end=true)
→ /account shows "stops on <date>"
→ Sync still works until current_period_end
→ after timestamp: webhook fires customer.subscription.deleted
→ status = 'canceled', gate denies
```

## Edge cases

- **LB username change at MetaBrainz.** `mb_account_id` is stable. Next sign-in updates `listenbrainz_username` in the row. Old URLs 404. Cookie's cached `lb_username` is refreshed at sign-in; sync route also pulls fresh from DB.
- **Multiple device sessions.** Each device gets its own JWT cookie. Sign-out clears one. No DB session tracking. v1 doesn't support "sign out everywhere".
- **Trial abuse.** Tied to `mb_account_id`. Creating multiple accounts requires multiple MB accounts (multiple emails). High-effort enough not to defend against in code.
- **Public stats links.** Unchanged behavior for `/u/<name>/stats` — no broken URLs.
- **Webhook arriving before user redirects back.** `/account?welcome=true` polls once on render. If `subscription_status` still null, shows "Processing — refresh in a moment." Standard race-condition pattern.
- **Webhook retries.** `stripe_events` table dedupes by event ID.
- **Trial expires mid-sync-chain.** Existing chain finishes (its self-trigger doesn't pass through the gate). Next `POST /api/sync/[username]` from the user hits 402.
- **User cancels mid-trial.** No active subscription to cancel; trial just runs out naturally.
- **Subscription canceled but in grace period.** Gate uses `current_period_end` — sync continues until that timestamp.
- **Vercel preview deployments.** OAuth callback URI must match registered list. We register prod + localhost only. Previews won't support OAuth; users hitting `/auth/login` on a preview get an MB error page. Acceptable for a small SaaS.

## Error handling

- OAuth state mismatch / invalid code → redirect to `/?error=auth&reason=<short>` with friendly banner.
- OAuth provider error (MB returns error param) → same redirect, different reason string.
- Stripe webhook signature mismatch → 400, log, Stripe retries.
- DB write failure in webhook → 500, Stripe retries. `stripe_events` idempotency ensures no double-application.
- User typing nonexistent LB username in the public browse form → existing `/u` route handler already handles this with onboarding redirect; unchanged.

## Migration & rollout

1. Drizzle migration adds `users` + `stripe_events` tables.
2. Add `pgcrypto` extension to the DB if `gen_random_uuid()` isn't already enabled (Neon defaults usually have it).
3. `scripts/grandfather-users.ts` pre-seeds rows for `powerole` and `tordar`. Each row looks up `mb_account_id` via the LB/MB public profile API and inserts with `subscription_status='lifetime'`.
4. Register the MetaBrainz OAuth application. Add redirect URIs (`localhost:3000/auth/callback`, `pulse-lb.vercel.app/auth/callback`). Get `client_id` + `client_secret`.
5. Add env vars to Vercel and `.env`. JWT_SECRET generated via `openssl rand -base64 32`.
6. Ship the code. Sign-in works locally and in prod. Stripe routes degrade gracefully — `/pricing` shows "coming soon" placeholder until prices are configured.
7. Send the MetaBrainz email (drafted separately) asking which tier applies.
8. On MB approval: create Stripe products, set `STRIPE_PRICE_ANNUAL` / `STRIPE_PRICE_LIFETIME` + `STRIPE_WEBHOOK_SECRET` in Vercel, configure webhook endpoint at `https://pulse-lb.vercel.app/api/stripe/webhook` listening for the five event types above.
9. `/pricing` page now shows real buttons. Payments live.

## Risks & mitigations

- **MetaBrainz rejects the project or requires Bronze ($100/mo) immediately.** We have a designed system that ships safely without payments live. Revenue at Bronze requires ~120 paid users to break even — a real constraint. If this happens, we'd consider raising to $20/yr or adding a $50 lifetime to push margin per user up. Decision deferred until MB responds.
- **Stripe webhook delays/failures.** Event ID idempotency + Stripe's automatic retries cover transient issues. `/account?welcome=true` polling handles the user-visible delay window.
- **JWT_SECRET leaks or rotation needed.** All current sessions are invalidated when the secret changes; users re-sign-in. Acceptable for a tiny user base.
- **MB OAuth provider goes down.** Existing signed-in users continue working (cached JWT). New sign-ins fail until provider is back. Sync still works for already-signed-in users.
