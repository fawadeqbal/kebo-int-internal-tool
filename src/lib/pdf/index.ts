import { existsSync } from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";

/**
 * HTML → PDF with headless Chrome.
 *
 * The PDF is the app's own print page (/print/quotations/:id, /print/invoices/:id)
 * printed by a real browser engine, so it is identical to what staff see on
 * screen and in "Print / Save as PDF". Nothing is laid out twice.
 *
 * Chrome is found automatically: CHROME_PATH (or PUPPETEER_EXECUTABLE_PATH) if
 * set, otherwise the usual Chrome / Edge / Chromium install locations. The
 * Docker image ships Chromium.
 */

const RENDER_TIMEOUT_MS = 30_000;
const MAX_PARALLEL = 2;

function candidates(): string[] {
  const env = [process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH].filter(Boolean) as string[];
  if (process.platform === "win32") {
    const roots = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean) as string[];
    return [
      ...env,
      ...roots.map((r) => path.join(r, "Google", "Chrome", "Application", "chrome.exe")),
      ...roots.map((r) => path.join(r, "Microsoft", "Edge", "Application", "msedge.exe")),
    ];
  }
  if (process.platform === "darwin") {
    return [...env, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
  }
  return [...env, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge"];
}

export class PdfUnavailableError extends Error {
  constructor() {
    super("PDF download needs Google Chrome, Microsoft Edge or Chromium on the server. Install one, or set CHROME_PATH to its location.");
  }
}

export function findChrome(): string | null {
  return candidates().find((p) => existsSync(p)) ?? null;
}

/* One browser for the whole server, started on first use and restarted if it dies. */
const globalForPdf = globalThis as unknown as { pdfBrowser?: Promise<Browser> };

async function getBrowser(): Promise<Browser> {
  const existing = globalForPdf.pdfBrowser;
  if (existing) {
    const browser = await existing.catch(() => null);
    if (browser?.connected) return browser;
  }
  const executablePath = findChrome();
  if (!executablePath) throw new PdfUnavailableError();
  const launching = puppeteer.launch({
    executablePath,
    headless: true,
    // The sandbox needs kernel features a container usually lacks. The browser
    // only ever opens this app's own pages (every other request is blocked below).
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none", "--no-first-run"],
  });
  globalForPdf.pdfBrowser = launching;
  launching.then((b) => b.on("disconnected", () => (globalForPdf.pdfBrowser = undefined))).catch(() => (globalForPdf.pdfBrowser = undefined));
  return launching;
}

/* A tiny queue so a burst of downloads can't start dozens of tabs at once. */
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Where the browser reaches this app from inside the server (never the public URL). */
export function renderBaseUrl() {
  return (process.env.PDF_RENDER_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
}

/**
 * Print one of the app's pages to an A4 PDF as the signed-in user.
 * `pagePath` must be an app path such as "/print/invoices/<id>".
 */
export async function renderPdf({
  pagePath,
  sessionCookie,
  footerLabel,
  landscape = false,
}: {
  pagePath: string;
  sessionCookie: { name: string; value: string };
  footerLabel: string;
  /** Wide reports print on landscape A4. */
  landscape?: boolean;
}): Promise<Uint8Array> {
  if (!pagePath.startsWith("/print/")) throw new Error("Only print pages can be rendered");
  const base = renderBaseUrl();
  const origin = new URL(base).origin;

  return slot(async () => {
    const browser = await getBrowser();
    // A fresh, private context per document: no cookies leak between users.
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith(origin) || url.startsWith("data:") || url.startsWith("blob:")) void req.continue();
        else void req.abort();
      });
      await context.setCookie({ name: sessionCookie.name, value: sessionCookie.value, domain: new URL(base).hostname, path: "/", secure: false, httpOnly: true, sameSite: "Lax" });

      const response = await page.goto(`${base}${pagePath}`, { waitUntil: "networkidle0", timeout: RENDER_TIMEOUT_MS });
      if (!response || !response.ok() || new URL(page.url()).pathname !== pagePath.split("?")[0]) {
        throw new Error(`Could not open the document page (${response?.status() ?? "no response"})`);
      }
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const footer = footerLabel.replace(/[<>&"]/g, "");
      return await page.pdf({
        format: "A4",
        landscape,
        printBackground: true,
        // Same margins as the print stylesheet, set here so landscape reports work too.
        preferCSSPageSize: false,
        margin: { top: "14mm", bottom: "14mm", left: landscape ? "12mm" : "14mm", right: landscape ? "12mm" : "14mm" },
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="width:100%;padding:0 ${landscape ? 12 : 14}mm;font-family:Arial,sans-serif;font-size:7.5px;color:#8a8a8a;display:flex;justify-content:space-between"><span>${footer}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
        timeout: RENDER_TIMEOUT_MS,
      });
    } finally {
      await context.close().catch(() => undefined);
    }
  });
}

/** A safe "attachment" header with a readable file name, e.g. "QUO-2026-0019 Gulf Cosmetics.pdf". */
export function pdfHeaders(fileName: string, inline: boolean) {
  const clean = fileName.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "document";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return {
    "Content-Type": "application/pdf",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(clean)}.pdf`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
