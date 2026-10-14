import { NextRequest } from "next/server";
import { parseTs } from "@/lib/landing/build";
import { loadListenAt } from "@/lib/landing/query";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const ts = parseTs(req.nextUrl.searchParams.get("ts"));
  if (ts === null) return Response.json({ error: "bad_ts" }, { status: 400, headers: NO_STORE });
  const listen = await loadListenAt(ts);
  if (!listen) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  // A past listen never changes.
  return Response.json(listen, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable" } });
}
