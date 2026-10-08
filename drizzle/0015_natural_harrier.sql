ALTER TABLE "agg_album" ADD COLUMN "member_artists" text[];--> statement-breakpoint
ALTER TABLE "agg_alltime" ADD COLUMN "covered_plays" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "backfill_completed_at" timestamp with time zone;
