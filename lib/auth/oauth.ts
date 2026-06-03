import { z } from "zod";

const AUTHORIZE_URL = "https://musicbrainz.org/oauth2/authorize";
const TOKEN_URL = "https://musicbrainz.org/oauth2/token";
const USERINFO_URL = "https://musicbrainz.org/oauth2/userinfo";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("METABRAINZ_CLIENT_ID"),
    response_type: "code",
    redirect_uri: requireEnv("METABRAINZ_REDIRECT_URI"),
    scope: "profile",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

const TokenResponse = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
});

export async function exchangeCodeForToken(code: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: requireEnv("METABRAINZ_CLIENT_ID"),
    client_secret: requireEnv("METABRAINZ_CLIENT_SECRET"),
    redirect_uri: requireEnv("METABRAINZ_REDIRECT_URI"),
    grant_type: "authorization_code",
    code,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${res.status}`);
  }
  const json = await res.json();
  return TokenResponse.parse(json).access_token;
}

// The MetaBrainz /oauth2/userinfo response. `sub` is the LB/MB username.
// `metabrainz_user_id` is the stable integer we key on.
const UserInfo = z.object({
  sub: z.string(),
  metabrainz_user_id: z.number(),
  email: z.string().email().optional(),
});

export type MbUserInfo = z.infer<typeof UserInfo>;

export async function fetchUserInfo(accessToken: string): Promise<MbUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`OAuth userinfo fetch failed: ${res.status}`);
  }
  return UserInfo.parse(await res.json());
}
