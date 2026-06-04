"use server";

import { searchAll, type SearchResults } from "@/lib/db/queries/topItems";

export async function globalSearch(username: string, query: string): Promise<SearchResults> {
  return searchAll(username, query);
}
