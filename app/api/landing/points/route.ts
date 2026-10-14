import { connection } from "next/server";
import { encodePayload } from "@/lib/landing/payload";
import { loadShowcasePayload } from "@/lib/landing/query";

// The CDN holds this for an hour, so Neon sees at most ~1 request/hour from the landing page.
export async function GET() {
  await connection();
  const payload = await loadShowcasePayload();
  if (!payload) return new Response(null, { status: 404, headers: { "Cache-Control": "public, s-maxage=300" } });
  return new Response(encodePayload(payload).buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
