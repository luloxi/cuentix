import type { NextConfig } from "next";

/**
 * Static export served by Workers Static Assets. The OpenNext runtime config
 * lives in legacy/wrangler.opennext.jsonc and is not part of this build.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
