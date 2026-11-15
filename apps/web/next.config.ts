import path from "node:path";
import type { NextConfig } from "next";

/** Features no page may use (the API sends the same). */
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

const config: NextConfig = {
  output: "standalone",
  // In the monorepo the standalone server must trace files from the repo root.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // The design system ships as TypeScript source; Next compiles it.
  transpilePackages: ["@kebo/ui"],
  poweredByHeader: false,
  serverExternalPackages: ["puppeteer-core", "exceljs"],
  // Inquiries used to be called deals: old links and bookmarks still open.
  async redirects() {
    return [
      { source: "/deals", destination: "/inquiries", permanent: true },
      { source: "/deals/:path*", destination: "/inquiries/:path*", permanent: true },
      // Security's tabs are pages under People & access (design page 33); the query (?panel=, ?person=…) goes along.
      { source: "/security", destination: "/access/roles", permanent: false },
      { source: "/security/:path*", destination: "/access/:path*", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Nothing in the app uses the camera, the microphone, the location, payments in the browser or USB.
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
        ],
      },
      // A file of an order may show inside the app itself (Documents v3: View opens here), never elsewhere.
      {
        source: "/files/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      // The print pages may show inside the app itself (the Make page's preview of a paper), never elsewhere.
      {
        source: "/print/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default config;
