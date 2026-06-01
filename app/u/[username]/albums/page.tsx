import { topAlbums } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { Pagination } from "@/components/Pagination";
import { CoverArt } from "@/components/CoverArt";
import { ViewToggle, type View } from "@/components/ViewToggle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SP = Promise<{ q?: string; page?: string; view?: string }>;

export default async function AlbumsPage({
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

  const { items, hasMore } = await topAlbums({ username, query, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">Top albums</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBox placeholder="Search albums or artists…" />
          <ViewToggle current={view} />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center text-gray-500 text-sm">
          {query ? `No albums match "${query}".` : "No albums yet — try syncing."}
        </p>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((a) => (
            <li key={`${a.release_name}-${a.artist_name}`} className="space-y-2">
              <CoverArt
                art={{ caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid }}
                size={240}
                alt={a.release_name}
                className="w-full h-auto aspect-square rounded-md"
              />
              <div className="space-y-0.5">
                <div className="truncate text-sm font-medium">{a.release_name}</div>
                <div className="truncate text-xs text-gray-500">{a.artist_name}</div>
                <div className="text-xs text-gray-400 tabular-nums">{a.plays.toLocaleString()} plays</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ol className="divide-y divide-gray-100 dark:divide-zinc-800">
          {items.map((a, i) => (
            <li key={`${a.release_name}-${a.artist_name}`} className="flex items-center gap-3 py-2.5">
              <span className="w-8 text-right text-sm text-gray-400 tabular-nums">
                {page * 50 + i + 1}
              </span>
              <CoverArt
                art={{ caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid }}
                size={48}
                alt={a.release_name}
                className="rounded"
              />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">{a.release_name}</div>
                <div className="truncate text-xs text-gray-500">{a.artist_name}</div>
              </div>
              <span className="shrink-0 text-sm tabular-nums text-gray-600 dark:text-gray-400">
                {a.plays.toLocaleString()} plays
              </span>
            </li>
          ))}
        </ol>
      )}

      <Pagination
        basePath={`/u/${encodeURIComponent(username)}/albums`}
        searchParams={sp}
        page={page}
        hasMore={hasMore}
      />
    </div>
  );
}
