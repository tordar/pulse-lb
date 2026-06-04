import {
  pgTable,
  text,
  timestamp,
  integer,
  bigint,
  uuid,
  primaryKey,
  index,
  date,
  doublePrecision,
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
    // When we inserted this row into our DB (NOT when the user listened).
    // Used for the live "stream of incoming listens" UI during sync —
    // ordering by listened_at can't show backfill activity because backfill
    // is inserting OLDER listens, which never float to the top.
    // Nullable for pre-existing rows; new inserts get DEFAULT now().
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userName, t.listenedAt, t.trackName] }),
    index("listens_user_release_time").on(t.userName, t.releaseMbid, t.listenedAt),
    index("listens_user_recording").on(t.userName, t.recordingMbid),
    index("listens_user_artist").on(t.userName, t.artistName),
    index("listens_user_release_name").on(t.userName, t.releaseName),
    index("listens_user_listened_at").on(t.userName, t.listenedAt),
    index("listens_user_inserted").on(t.userName, t.insertedAt),
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

export const releaseGroups = pgTable(
  "release_groups",
  {
    mbid: uuid("mbid").primaryKey(),
    name: text("name"),
    // MB first-release-date can be partial: "1966", "1966-08" or "1966-08-05",
    // so the raw value is text; the year is derived for range queries.
    firstReleaseDate: text("first_release_date"),
    firstReleaseYear: integer("first_release_year"),
  },
  (t) => [index("release_groups_year").on(t.firstReleaseYear)],
);

export const aggAlltime = pgTable("agg_alltime", {
  userName: text("user_name").primaryKey(),
  totalPlays: integer("total_plays").notNull(),
  effectiveMs: bigint("effective_ms", { mode: "number" }).notNull(),
  distinctArtists: integer("distinct_artists").notNull(),
  distinctAlbums: integer("distinct_albums").notNull(),
  distinctSongs: integer("distinct_songs").notNull(),
  firstPlayed: timestamp("first_played", { withTimezone: true }),
  lastPlayed: timestamp("last_played", { withTimezone: true }),
  durationCoveragePct: doublePrecision("duration_coverage_pct"),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const aggYear = pgTable(
  "agg_year",
  {
    userName: text("user_name").notNull(),
    year: integer("year").notNull(),
    plays: integer("plays").notNull(),
    hours: doublePrecision("hours").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userName, t.year] })],
);

export const aggHour = pgTable(
  "agg_hour",
  {
    userName: text("user_name").notNull(),
    hour: integer("hour").notNull(),
    plays: integer("plays").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userName, t.hour] })],
);

export const aggDay = pgTable(
  "agg_day",
  {
    userName: text("user_name").notNull(),
    date: date("date").notNull(),
    plays: integer("plays").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userName, t.date] })],
);

export const aggSong = pgTable(
  "agg_song",
  {
    userName: text("user_name").notNull(),
    scope: integer("scope"),
    groupKey: text("group_key").notNull(),
    trackName: text("track_name").notNull(),
    artistName: text("artist_name"),
    plays: integer("plays").notNull(),
    effectiveMs: bigint("effective_ms", { mode: "number" }).notNull(),
    caaId: bigint("caa_id", { mode: "number" }),
    caaReleaseMbid: uuid("caa_release_mbid"),
    recordingMbid: uuid("recording_mbid"),
  },
  (t) => [
    primaryKey({ columns: [t.userName, t.scope, t.groupKey] }),
    index("agg_song_top").on(t.userName, t.scope, t.plays),
  ],
);

export const aggArtist = pgTable(
  "agg_artist",
  {
    userName: text("user_name").notNull(),
    scope: integer("scope"),
    artistName: text("artist_name").notNull(),
    plays: integer("plays").notNull(),
    effectiveMs: bigint("effective_ms", { mode: "number" }).notNull(),
    distinctSongs: integer("distinct_songs").notNull(),
    distinctAlbums: integer("distinct_albums").notNull(),
    artistMbid: uuid("artist_mbid"),
    caaId: bigint("caa_id", { mode: "number" }),
    caaReleaseMbid: uuid("caa_release_mbid"),
  },
  (t) => [
    primaryKey({ columns: [t.userName, t.scope, t.artistName] }),
    index("agg_artist_top").on(t.userName, t.scope, t.plays),
  ],
);

export const aggAlbum = pgTable(
  "agg_album",
  {
    userName: text("user_name").notNull(),
    scope: integer("scope"),
    groupKey: text("group_key").notNull(),
    releaseName: text("release_name").notNull(),
    artistName: text("artist_name"),
    plays: integer("plays").notNull(),
    effectiveMs: bigint("effective_ms", { mode: "number" }).notNull(),
    caaId: bigint("caa_id", { mode: "number" }),
    caaReleaseMbid: uuid("caa_release_mbid"),
    releaseMbid: uuid("release_mbid"),
  },
  (t) => [
    primaryKey({ columns: [t.userName, t.scope, t.groupKey] }),
    index("agg_album_top").on(t.userName, t.scope, t.plays),
  ],
);

export const syncState = pgTable("sync_state", {
  userName: text("user_name").primaryKey(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastListenedAt: timestamp("last_listened_at", { withTimezone: true }),
  totalListens: integer("total_listens").default(0).notNull(),
  firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow().notNull(),
  // LB's listen-count for this user at the start of the latest sync, used
  // to compute a sync-progress percentage in the UI. Refreshed on every
  // sync invocation. Null until the first sync runs.
  targetListens: integer("target_listens"),
  lastAggregatedAt: timestamp("last_aggregated_at", { withTimezone: true }),
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

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  mbAccountId: integer("mb_account_id").notNull().unique(),
  listenbrainzUsername: text("listenbrainz_username").notNull().unique(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  subscriptionStatus: text("subscription_status").$type<
    "trial" | "active" | "canceled" | "lifetime"
  >(),
  subscriptionKind: text("subscription_kind").$type<"annual" | "lifetime">(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
});

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
});
