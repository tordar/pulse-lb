import type { NextConfig } from "next";

// Cover art is served same-origin by app/api/cover, so no remote host has to be
// allowed here and nothing goes through the (billed) image optimizer.
const nextConfig: NextConfig = {
  // Reaching `next dev` from a phone means hitting it by LAN IP, which is a
  // different origin than localhost — Next then blocks its own /_next dev
  // resources, React never hydrates and every button on the page is dead
  // while links still work. Private ranges only, and dev-only: production is
  // same-origin and ignores this.
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", "172.16.*.*"],
  cacheComponents: true,
  partialPrefetching: true,
  // /u/<name> has no page of its own; Stats is the profile's front door.
  async redirects() {
    return [{ source: "/u/:username", destination: "/u/:username/stats", permanent: false }];
  },
};

export default nextConfig;
