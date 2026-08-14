import type { NextConfig } from "next";

// Cover art is served same-origin by app/api/cover, so no remote host has to be
// allowed here and nothing goes through the (billed) image optimizer.
const nextConfig: NextConfig = {};

export default nextConfig;
