import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "archive.org" },
      { protocol: "https", hostname: "**.archive.org" },
    ],
    // Covers are fetched through the optimizer so browsers never talk to
    // archive.org directly — it goes down, rate-limits by IP, and a page paints
    // dozens of thumbs at once. A caa_id names an immutable image, so cache for
    // a year and let one origin fetch serve every visitor.
    minimumCacheTTL: 31536000,
  },
};

export default nextConfig;
