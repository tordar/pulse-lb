CREATE TABLE "artist_aliases" (
	"user_name" text NOT NULL,
	"fold" text NOT NULL,
	"artist_mbid" uuid NOT NULL,
	CONSTRAINT "artist_aliases_user_name_fold_pk" PRIMARY KEY("user_name","fold")
);
--> statement-breakpoint
ALTER TABLE "agg_artist" ADD COLUMN "artist_key" text;--> statement-breakpoint
ALTER TABLE "agg_artist" ADD COLUMN "artist_names" text[];