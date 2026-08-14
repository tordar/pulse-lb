import { NextRequest } from "next/server";
import { COVER_SIZES, coverArtUrl, type CoverSize } from "@/lib/listenbrainz/coverArt";

/**
 * Cover art proxy.
 *
 * Covers used to go through next/image, which meant every thumbnail counted as
 * a billed image transformation — Vercel started answering the whole grid with
 * 402 once the allowance ran out. There was little to transform anyway:
 * archive.org already serves the exact _thumb250/500/1200 we ask for, so this
 * route just fetches that file and hands it back behind an immutable cache. A
 * caa_id names one unchanging image, hence the year-long max-age: the CDN
 * serves every visitor after the first, and archive.org — which is slow, goes
 * down and rate-limits by IP — sees one request per cover.
 *
 * mbid and caaId are matched strictly so this cannot be pointed at anything
 * other than a cover-art file.
 */

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAA_ID = /^[0-9]{1,15}$/;
const UPSTREAM_TIMEOUT_MS = 8000;

/**
 * No body, and only a short cache: <CoverArt> renders its ♪ placeholder on a
 * failed load, and an archive.org blip must not stick to a cover for a year.
 */
function miss(status: number): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "public, max-age=60" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ mbid: string; caaId: string }> },
) {
  const { mbid, caaId } = await params;
  if (!MBID.test(mbid) || !CAA_ID.test(caaId)) return miss(400);

  const asked = Number(req.nextUrl.searchParams.get("s"));
  const size = (COVER_SIZES as readonly number[]).includes(asked)
    ? (asked as CoverSize)
    : 250;

  const upstream = coverArtUrl({ caaReleaseMbid: mbid, caaId: Number(caaId) }, size);
  if (!upstream) return miss(400);

  let res: Response;
  try {
    res = await fetch(upstream, {
      headers: { accept: "image/*" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // Our own Cache-Control is what keeps this cheap; letting Next also try
      // to memoize the bytes would just push a binary at its data cache.
      cache: "no-store",
    });
  } catch {
    return miss(504);
  }

  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !type.startsWith("image/")) {
    return miss(res.status === 404 ? 404 : 502);
  }

  const length = res.headers.get("content-length");
  return new Response(res.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(length ? { "Content-Length": length } : {}),
    },
  });
}
