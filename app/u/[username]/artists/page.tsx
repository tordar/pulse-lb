import Link from "next/link";
import { Users } from "lucide-react";
import { topArtists } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { Pagination } from "@/components/Pagination";

function artistHref(username: string, artistMbid: string | null): string | null {
  if (!artistMbid) return null;
  return `/u/${encodeURIComponent(username)}/artists/${artistMbid}`;
}

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
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Users size={18} className="text-primary" /> Top artists
        </h2>
        <SearchBox placeholder="Search artists…" />
      </div>

      {items.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground text-sm">
          {query ? `No artists match "${query}".` : "No artists yet — try syncing."}
        </p>
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
