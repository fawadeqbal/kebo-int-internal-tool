import { defineConfig } from "@playwright/test";
import { ADMIN_STATE } from "./tests/routes";

const CI = !!process.env.CI;

/**
 * The app as people open it: through the stand-in for Caddy (proxy.mjs: /api → the API, the rest → the web app).
 * In CI the API, the web app and the proxy are started here; on a laptop the running ones are used.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:8080";
/** The counting door of proxy.mjs: the web app's way to the API here, so a page's calls can be counted (page-cost-flows.spec.ts). */
const COUNT_URL = `http://localhost:${process.env.E2E_COUNT_PORT ?? 4001}`;

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: CI ? 3 : 2,
  forbidOnly: CI,
  // A check that passes only on the second try is reported as flaky, so it is seen and fixed.
  retries: CI ? 1 : 0,
  reporter: CI
    ? [
        ["list"],
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["json", { outputFile: "test-results/results.json" }],
      ]
    : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // GitHub's runners have Chrome (E2E_CHANNEL=chrome): no browser download. CHROME_PATH points at another.
    channel: process.env.E2E_CHANNEL || undefined,
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined,
  },
  projects: [
    { name: "setup", testMatch: /setup\.ts$/ },
    { name: "flows", testMatch: /flows\.spec\.ts$/, dependencies: ["setup"], use: { storageState: ADMIN_STATE } },
    { name: "pages", testMatch: /pages\.spec\.ts$/, dependencies: ["setup"], use: { storageState: ADMIN_STATE } },
  ],
  webServer: [
    {
      name: "API",
      command: "node dist/main.js",
      cwd: "../api",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    // Before the web app: its first page already asks the API, through the proxy's counting door.
    {
      name: "Proxy",
      command: "node proxy.mjs",
      url: `${COUNT_URL}/__page-cost/ready`,
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      name: "Web",
      command: "pnpm start",
      cwd: "../web",
      url: "http://localhost:3000/login",
      env: { API_URL: `${COUNT_URL}/api` },
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
  ],
});
