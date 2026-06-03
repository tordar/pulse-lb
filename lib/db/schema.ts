import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  uuid,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

export const listens = pgTable(
  "listens",
  {
    userName: text("user_name").notNull(),
    listenedAt: timestamp("listened_at", { withTimezone: true }).notNull(),
    trackName: text("track_name").notNull(),
    artistName: text("artist_name"),
    releaseName: text("release_name"),
    recordingMbid: uuid("recording_mbid"),
    releaseMbid: uuid("release_mbid"),
    releaseGroupMbid: uuid("release_group_mbid"),
    artistMbids: uuid("artist_mbids").array(),
    caaId: bigint("caa_id", { mode: "number" }),
    caaReleaseMbid: uuid("caa_release_mbid"),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    primaryKey({ columns: [t.userName, t.listenedAt, t.trackName] }),
    index("listens_user_release_time").on(t.userName, t.releaseMbid, t.listenedAt),
    index("listens_user_recording").on(t.userName, t.recordingMbid),
    index("listens_user_artist").on(t.userName, t.artistName),
    index("listens_user_release_name").on(t.userName, t.releaseName),
    index("listens_user_listened_at").on(t.userName, t.listenedAt),
  ],
);

export const recordings = pgTable("recordings", {
  mbid: uuid("mbid").primaryKey(),
  name: text("name"),
  lengthMs: integer("length_ms"),
});

export const releases = pgTable(
  "releases",
  {
    mbid: uuid("mbid").primaryKey(),
    releaseGroupMbid: uuid("release_group_mbid"),
    name: text("name"),
    trackCount: integer("track_count"),
  },
  (t) => [index("releases_rgid").on(t.releaseGroupMbid)],
);

export const syncState = pgTable("sync_state", {
  userName: text("user_name").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastListenedAt: timestamp("last_listened_at", { withTimezone: true }),
  totalListens: integer("total_listens").default(0).notNull(),
  firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow().notNull(),
});

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: text("id").primaryKey(),
    userName: text("user_name").notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "error">().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    added: integer("added").default(0).notNull(),
    pagesFetched: integer("pages_fetched").default(0).notNull(),
    errorMessage: text("error_message"),
  },
  (t) => [index("sync_jobs_user_started").on(t.userName, t.startedAt)],
);
