CREATE TABLE "agg_album" (
	"user_name" text NOT NULL,
	"scope" integer,
	"group_key" text NOT NULL,
	"release_name" text NOT NULL,
	"artist_name" text,
	"plays" integer NOT NULL,
	"effective_ms" bigint NOT NULL,
	"caa_id" bigint,
	"caa_release_mbid" uuid,
	"release_mbid" uuid,
	CONSTRAINT "agg_album_user_name_scope_group_key_pk" PRIMARY KEY("user_name","scope","group_key")
);
--> statement-breakpoint
CREATE TABLE "agg_alltime" (
	"user_name" text PRIMARY KEY NOT NULL,
	"total_plays" integer NOT NULL,
	"effective_ms" bigint NOT NULL,
	"distinct_artists" integer NOT NULL,
	"distinct_albums" integer NOT NULL,
	"distinct_songs" integer NOT NULL,
	"first_played" timestamp with time zone,
	"last_played" timestamp with time zone,
	"duration_coverage_pct" double precision,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agg_artist" (
	"user_name" text NOT NULL,
	"scope" integer,
	"artist_name" text NOT NULL,
	"plays" integer NOT NULL,
	"effective_ms" bigint NOT NULL,
	"distinct_songs" integer NOT NULL,
	"distinct_albums" integer NOT NULL,
	"artist_mbid" uuid,
	"caa_id" bigint,
	"caa_release_mbid" uuid,
	CONSTRAINT "agg_artist_user_name_scope_artist_name_pk" PRIMARY KEY("user_name","scope","artist_name")
);
--> statement-breakpoint
CREATE TABLE "agg_day" (
	"user_name" text NOT NULL,
	"date" date NOT NULL,
	"plays" integer NOT NULL,
	CONSTRAINT "agg_day_user_name_date_pk" PRIMARY KEY("user_name","date")
);
--> statement-breakpoint
CREATE TABLE "agg_hour" (
	"user_name" text NOT NULL,
	"hour" integer NOT NULL,
	"plays" integer NOT NULL,
	CONSTRAINT "agg_hour_user_name_hour_pk" PRIMARY KEY("user_name","hour")
);
--> statement-breakpoint
CREATE TABLE "agg_song" (
	"user_name" text NOT NULL,
	"scope" integer,
	"group_key" text NOT NULL,
	"track_name" text NOT NULL,
	"artist_name" text,
	"plays" integer NOT NULL,
	"effective_ms" bigint NOT NULL,
	"caa_id" bigint,
	"caa_release_mbid" uuid,
	"recording_mbid" uuid,
	CONSTRAINT "agg_song_user_name_scope_group_key_pk" PRIMARY KEY("user_name","scope","group_key")
);
--> statement-breakpoint
CREATE TABLE "agg_year" (
	"user_name" text NOT NULL,
	"year" integer NOT NULL,
	"plays" integer NOT NULL,
	"hours" double precision NOT NULL,
	CONSTRAINT "agg_year_user_name_year_pk" PRIMARY KEY("user_name","year")
);
--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "last_aggregated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agg_album_top" ON "agg_album" USING btree ("user_name","scope","plays");--> statement-breakpoint
CREATE INDEX "agg_artist_top" ON "agg_artist" USING btree ("user_name","scope","plays");--> statement-breakpoint
CREATE INDEX "agg_song_top" ON "agg_song" USING btree ("user_name","scope","plays");