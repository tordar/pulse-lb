CREATE TABLE "release_groups" (
	"mbid" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"first_release_date" text,
	"first_release_year" integer
);
--> statement-breakpoint
CREATE INDEX "release_groups_year" ON "release_groups" USING btree ("first_release_year");