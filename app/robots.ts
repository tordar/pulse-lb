import type { MetadataRoute } from "next";

/**
 * There was no robots.txt at all, and /u/<user>/songs/<mbid> is one URL per
 * track in a library — tens of thousands of them, each a live database read.
 * Crawlers were walking that space one page at a time, which is what kept the
 * Neon endpoint from ever scaling to zero.
 *
 * The list pages stay indexable (there are three per user). The enumerable
 * detail space, anything behind auth, and every query-string variant of a list
 * (search terms, pagination, the name/artist hints) do not.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/auth/",
          "/account",
          "/u/*/songs/",
          "/u/*/albums/",
          "/u/*/artists/",
          // Every ?q=/?page=/?view= permutation of a list is the same data in a
          // different order — crawling them multiplies the work for nothing.
          "/*?",
        ],
      },
    ],
  };
}
