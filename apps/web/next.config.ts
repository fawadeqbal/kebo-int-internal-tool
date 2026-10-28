import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  // In the monorepo the standalone server must trace files from the repo root.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The design system ships as TypeScript source; Next compiles it.
  transpilePackages: ["@kebo/ui"],
  poweredByHeader: false,
  serverExternalPackages: ["puppeteer-core", "exceljs"],
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
