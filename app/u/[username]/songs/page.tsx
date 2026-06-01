import Link from "next/link";
import { topSongs } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { Pagination } from "@/components/Pagination";
import { CoverArt } from "@/components/CoverArt";

function songHref(
  username: string,
  recordingMbid: string | null,
  name: string,
  artist: string,
): string | null {
  if (!recordingMbid) return null;
  const qs = new URLSearchParams({ name, artist }).toString();
  return `/u/${encodeURIComponent(username)}/songs/${recordingMbid}?${qs}`;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SP = Promise<{ q?: string; page?: string }>;

export default async function SongsPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: SP;
}) {
  const { username } = await params;
  const sp = await searchParams;
  const page = Math.max(0, parseInt(sp.page ?? "0", 10) || 0);
  const query = sp.q ?? "";

  const { items, hasMore } = await topSongs({ username, query, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">Top songs</h2>
        <SearchBox placeholder="Search songs or artists…" />
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground text-sm">
          {query ? `No songs match "${query}".` : "No songs yet — try syncing."}
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((s, i) => {
            const href = songHref(username, s.recording_mbid, s.track_name, s.artist_name);
            const row = (
              <>
                <span className="w-8 text-right text-sm text-subtle-foreground tabular-nums">
                  {page * 50 + i + 1}
                </span>
                <CoverArt
                  art={{ caaId: s.caa_id, caaReleaseMbid: s.caa_release_mbid }}
                  size={40}
                  alt={s.track_name}
                  className="rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{s.track_name}</div>
                  <div className="truncate text-xs text-muted-foreground">{s.artist_name}</div>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {s.plays.toLocaleString()} plays
                </span>
              </>
            );
            return (
              <li key={`${s.track_name}-${s.artist_name}`}>
                {href ? (
                  <Link
                    href={href}
                    className="flex items-center gap-3 py-2.5 hover:bg-muted -mx-2 px-2 rounded"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 py-2.5">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <Pagination
        basePath={`/u/${encodeURIComponent(username)}/songs`}
        searchParams={sp}
        page={page}
        hasMore={hasMore}
      />
    </div>
  );
}
