import { cookies } from "next/headers";
import puppeteer from "puppeteer-core";
import { api, ApiError, SESSION_COOKIE } from "@/lib/api";
import type { FactoryOrder, InvoiceDoc, RevisionDoc, ShipmentDoc } from "@/lib/types-orders";
import { chromiumPath } from "../../chromium";

/**
 * A document as a PDF: the print page (/print/<kind>/<id>) rendered by headless
 * Chromium with the person's own session, on A4 with page numbers. The API is
 * asked first, so someone who may not see the document gets 403/404 without a
 * browser being started. Chromium: see ../../chromium.ts (CHROME_PATH).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = {
  revisions: async (id: string) => {
    const r = await api.get<RevisionDoc>(`/revisions/${id}`);
    return `Quotation ${r.quotation.refNo}-R${r.number}${r.status === "draft" ? " (draft)" : ""}`;
  },
  invoices: async (id: string) => {
    const i = await api.get<InvoiceDoc>(`/invoices/${id}`);
    const kind = i.type === "proforma" ? "Proforma invoice" : "Commercial invoice";
    return i.number ? `${kind} ${i.number}${i.status === "void" ? " (void)" : ""}` : `${kind} ${i.order.refNo} (draft)`;
  },
  shipments: async (id: string) => `Packing list ${(await api.get<ShipmentDoc>(`/shipments/${id}`)).refNo}`,
  "factory-orders": async (id: string) => {
    const fo = await api.get<FactoryOrder>(`/factory-orders/${id}`);
    return `Purchase order ${fo.refNo}${fo.status === "draft" ? " (draft)" : ""}`;
  },
} as const;

/** At most this many Chromiums at once; more requests are told to try again (each one is ~100 MB). */
const MAX_RENDERS = 3;
let rendering = 0;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FOOTER = `<div style="width:100%;padding:0 14mm;font-family:Helvetica,Arial,sans-serif;font-size:7.5px;color:#64748b;display:flex;justify-content:space-between">
  <span class="title"></span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!Object.hasOwn(KINDS, kind) || !UUID.test(id)) return new Response("Not found", { status: 404 });
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return new Response("Sign in first", { status: 401 });

  let name: string;
  try {
    name = await KINDS[kind as keyof typeof KINDS](id);
  } catch (e) {
    if (e instanceof ApiError) return new Response(e.status === 404 ? "Not found" : e.message, { status: e.status });
    throw e;
  }

  const executablePath = chromiumPath();
  if (!executablePath)
    return new Response(
      "PDF download is not set up on this server (no Chromium found; set CHROME_PATH). Use Print → Save as PDF instead.",
      { status: 503 },
    );

  if (rendering >= MAX_RENDERS) return new Response("Busy making other PDFs — please try again in a few seconds.", { status: 503, headers: { "retry-after": "5" } });

  // Render the page from this same server, never from an address taken from the request
  // (behind the proxy that is the public https address, or whatever Host the caller sent).
  const origin = (process.env.PDF_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/$/, "");
  const target = `${origin}/print/${kind}/${id}`;
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
    const page = await browser.newPage();
    const res = await page.goto(target, { waitUntil: "networkidle0", timeout: 30_000 });
    if (!res?.ok() || !new URL(page.url()).pathname.startsWith(`/print/${kind}/`)) {
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
    const file = `${name.replace(/[^\w.() -]+/g, "-")}.pdf`;
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
