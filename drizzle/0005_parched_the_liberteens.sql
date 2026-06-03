CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mb_account_id" integer NOT NULL,
	"listenbrainz_username" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"subscription_status" text,
	"subscription_kind" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp with time zone,
	CONSTRAINT "users_mb_account_id_unique" UNIQUE("mb_account_id"),
	CONSTRAINT "users_listenbrainz_username_unique" UNIQUE("listenbrainz_username")
);
