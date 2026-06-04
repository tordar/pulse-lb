ALTER TABLE "listens" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "show_listen_source" boolean DEFAULT false NOT NULL;