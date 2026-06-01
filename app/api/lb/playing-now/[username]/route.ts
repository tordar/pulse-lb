import { NextRequest, NextResponse } from "next/server";
import { getPlayingNow } from "@/lib/listenbrainz/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const listen = await getPlayingNow(username).catch(() => null);
  if (!listen) return NextResponse.json({ listen: null });
  const a = listen.track_metadata.additional_info ?? {};
  const m = listen.track_metadata.mbid_mapping ?? {};
  return NextResponse.json(
    {
      listen: {
        track_name: listen.track_metadata.track_name,
        artist_name: listen.track_metadata.artist_name,
        release_name: listen.track_metadata.release_name ?? null,
        caa_id: m.caa_id ?? null,
        caa_release_mbid: m.caa_release_mbid ?? a.release_mbid ?? null,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
