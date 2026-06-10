DROP INDEX "listens_user_listened_at";--> statement-breakpoint
ALTER TABLE "agg_album" DROP CONSTRAINT "agg_album_user_name_scope_group_key_pk";--> statement-breakpoint
ALTER TABLE "agg_artist" DROP CONSTRAINT "agg_artist_user_name_scope_artist_name_pk";--> statement-breakpoint
ALTER TABLE "agg_song" DROP CONSTRAINT "agg_song_user_name_scope_group_key_pk";