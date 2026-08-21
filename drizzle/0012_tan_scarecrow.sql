-- IF NOT EXISTS because this index was created directly on production first
-- (CONCURRENTLY, to avoid locking a 242MB table); this migration has to be a
-- no-op there while still building it on fresh and self-hosted databases.
CREATE INDEX IF NOT EXISTS "listens_artist_mbids_gin" ON "listens" USING gin ("artist_mbids");
