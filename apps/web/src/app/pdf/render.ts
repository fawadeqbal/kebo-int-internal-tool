import "server-only";
import puppeteer from "puppeteer-core";
import { SESSION_COOKIE } from "@/lib/api";
import { chromiumPath } from "./chromium";

/** At most this many Chromiums at once; more requests are told to try again (each one is ~100 MB). */
const MAX_RENDERS = 3;
let rendering = 0;

const FOOTER = `<div style="width:100%;padding:0 14mm;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:#64748b;display:flex;justify-content:space-between">
  <span class="title"></span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

/** Renders one print page of this server as a PDF ("report": the plain layout with our footer). */
export type Render = (path: string, opts?: { report?: boolean }) => Promise<Uint8Array>;

/**
 * Starts one headless Chromium with the person's session and hands `fn` a way
 * to render print pages with it (one or several: a paper set uses one browser).
 * Answers a Response instead when there is no Chromium or too many are busy.
 * Pages are rendered from this same server, never from an address taken from
 * the request (behind the proxy that is the public https address, or whatever
 * Host the caller sent).
 */
export async function withChromium<T>(session: string, fn: (render: Render) => Promise<T>): Promise<T | Response> {
  const executablePath = chromiumPath();
  if (!executablePath)
    return new Response(
      "PDF download needs Google Chrome, Microsoft Edge or Chromium on the server, and none was found (or set CHROME_PATH to one). Meanwhile use Print → Save as PDF.",
      { status: 503 },
    );
  if (rendering >= MAX_RENDERS)
    return new Response("Busy making other PDFs — please try again in a few seconds.", { status: 503, headers: { "retry-after": "5" } });
  const origin = (process.env.PDF_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
  rendering++;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    });
    await browser.setCookie({
      name: SESSION_COOKIE,
      value: session,
      domain: new URL(origin).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });
    const b = browser;
    return await fn(async (path, opts) => {
      const expected = new URL(path, origin);
      const page = await b.newPage();
      try {
        const res = await page.goto(expected.toString(), { waitUntil: "networkidle0", timeout: 30_000 });
        const landed = new URL(page.url());
        if (!res?.ok() || landed.origin !== expected.origin || landed.pathname !== expected.pathname) throw new RenderError();
        await page.evaluate(() => document.fonts.ready);
        return await page.pdf(
          !opts?.report
            ? // Kebo's own document layout: its page margins and footer (page numbers) come from its @page rule.
              { format: "A4", printBackground: true, preferCSSPageSize: true }
            : {
                format: "A4",
                printBackground: true,
                displayHeaderFooter: true,
                headerTemplate: "<span></span>",
                footerTemplate: FOOTER,
                margin: { top: "14mm", right: "14mm", bottom: "18mm", left: "14mm" },
              },
        );
      } finally {
        await page.close().catch(() => undefined);
      }
    });
  } catch (e) {
    if (e instanceof RenderError) return new Response("The document could not be rendered. Please try again.", { status: 502 });
    throw e;
  } finally {
    rendering--;
    await browser?.close();
  }
}

export class RenderError extends Error {
  constructor() {
    super("The document could not be rendered.");
  }
}

/** A file name a browser keeps as it is. */
export const pdfName = (name: string) => `${name.replace(/[^\w.() -]+/g, "-")}.pdf`;

export const attachmentHeaders = (file: string, type: string) => ({
  "content-type": type,
  "content-disposition": `attachment; filename="${file.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(file)}`,
  "cache-control": "private, no-store",
});
