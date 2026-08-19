import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signs the sync route's self-continuation hop.
 *
 * The chain re-POSTs to /api/sync/<user> from inside after(), and those calls
 * carry no session cookie — so the route has to let *something* through
 * unauthenticated. It used to be the bare presence of an `x-pulse-chain`
 * header, which meant anyone could POST that header and start an unbounded
 * run of 50 five-minute functions against any username, no account needed.
 * That is a denial-of-wallet hole, and on Neon it is a way to burn someone
 * else's compute quota.
 *
 * The depth is inside the signed payload so a captured token can't be replayed
 * at depth 1 forever to restart the chain.
 */
function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is required to sign sync-chain requests");
  return s;
}

export function signChain(username: string, depth: number): string {
  return createHmac("sha256", secret()).update(`sync-chain:${username}:${depth}`).digest("hex");
}

export function verifyChain(username: string, depth: number, token: string | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(signChain(username, depth), "utf8");
  const got = Buffer.from(token, "utf8");
  // timingSafeEqual throws on a length mismatch, so check that first.
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}
