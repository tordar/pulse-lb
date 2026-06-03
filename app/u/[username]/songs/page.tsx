import Link from "next/link";
import { Music2 } from "lucide-react";
import { topSongs } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { Pagination } from "@/components/Pagination";
import { CoverArt } from "@/components/CoverArt";
import { TopItemCard } from "@/components/TopItemCard";
import { ViewToggle, type View } from "@/components/ViewToggle";

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

type SP = Promise<{ q?: string; page?: string; view?: string }>;

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
  const view: View = sp.view === "list" ? "list" : "grid";

  const { items, hasMore } = await topSongs({ username, query, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Music2 size={18} className="text-primary" /> Top songs
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBox placeholder="Search songs or artists…" />
          <ViewToggle current={view} />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-sm text-muted-foreground gap-3">
          <Music2 size={32} className="text-subtle-foreground" />
          {query ? `No songs match "${query}".` : "No songs yet — try syncing."}
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((s, i) => (
            <li key={`${s.track_name}-${s.artist_name}`}>
              <TopItemCard
                rank={page * 50 + i + 1}
                art={{ caaId: s.caa_id, caaReleaseMbid: s.caa_release_mbid }}
                title={s.track_name}
                subtitle={s.artist_name}
                plays={s.plays}
                effectiveMs={Number(s.effective_ms)}
                href={songHref(username, s.recording_mbid, s.track_name, s.artist_name)}
              />
            </li>
          ))}
        </ul>
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
