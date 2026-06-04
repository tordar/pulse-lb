import { z } from "zod";

const LB_PRIMARY = "https://api.listenbrainz.org";
const LB_FALLBACK = "https://beta-api.listenbrainz.org";
// Healthy primary responds in <1s. If it doesn't answer in 2s, we'd rather
// pay one beta call than wait it out — across 200 pages of pagination, a
// 5s timeout vs 2s timeout adds ~10 minutes of wall-clock to a backfill.
const PRIMARY_TIMEOUT_MS = 2_000;

const AdditionalInfo = z
  .object({
    duration_ms: z.number().nullish(),
    recording_mbid: z.string().nullish(),
    release_mbid: z.string().nullish(),
    release_group_mbid: z.string().nullish(),
    artist_mbids: z.array(z.string()).nullish(),
    music_service: z.string().nullish(),
    music_service_name: z.string().nullish(),
    media_player: z.string().nullish(),
    submission_client: z.string().nullish(),
  })
  .passthrough();

// Importer/scrobbler names that say nothing about where the music played.
const GENERIC_SUBMITTERS = /listenbrainz|archive importer|scrobbler|^web$/i;

/**
 * Derive a normalized listening source from a listen's additional_info.
 * Preference: music_service (the actual service) > media_player (the app)
 * > submission_client (the scrobbler). Generic importers resolve to null.
 */
export function normalizeSource(a: {
  music_service?: string | null;
  music_service_name?: string | null;
  media_player?: string | null;
  submission_client?: string | null;
}): string | null {
  for (const raw of [a.music_service, a.music_service_name, a.media_player, a.submission_client]) {
    if (!raw) continue;
    const v = raw.trim().toLowerCase();
    if (!v || GENERIC_SUBMITTERS.test(v)) continue;
    if (v.includes("spotify")) return "spotify";
    if (v.includes("navidrome")) return "navidrome";
    if (v.includes("apple")) return "apple music";
    if (v.includes("youtube")) return "youtube music";
    if (v.includes("tidal")) return "tidal";
    if (v.includes("deezer")) return "deezer";
    if (v.includes("jellyfin") || v.includes("finamp")) return "jellyfin";
    if (v.includes("plex")) return "plex";
    if (v.includes("soundcloud")) return "soundcloud";
    if (v.includes("funkwhale")) return "funkwhale";
    if (v.includes("bandcamp")) return "bandcamp";
    if (v.includes("last.fm") || v.includes("lastfm")) return "last.fm";
    // Unknown but specific client — keep it, minus any domain suffix.
    return v.replace(/\.(com|org|net|io|fm|app)$/, "");
  }
  return null;
}

const MbidMapping = z
  .object({
    recording_mbid: z.string().nullish(),
    release_mbid: z.string().nullish(),
    release_group_mbid: z.string().nullish(),
    artist_mbids: z.array(z.string()).nullish(),
    caa_id: z.number().nullish(),
    caa_release_mbid: z.string().nullish(),
  })
  .passthrough();

export const ListenSchema = z.object({
  listened_at: z.number(),
  track_metadata: z.object({
    track_name: z.string(),
    artist_name: z.string(),
    release_name: z.string().nullish(),
    additional_info: AdditionalInfo.optional(),
    mbid_mapping: MbidMapping.optional(),
  }),
});

export type Listen = z.infer<typeof ListenSchema>;

const ListensResponse = z.object({
  payload: z.object({
    count: z.number(),
    listens: z.array(ListenSchema),
  }),
});

const ListenCountResponse = z.object({
  payload: z.object({ count: z.number() }),
});

// playing-now records have no listened_at (the play hasn't ended) so we
// validate them with a relaxed shape.
const PlayingNowListen = z.object({
  playing_now: z.boolean().optional(),
  track_metadata: ListenSchema.shape.track_metadata,
});

const PlayingNowResponse = z.object({
  payload: z.object({
    listens: z.array(PlayingNowListen),
    playing_now: z.boolean(),
  }),
});

const ValidateTokenResponse = z.object({
  code: z.number(),
  message: z.string(),
  valid: z.boolean(),
  user_name: z.string().optional(),
});

export class LBError extends Error {
  constructor(public status: number, public body: string, public headers: Headers) {
    super(`LB ${status}: ${body.slice(0, 200)}`);
  }
  get rateLimitResetIn(): number | null {
    const v = this.headers.get("x-ratelimit-reset-in");
    return v ? Number(v) : null;
  }
  get isRateLimit() {
    return this.status === 429;
  }
}

/**
 * Fetch from LB with a primary-then-beta fallback. The main api host
 * (api.listenbrainz.org) goes down occasionally; the beta API
 * (beta-api.listenbrainz.org) usually stays up during those outages.
 *
 * Flow:
 *   1. Try primary with a tight 5s timeout
 *   2. If primary returns a 4xx (incl. 404 for missing users) → propagate.
 *      4xx is a real answer from LB, not an availability issue.
 *   3. If primary returns 5xx OR throws (network/timeout) → fall through
 *      to beta with the full request timeout.
 *
 * Exported so the metadata batch helpers can reuse the same logic.
 */
export async function lbFetch(path: string, opts: { token?: string; timeoutMs?: number } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Token ${opts.token}`;
  const fullTimeout = opts.timeoutMs ?? 60_000;

  try {
    const r = await fetch(`${LB_PRIMARY}${path}`, {
      headers,
      signal: AbortSignal.timeout(Math.min(PRIMARY_TIMEOUT_MS, fullTimeout)),
    });
    if (r.status < 500) {
      if (!r.ok) throw new LBError(r.status, await r.text(), r.headers);
      return r;
    }
    // 5xx — fall through to beta
  } catch (e) {
    // 4xx errors must propagate (real answer from LB).
    // Network / timeout / 5xx fall through to beta.
    if (e instanceof LBError) throw e;
  }

  const r = await fetch(`${LB_FALLBACK}${path}`, {
    headers,
    signal: AbortSignal.timeout(fullTimeout),
  });
  if (!r.ok) throw new LBError(r.status, await r.text(), r.headers);
  return r;
}

export async function getListens(opts: {
  username: string;
  count?: number;
  minTs?: number;
  maxTs?: number;
  token?: string;
}): Promise<Listen[]> {
  const params = new URLSearchParams({ count: String(opts.count ?? 1000) });
  if (opts.minTs != null) params.set("min_ts", String(opts.minTs));
  if (opts.maxTs != null) params.set("max_ts", String(opts.maxTs));
  const r = await lbFetch(`/1/user/${opts.username}/listens?${params}`, { token: opts.token });
  return ListensResponse.parse(await r.json()).payload.listens;
}

export async function getListenCount(username: string): Promise<number | null> {
  try {
    const r = await lbFetch(`/1/user/${username}/listen-count`);
    return ListenCountResponse.parse(await r.json()).payload.count;
  } catch (e) {
    if (e instanceof LBError && e.status === 404) return null;
    throw e;
  }
}

export type PlayingNowListenT = z.infer<typeof PlayingNowListen>;

export async function getPlayingNow(username: string): Promise<PlayingNowListenT | null> {
  const r = await lbFetch(`/1/user/${username}/playing-now`);
  const j = PlayingNowResponse.parse(await r.json());
  return j.payload.listens[0] ?? null;
}

export async function validateToken(token: string): Promise<{ valid: boolean; userName?: string }> {
  const r = await lbFetch("/1/validate-token", { token });
  const j = ValidateTokenResponse.parse(await r.json());
  return { valid: j.valid, userName: j.user_name };
}
