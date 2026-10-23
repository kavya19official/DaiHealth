import type { NextConfig } from "next";
const config: NextConfig = {
  output: process.env.DAI_LOCAL === "true" ? undefined : "standalone",
  distDir: process.env.DAI_NEXT_DIST_DIR || ".next",
  basePath: process.env.NEXT_PUBLIC_DAI_BASE_PATH || "",
  turbopack: { root: process.cwd() },
  webpack(config, { dev }) {
    // Local laptops and mounted drives can exhaust native filesystem watchers.
    if (dev && process.env.DAI_LOCAL === "true") {
      config.watchOptions = { ...config.watchOptions, poll: 1000, aggregateTimeout: 300 };
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_ORIGIN || "http://127.0.0.1:8000"}/api/:path*`,
      },
    ];
  },
};
export default config;
