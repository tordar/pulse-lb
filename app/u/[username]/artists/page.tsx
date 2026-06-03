import Link from "next/link";
import { Users } from "lucide-react";
import { topArtists } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { Pagination } from "@/components/Pagination";
import { TopItemCard } from "@/components/TopItemCard";
import { ViewToggle, type View } from "@/components/ViewToggle";

function artistHref(username: string, artistMbid: string | null): string | null {
  if (!artistMbid) return null;
  return `/u/${encodeURIComponent(username)}/artists/${artistMbid}`;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SP = Promise<{ q?: string; page?: string; view?: string }>;

export default async function ArtistsPage({
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

  const { items, hasMore } = await topArtists({ username, query, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Users size={18} className="text-primary" /> Top artists
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBox placeholder="Search artists…" />
          <ViewToggle current={view} />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-sm text-muted-foreground gap-3">
          <Users size={32} className="text-subtle-foreground" />
          {query ? `No artists match "${query}".` : "No artists yet — try syncing."}
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((a, i) => (
            <li key={a.artist_name}>
              <TopItemCard
                rank={page * 50 + i + 1}
                art={{ caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid }}
                artShape="circle"
                title={a.artist_name}
                subtitle={`${a.distinct_tracks.toLocaleString()} songs · ${a.distinct_albums.toLocaleString()} albums`}
                plays={a.plays}
                effectiveMs={Number(a.effective_ms)}
                href={artistHref(username, a.artist_mbid)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((a, i) => {
            const href = artistHref(username, a.artist_mbid);
            const row = (
              <>
                <span className="w-8 text-right text-sm text-subtle-foreground tabular-nums">
                  {page * 50 + i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{a.artist_name}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {a.distinct_tracks.toLocaleString()} songs · {a.distinct_albums.toLocaleString()} albums
                  </div>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {a.plays.toLocaleString()} plays
                </span>
              </>
            );
            return (
              <li key={a.artist_name}>
                {href ? (
                  <Link
                    href={href}
                    className="flex items-center gap-3 py-3 hover:bg-muted -mx-2 px-2 rounded"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 py-3">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <Pagination
        basePath={`/u/${encodeURIComponent(username)}/artists`}
        searchParams={sp}
        page={page}
        hasMore={hasMore}
      />
    </div>
  );
}
