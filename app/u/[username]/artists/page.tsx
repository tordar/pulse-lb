import { topArtists } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { Pagination } from "@/components/Pagination";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SP = Promise<{ q?: string; page?: string }>;

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

  const { items, hasMore } = await topArtists({ username, query, page });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">Top artists</h2>
        <SearchBox placeholder="Search artists…" />
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center text-gray-500 text-sm">
          {query ? `No artists match "${query}".` : "No artists yet — try syncing."}
        </p>
      ) : (
        <ol className="divide-y divide-gray-100 dark:divide-zinc-800">
          {items.map((a, i) => (
            <li key={a.artist_name} className="flex items-center gap-3 py-3">
              <span className="w-8 text-right text-sm text-gray-400 tabular-nums">
                {page * 50 + i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">{a.artist_name}</div>
                <div className="text-xs text-gray-500 tabular-nums">
                  {a.distinct_tracks.toLocaleString()} songs · {a.distinct_albums.toLocaleString()} albums
                </div>
              </div>
              <span className="shrink-0 text-sm tabular-nums text-gray-600 dark:text-gray-400">
                {a.plays.toLocaleString()} plays
              </span>
            </li>
          ))}
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
