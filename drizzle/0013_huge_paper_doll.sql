CREATE TABLE "concerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_name" text NOT NULL,
	"event_date" date NOT NULL,
	"artist_name" text NOT NULL,
	"artist_mbid" uuid,
	"festival_id" uuid,
	"venue" text,
	"city" text,
	"country" text,
	"lat" double precision,
	"lng" double precision,
	"notes" text,
	"setlist_url" text,
	"confidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concerts_user_date_artist_venue" UNIQUE NULLS NOT DISTINCT("user_name","event_date","artist_name","venue")
);
--> statement-breakpoint
CREATE TABLE "festivals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_name" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"venue" text,
	"city" text,
	"country" text,
	"lat" double precision,
	"lng" double precision,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "festivals_dates_ordered" CHECK ("festivals"."end_date" >= "festivals"."start_date")
);
--> statement-breakpoint
ALTER TABLE "concerts" ADD CONSTRAINT "concerts_festival_id_festivals_id_fk" FOREIGN KEY ("festival_id") REFERENCES "public"."festivals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "concerts_user_mbid" ON "concerts" USING btree ("user_name","artist_mbid");--> statement-breakpoint
CREATE INDEX "concerts_user_date" ON "concerts" USING btree ("user_name","event_date");--> statement-breakpoint
CREATE INDEX "festivals_user_start" ON "festivals" USING btree ("user_name","start_date");