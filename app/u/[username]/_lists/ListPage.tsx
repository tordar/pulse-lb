import { Suspense } from "react";
import { Disc3, Music2, Users, type LucideIcon } from "lucide-react";
import { topAlbums, topArtists, topSongs } from "@/lib/db/queries/topItems";
import { SearchBox } from "@/components/SearchBox";
import { ViewToggle, type View } from "@/components/ViewToggle";
import { ControlsSkeleton, ListSkeleton } from "@/components/Skeletons";
import { InfiniteList } from "./InfiniteList";

type Kind = "songs" | "albums" | "artists";
type Params = Promise<{ username: string }>;
type SP = Promise<{ q?: string; view?: string }>;

const KINDS: Record<Kind, { title: string; Icon: LucideIcon; placeholder: string; shape: "square" | "circle" }> = {
  songs: { title: "Top songs", Icon: Music2, placeholder: "Search songs or artists…", shape: "square" },
  albums: { title: "Top albums", Icon: Disc3, placeholder: "Search albums or artists…", shape: "square" },
  artists: { title: "Top artists", Icon: Users, placeholder: "Search artists…", shape: "circle" },
};

const LOAD = { songs: topSongs, albums: topAlbums, artists: topArtists } as const;

/**
 * Songs, albums and artists share one page. The heading is static (App Shell);
 * the controls and the list depend on URL data and stream in — or arrive with
 * the tab's prefetch, so a tab switch shows real rows straight away.
 */
export function ListPage({ kind, params, searchParams }: { kind: Kind; params: Params; searchParams: SP }) {
  const { title, Icon, shape } = KINDS[kind];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-xl font-semibold inline-flex items-center gap-2">
          <Icon size={18} className="text-primary" /> {title}
        </h2>
        <Suspense fallback={<ControlsSkeleton />}>
          <Controls kind={kind} searchParams={searchParams} />
        </Suspense>
      </div>
      <Suspense fallback={<ListSkeleton shape={shape} view="grid" />}>
        <ListContent kind={kind} params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Controls({ kind, searchParams }: { kind: Kind; searchParams: SP }) {
  const sp = await searchParams;
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <SearchBox placeholder={KINDS[kind].placeholder} />
      <ViewToggle current={sp.view === "list" ? "list" : "grid"} />
    </div>
  );
}

async function ListContent({ kind, params, searchParams }: { kind: Kind; params: Params; searchParams: SP }) {
  const [{ username }, sp] = await Promise.all([params, searchParams]);
  const view: View = sp.view === "list" ? "list" : "grid";
  return <CachedList kind={kind} username={username} query={sp.q ?? ""} view={view} />;
}

async function CachedList({ kind, username, query, view }: { kind: Kind; username: string; query: string; view: View }) {
  const { Icon } = KINDS[kind];
  const { items, hasMore } = await LOAD[kind]({ username, query, page: 0 });
  if (items.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center text-sm text-muted-foreground gap-3">
        <Icon size={32} className="text-subtle-foreground" />
        {query ? `No ${kind} match "${query}".` : `No ${kind} yet — try syncing.`}
      </div>
    );
  }
  return (
    <InfiniteList
      kind={kind}
      view={view}
      username={username}
      query={query}
      initialItems={items}
      initialHasMore={hasMore}
    />
  );
}
