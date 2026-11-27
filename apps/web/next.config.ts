import path from "node:path";
import type { NextConfig } from "next";

/** Features no page may use (the API sends the same). */
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

/**
 * A second wall in the browser, watched first (report-only): what a page may load and from where. Each thing it
 * would block is sent to POST /api/telemetry/csp and shows in Dev tools › Speed and errors; once nothing real is
 * reported, the header becomes Content-Security-Policy. Next's own inline scripts need 'unsafe-inline' (no nonces
 * yet); Cloudflare's robot check (Turnstile) serves the public forms.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "report-uri /api/telemetry/csp",
].join("; ");

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
      // Suppliers are called suppliers (Words, 18 Nov 2026): old links and bookmarks still open.
      { source: "/factories", destination: "/suppliers", permanent: true },
      { source: "/factories/:path*", destination: "/suppliers/:path*", permanent: true },
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
          { key: "Content-Security-Policy-Report-Only", value: CSP },
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
