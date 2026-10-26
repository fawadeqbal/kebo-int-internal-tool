import "server-only";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the headless Chromium for PDF downloads lives. In order:
 *
 * 1. `CHROME_PATH` (or `PUPPETEER_EXECUTABLE_PATH`): set this in production,
 *    e.g. `CHROME_PATH=/usr/bin/chromium` after `apt-get install chromium`.
 * 2. A browser already on the computer: Chromium or Google Chrome on Linux and
 *    macOS, and on Windows Google Chrome or Microsoft Edge (Edge comes with
 *    every Windows, so `pnpm dev` there makes PDFs with nothing to install).
 * 3. A Chromium downloaded by Playwright (`npx playwright install chromium`), in
 *    `PLAYWRIGHT_BROWSERS_PATH`, ~/.cache/ms-playwright or /ms-playwright — the
 *    newest one. This is what dev containers and CI usually have.
 *
 * Returns null when none is found; the PDF route then answers 503 and says so.
 */
export function chromiumPath(): string | null {
  const fromEnv = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;

  const windows = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA, "C:\\Program Files", "C:\\Program Files (x86)"]
    .filter((d): d is string => !!d)
    .flatMap((d) => [join(d, "Google", "Chrome", "Application", "chrome.exe"), join(d, "Microsoft", "Edge", "Application", "msedge.exe"), join(d, "Chromium", "Application", "chrome.exe")]);
  const system = [
    ...(process.platform === "win32" ? windows : []),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
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
