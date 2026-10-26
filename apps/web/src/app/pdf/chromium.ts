import "server-only";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the headless Chromium for PDF downloads lives. In order:
 *
 * 1. `CHROME_PATH` (or `PUPPETEER_EXECUTABLE_PATH`): set this in production,
 *    e.g. `CHROME_PATH=/usr/bin/chromium` after `apt-get install chromium`.
 * 2. A system install: /usr/bin/chromium, chromium-browser, google-chrome(-stable),
 *    /opt/google/chrome/chrome, or Chrome on macOS.
 * 3. A Chromium downloaded by Playwright (`npx playwright install chromium`), in
 *    `PLAYWRIGHT_BROWSERS_PATH`, ~/.cache/ms-playwright or /ms-playwright — the
 *    newest one. This is what dev containers and CI usually have.
 *
 * Returns null when none is found; the PDF route then answers 503 and says so.
 */
export function chromiumPath(): string | null {
  const fromEnv = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;

  const system = [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  const found = system.find((p) => existsSync(p));
  if (found) return found;

  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache", "ms-playwright"), "/ms-playwright"].filter(
    (r): r is string => !!r && existsSync(r),
  );
  for (const root of roots) {
    const dirs = readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const d of dirs) {
      for (const exe of [
        "chrome-linux64/chrome",
        "chrome-linux/chrome",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-win/chrome.exe",
      ]) {
        const p = join(root, d, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}
