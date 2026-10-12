import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything here is per-family, cookie-gated data: render dynamically.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
