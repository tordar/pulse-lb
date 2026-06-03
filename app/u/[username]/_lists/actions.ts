"use server";

import {
  topSongs,
  topAlbums,
  topArtists,
  type ListPageResult,
  type TopSong,
  type TopAlbum,
  type TopArtist,
} from "@/lib/db/queries/topItems";

export type ListKind = "songs" | "albums" | "artists";
export type ListItem = TopSong | TopAlbum | TopArtist;

export async function fetchListPage(
  kind: ListKind,
  username: string,
  query: string,
  page: number,
): Promise<ListPageResult<ListItem>> {
  switch (kind) {
    case "songs":
      return topSongs({ username, query, page });
    case "albums":
      return topAlbums({ username, query, page });
    case "artists":
      return topArtists({ username, query, page });
  }
}
