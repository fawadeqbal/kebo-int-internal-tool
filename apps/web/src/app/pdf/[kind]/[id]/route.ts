import { cookies } from "next/headers";
import puppeteer from "puppeteer-core";
import { apiFetch, ApiError, SESSION_COOKIE } from "@/lib/api";
import type { ReportView } from "@/lib/types-deals";
import type { OrderDocument, RevisionDoc } from "@/lib/types-orders";
import { chromiumPath } from "../../chromium";

/**
 * A document as a PDF: its print page rendered by headless Chromium with the
 * person's own session, on A4 with page numbers. The API is asked first, so
 * someone who may not see the document gets 403/404 without a browser being
 * started. Chromium: see ../../chromium.ts (CHROME_PATH).
 *
 *   /pdf/revisions/<revision id>                 quotation
 *   /pdf/proforma|invoice|packing-list/<order id> the order's documents
 *   /pdf/report/summary?from&to&staff            the Reports page (any UUID works in place of "summary")
 *
 * The session is the kebo_session cookie, or `Authorization: Bearer <token>`
 * (the phone app), which is then used as the session cookie while rendering.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** What a session token may look like (it becomes a cookie value). */
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,4096}$/;

/** The API, as the person asking (their token from the cookie or the header). */
async function ask<T>(token: string, path: string, query?: Record<string, string | undefined>): Promise<T> {
  const res = await apiFetch(path, { auth: false, headers: { authorization: `Bearer ${token}` }, query });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body ?? {});
  return body as T;
}

type Target = { name: string; path: string };
type Kind = (id: string, token: string, url: URL) => Promise<Target>;

const orderDocument =
  (kind: "proforma" | "invoice" | "packing-list"): Kind =>
  async (id, token) => {
    const d = await ask<OrderDocument>(token, `/orders/${id}/documents/${kind}`);
    return { name: `${d.title} ${d.number}${d.order.status === "cancelled" ? " (cancelled)" : ""}`, path: `/print/orders/${id}/${kind}` };
  };

const KINDS: Record<string, { id: (id: string) => boolean; target: Kind }> = {
  revisions: {
    id: (id) => UUID.test(id),
    target: async (id, token) => {
      const r = await ask<RevisionDoc>(token, `/revisions/${id}`);
      return { name: `Quotation ${r.quotation.refNo}-R${r.number}${r.status === "draft" ? " (draft)" : ""}`, path: `/print/revisions/${id}` };
    },
  },
  proforma: { id: (id) => UUID.test(id), target: orderDocument("proforma") },
  invoice: { id: (id) => UUID.test(id), target: orderDocument("invoice") },
  "packing-list": { id: (id) => UUID.test(id), target: orderDocument("packing-list") },
  report: {
    id: (id) => id === "summary" || UUID.test(id),
    target: async (_id, token, url) => {
      const pick = (k: string, ok: RegExp) => {
        const v = url.searchParams.get(k);
        return v && ok.test(v) ? v : undefined;
      };
      const q = { from: pick("from", DAY), to: pick("to", DAY), staff: pick("staff", UUID) };
      const r = await ask<ReportView>(token, "/reports", q);
      const qs = new URLSearchParams({ from: r.range.from, to: r.range.to, ...(q.staff ? { staff: q.staff } : {}) });
      return { name: `Sales report ${r.range.from} to ${r.range.to}`, path: `/print/report?${qs}` };
    },
  },
};

/** At most this many Chromiums at once; more requests are told to try again (each one is ~100 MB). */
const MAX_RENDERS = 3;
let rendering = 0;

const FOOTER = `<div style="width:100%;padding:0 14mm;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:#64748b;display:flex;justify-content:space-between">
  <span class="title"></span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!Object.hasOwn(KINDS, kind) || !KINDS[kind].id(id)) return new Response("Not found", { status: 404 });
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer !== undefined && !TOKEN.test(bearer)) return new Response("Sign in first", { status: 401 });
  const session = bearer ?? (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return new Response("Sign in first", { status: 401 });

  let target: Target;
  try {
    target = await KINDS[kind].target(id, session, new URL(req.url));
  } catch (e) {
    if (e instanceof ApiError) return new Response(e.status === 404 ? "Not found" : e.message, { status: e.status === 422 ? 404 : e.status });
    throw e;
  }

  const executablePath = chromiumPath();
  if (!executablePath)
    return new Response("PDF download is not set up on this server (no Chromium found; set CHROME_PATH). Use Print → Save as PDF instead.", { status: 503 });

  if (rendering >= MAX_RENDERS) return new Response("Busy making other PDFs — please try again in a few seconds.", { status: 503, headers: { "retry-after": "5" } });

  // Render the page from this same server, never from an address taken from the request
  // (behind the proxy that is the public https address, or whatever Host the caller sent).
  const origin = (process.env.PDF_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
  const expected = new URL(target.path, origin);
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
      domain: expected.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    });
    const page = await browser.newPage();
    const res = await page.goto(expected.toString(), { waitUntil: "networkidle0", timeout: 30_000 });
    const landed = new URL(page.url());
    if (!res?.ok() || landed.origin !== expected.origin || landed.pathname !== expected.pathname) {
      return new Response("The document could not be rendered. Please try again.", { status: 502 });
    }
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER,
      margin: { top: "14mm", right: "14mm", bottom: "18mm", left: "14mm" },
    });
    const file = `${target.name.replace(/[^\w.() -]+/g, "-")}.pdf`;
    return new Response(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${file}"; filename*=UTF-8''${encodeURIComponent(file)}`,
        "cache-control": "private, no-store",
      },
    });
  } finally {
    rendering--;
    await browser?.close();
  }
}
