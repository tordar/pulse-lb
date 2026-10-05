# Concerts in pulse-lb — design

## Goal

Show which artists the user has seen live, and when and where, next to their
listening stats. pulse-lb becomes the source of truth for concert data:
seeded once from `concert-history/concerts.json`, then edited in the UI.

## Decisions

- **Scope:** "Seen live" on artist pages, a seen-count badge on Top Artists,
  and a `/u/<username>/concerts` timeline. No listening-around-the-gig charts.
- **Ingest:** a one-off CLI import script. No upload UI.
- **Editing:** in pulse-lb, owner only. Add, edit, delete concerts and festivals.
- **Export to life-calendar:** later, by a manual script. Out of scope here,
  but the schema carries every life-calendar field so the export is a copy.
- **Artist linking:** match the name against the user's own library at import
  and on edit; store the MBID. No MusicBrainz lookups.
- **Festivals:** a separate, optional grouping. The import never creates them;
  rows import flat. Several artists on the same night is normal and does not
  imply a festival.
- **Map:** deferred to a later pass (104 of 122 rows have coordinates).

## Data model

Two new tables, one Drizzle migration (`drizzle/0013_*`).

### `festivals`

| column | type | notes |
|---|---|---|
| `id` | uuid pk, default random | |
| `user_name` | text not null | owner, same key as `listens.user_name` |
| `name` | text not null | e.g. "Øya 2019" |
| `start_date` | date not null | |
| `end_date` | date not null | check `end_date >= start_date` |
| `venue`, `city`, `country` | text | |
| `lat`, `lng` | double precision | |
| `notes` | text | |
| `created_at`, `updated_at` | timestamptz not null default now() | |

Index: `(user_name, start_date)`.

### `concerts`

One row per artist per date. A festival with nine artists is nine rows.

| column | type | notes |
|---|---|---|
| `id` | uuid pk, default random | stable id for the future export |
| `user_name` | text not null | |
| `event_date` | date not null | |
| `artist_name` | text not null | as entered / imported |
| `artist_mbid` | uuid | null when unmatched |
| `festival_id` | uuid, fk → `festivals.id` on delete set null | |
| `venue`, `city`, `country` | text | |
| `lat`, `lng` | double precision | |
| `notes`, `setlist_url`, `confidence` | text | |
| `created_at`, `updated_at` | timestamptz not null default now() | |

Indexes:
- unique `(user_name, event_date, artist_name, venue) nulls not distinct` —
  matches life-calendar's key, makes the import idempotent.
- `(user_name, artist_mbid)` — artist page and badge lookups.
- `(user_name, event_date)` — timeline.

A festival's concerts must have `event_date` between its `start_date` and
`end_date`. Enforced in the server action, not the database.

Deleting a festival ungroups its concerts (`on delete set null`); it does not
delete them.

## Artist matcher — `lib/concerts/match.ts`

`matchArtist(userName, name) → { mbid, artistName } | null`

- Normalise: lowercase, strip accents (`normalize('NFD')` + remove combining
  marks), collapse whitespace, drop a leading "the ".
- Compare against the user's `agg_artist` all-time rows that have a non-null
  `artist_mbid`. Exact normalised match only; no fuzzy matching.
- If several MBIDs share one normalised name, pick the one with most plays.

The pure normalise/compare part takes a candidate list, so it is unit-testable
without a database.

## Import — `scripts/import-concerts.ts`

`npx tsx scripts/import-concerts.ts <lb-username> <path/to/concerts.json>`

- Reads `{ concerts: [...] }`; maps `date → event_date`, `artist → artist_name`,
  and copies venue, city, country, lat, lng, confidence, notes, setlist_url.
- Runs the matcher per row.
- Upserts on the unique key; on conflict updates every field except `id`,
  `festival_id` and `artist_mbid` when the existing value is non-null
  (re-imports must not undo UI edits to links or festival grouping).
- Never creates festivals.
- Prints: inserted / updated counts, then the unmatched artist names.
- Wraps the run in one transaction.

## Viewing

All read paths are public, like the rest of `/u/<username>`.

- **Artist page** (`app/u/[username]/artists/[artistMbid]/page.tsx`): a
  "Seen live" section listing date, venue, city; festival sets read
  "Øya 2019 · Thu 8 Aug". Hidden when there are none.
- **Top Artists** (`app/u/[username]/artists/page.tsx`): a small "seen N×"
  badge per artist with concerts. One grouped query by `artist_mbid` for the
  page, not one per row.
- **`/u/[username]/concerts`**: timeline, newest first, grouped by year.
  - A standalone concert is one line: date, artist, venue, city.
  - A festival is one card ("Øya 2019 · 7–10 Aug · 9 artists") that expands
    to its artists grouped by day.
  - Matched artists link to their artist page; unmatched ones are plain text.
  - New "Concerts" tab in `PillNav`.

## Editing

Owner only: `getSession()?.lbUsername === username`, checked in every server
action (not only in the UI). Lives on `/concerts`.

- **Add concert / edit concert** form: date, artist, venue, city, country,
  notes, setlist URL, optional festival.
  - Artist input autocompletes from the user's `agg_artist`; picking one sets
    `artist_mbid`. Free text is allowed and runs the matcher on save.
- **Add festival / edit festival** form: name, start/end date, venue, city,
  country, notes.
  - On a festival card: "Add artist" (artist + day picker limited to the
    festival's days, default first day).
- **Move to festival**: on any standalone concert, pick a festival whose date
  range contains the concert's date.
- **Delete** (concert or festival) asks for confirmation inline.
- After any write, `revalidatePath` the concerts page and the affected artist
  page.

## Testing

- Unit tests for the matcher's normalise/compare with `node --test` via `tsx`
  (no new test dependency).
- Import run against a Neon branch, then a re-run to confirm it is idempotent.
- Render `/u/<user>/concerts`, an artist page with concerts, one without, and
  Top Artists against that branch, and check them visually — tsc and build
  have missed broken pages before, and Next serves errors as 200.
- Do not open stats pages on the dev server against prod (it triggers
  aggregate rebuilds).
- Delete the Neon branch afterwards.

## Out of scope

- Export back to life-calendar.
- Upload-based import for other users.
- Map view.
- MusicBrainz lookups for never-played artists.
- Listening-around-the-gig charts.
