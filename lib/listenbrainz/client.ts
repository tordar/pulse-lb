import { z } from "zod";

const LB_BASE = "https://api.listenbrainz.org";

const AdditionalInfo = z
  .object({
    duration_ms: z.number().nullish(),
    recording_mbid: z.string().nullish(),
    release_mbid: z.string().nullish(),
    release_group_mbid: z.string().nullish(),
    artist_mbids: z.array(z.string()).nullish(),
  })
  .passthrough();

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

async function lbFetch(path: string, opts: { token?: string; timeoutMs?: number } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Token ${opts.token}`;
  const r = await fetch(`${LB_BASE}${path}`, {
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
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
