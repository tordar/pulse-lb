CREATE TABLE "listens" (
	"user_name" text NOT NULL,
	"listened_at" timestamp with time zone NOT NULL,
	"track_name" text NOT NULL,
	"artist_name" text,
	"release_name" text,
	"recording_mbid" uuid,
	"release_mbid" uuid,
	"release_group_mbid" uuid,
	"artist_mbids" uuid[],
	"caa_id" bigint,
	"caa_release_mbid" uuid,
	"duration_ms" integer,
	CONSTRAINT "listens_user_name_listened_at_track_name_pk" PRIMARY KEY("user_name","listened_at","track_name")
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"length_ms" integer
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"release_group_mbid" uuid,
	"name" text,
	"track_count" integer
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"added" integer DEFAULT 0 NOT NULL,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"user_name" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_listened_at" timestamp with time zone,
	"total_listens" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "listens_user_release_time" ON "listens" USING btree ("user_name","release_mbid","listened_at");--> statement-breakpoint
CREATE INDEX "listens_user_recording" ON "listens" USING btree ("user_name","recording_mbid");--> statement-breakpoint
CREATE INDEX "listens_user_artist" ON "listens" USING btree ("user_name","artist_name");--> statement-breakpoint
CREATE INDEX "listens_user_release_name" ON "listens" USING btree ("user_name","release_name");--> statement-breakpoint
CREATE INDEX "listens_user_listened_at" ON "listens" USING btree ("user_name","listened_at");--> statement-breakpoint
CREATE INDEX "releases_rgid" ON "releases" USING btree ("release_group_mbid");--> statement-breakpoint
CREATE INDEX "sync_jobs_user_started" ON "sync_jobs" USING btree ("user_name","started_at");