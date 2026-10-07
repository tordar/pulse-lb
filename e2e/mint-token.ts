// Prints a 1-hour owner session token for `tordar`, plus one real mbid per
// detail kind, as JSON. Reads DATABASE_URL and JWT_SECRET from .env. Output is
// a secret: write it under the scratchpad and delete it after the run.
import "dotenv/config";
import postgres from "postgres";
import { SignJWT } from "jose";

const s = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
const [u] = await s`select id, mb_account_id from users where listenbrainz_username = 'tordar'`;
const [a] = await s`select artist_mbid from agg_artist where user_name = 'tordar' and scope = 0 and artist_mbid is not null order by plays desc limit 1`;
const [r] = await s`select release_mbid from agg_album where user_name = 'tordar' and scope = 0 and release_mbid is not null order by plays desc limit 1`;
const [g] = await s`select recording_mbid from agg_song where user_name = 'tordar' and scope = 0 and recording_mbid is not null order by plays desc limit 1`;
await s.end();
const tok = await new SignJWT({ uid: u.id, mbAccountId: Number(u.mb_account_id), lbUsername: "tordar" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
console.log(JSON.stringify({ tok, artist: a.artist_mbid, release: r.release_mbid, rec: g.recording_mbid }));
