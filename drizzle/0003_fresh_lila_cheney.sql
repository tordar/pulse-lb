ALTER TABLE "listens" ADD COLUMN "inserted_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "target_listens" integer;--> statement-breakpoint
CREATE INDEX "listens_user_inserted" ON "listens" USING btree ("user_name","inserted_at");