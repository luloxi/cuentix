import type { NextConfig } from "next";

/**
 * Static HTML only. Workers Static Assets serves `out/`.
 * The API is a separate Worker, not a Next.js route handler.
 */
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
