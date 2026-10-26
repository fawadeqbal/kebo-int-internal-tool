import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // The design system ships as TypeScript source; Next compiles it.
  transpilePackages: ["@kebo/ui"],
  poweredByHeader: false,
  serverExternalPackages: ["puppeteer-core"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
