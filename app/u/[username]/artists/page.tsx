import { Users } from "lucide-react";
import { topArtists } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { ViewToggle, type View } from "@/components/ViewToggle";
import { InfiniteList } from "../_lists/InfiniteList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SP = Promise<{ q?: string; view?: string }>;

export default async function ArtistsPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: SP;
}) {
  const { username } = await params;
  const sp = await searchParams;
  const query = sp.q ?? "";
  const view: View = sp.view === "list" ? "list" : "grid";

  const { items, hasMore } = await topArtists({ username, query, page: 0 });

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
      ) : (
        <InfiniteList
          kind="artists"
          view={view}
          username={username}
          query={query}
          initialItems={items}
          initialHasMore={hasMore}
        />
      )}
    </div>
  );
}
