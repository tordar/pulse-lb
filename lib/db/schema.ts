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
  boolean,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    // Normalized listening source ("spotify", "navidrome", …) derived from
    // LB's additional_info; null when only a generic importer was named.
    source: text("source"),
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
    index("listens_user_inserted").on(t.userName, t.insertedAt),
    // artist_mbids is a uuid[], so the artist-detail lookup has to test array
    // containment — with no GIN index that was a full scan of the whole table
    // (512k rows, ~55MB read, 75ms) on every miss, i.e. on every probe of an
    // MBID we don't have. Measured on production: 75ms -> 0.05ms, 4MB index.
    // Requires the query to use `@>`; `= ANY(...)` cannot use GIN.
    index("listens_artist_mbids_gin").using("gin", t.artistMbids),
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
  // Plays with a known duration. Stored so live ingest can keep
  // duration_coverage_pct exact without rescanning every listen.
  coveredPlays: integer("covered_plays").default(0).notNull(),
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
    // No DEFAULT, deliberately. 0009 needed one to add the column to existing
    // rows and 0010 backfilled them; 0011 then dropped it. With a default, any
    // INSERT that forgets the column silently fills a whole year with zeros —
    // which reads as "duration unknown" everywhere instead of erroring.
    effectiveMs: bigint("effective_ms", { mode: "number" }).notNull(),
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
  // No primary key: agg rows are fully derived (rebuilt via DELETE-by-user +
  // INSERT…GROUP BY, which guarantees uniqueness). The PK on group_key was
  // never read (reads use agg_song_top); dropping it reclaims ~45 MB.
  (t) => [index("agg_song_top").on(t.userName, t.scope, t.plays)],
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
  // No primary key — see agg_song. Reads use agg_artist_top; reclaims ~8 MB.
  (t) => [index("agg_artist_top").on(t.userName, t.scope, t.plays)],
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
    // Lower-cased artist names whose listens fall in this cluster. Clusters
    // can span artists via a shared release group; live ingest uses this to
    // find every artist it must re-read when one of them gets a new listen.
    memberArtists: text("member_artists").array(),
  },
  // No primary key — see agg_song. Reads use agg_album_top; reclaims ~40 MB.
  (t) => [index("agg_album_top").on(t.userName, t.scope, t.plays)],
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
  // Set once the first history import reaches LB's oldest listen. Null means
  // ingest runs in import mode (syncUser + rebuildAll) instead of live mode.
  backfillCompletedAt: timestamp("backfill_completed_at", { withTimezone: true }),
  // Set while an import slice runs, so concurrent ingests don't stack imports.
  // A lease rather than an advisory lock: a lock would hold a pooled
  // connection idle for the whole slice while syncUser and rebuildAll need
  // others from the same small pool. Expires on its own if the function dies.
  importLeaseUntil: timestamp("import_lease_until", { withTimezone: true }),
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
  // Profile option: annotate listen rows with a colored source dot.
  showListenSource: boolean("show_listen_source").default(false).notNull(),
});

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
});

// A festival is an optional grouping of concerts; deleting one ungroups its
// concerts (festival_id → null) rather than deleting them.
export const festivals = pgTable(
  "festivals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userName: text("user_name").notNull(),
    name: text("name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    venue: text("venue"),
    city: text("city"),
    country: text("country"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    notes: text("notes"),
    // A link to the poster image hosted elsewhere; nothing is stored here.
    posterUrl: text("poster_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("festivals_user_start").on(t.userName, t.startDate),
    check("festivals_dates_ordered", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

// One row per artist per date — the same grain as life-calendar's
// concerts.events, so a later export is a straight copy.
export const concerts = pgTable(
  "concerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userName: text("user_name").notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    artistName: text("artist_name").notNull(),
    artistMbid: uuid("artist_mbid"),
    festivalId: uuid("festival_id").references(() => festivals.id, { onDelete: "set null" }),
    venue: text("venue"),
    city: text("city"),
    country: text("country"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    notes: text("notes"),
    setlistUrl: text("setlist_url"),
    confidence: text("confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // nulls not distinct: two venue-less rows for the same artist+date collide.
    unique("concerts_user_date_artist_venue")
      .on(t.userName, t.eventDate, t.artistName, t.venue)
      .nullsNotDistinct(),
    index("concerts_user_mbid").on(t.userName, t.artistMbid),
    index("concerts_user_date").on(t.userName, t.eventDate),
  ],
);

export type Festival = typeof festivals.$inferSelect;
export type Concert = typeof concerts.$inferSelect;
