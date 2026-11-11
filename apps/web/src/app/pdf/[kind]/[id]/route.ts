import { cookies } from "next/headers";
import { apiFetch, ApiError, SESSION_COOKIE } from "@/lib/api";
import type { ReportView } from "@/lib/types-deals";
import type { OrderDocument, RevisionDoc } from "@/lib/types-orders";
import type { PaperDocView } from "@/lib/types-papers";
import { LEDGER_PARTY_KINDS, PAPER_KINDS, type PaperKind } from "@kebo/shared";
import type { LedgerStatement } from "@/lib/types-ledger";
import { attachmentHeaders, pdfName, withChromium } from "../../render";
import { UUID } from "@/lib/ids";

/**
 * A document as a PDF: its print page rendered by headless Chromium with the
 * person's own session, on A4 with page numbers. The API is asked first, so
 * someone who may not see the document gets 403/404 without a browser being
 * started. Chromium: see ../../chromium.ts (CHROME_PATH).
 *
 *   /pdf/revisions/<revision id>                 quotation
 *   /pdf/proforma|invoice|packing-list/<order id> the order's documents
 *   /pdf/<paper>/<order id>?v=&ref=              a paper the app makes (sales-contract, commercial-invoice…)
 *   /pdf/report/summary?from&to&staff            the Reports page (any UUID works in place of "summary")
 *   /pdf/ledger-customer|factory|staff/<id>?from&to&cur&no   a statement of account (Finance › Ledger)
 *
 * The session is the kebo_session cookie, or `Authorization: Bearer <token>`
 * (the phone app), which is then used as the session cookie while rendering.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/** The proforma or the packing list: a version (?v=), else the latest. */
const orderDocument =
  (kind: "proforma" | "packing-list"): Kind =>
  async (id, token, url) => {
    const v = url.searchParams.get("v");
    const q = v && /^\d{1,3}$/.test(v) ? { v } : undefined;
    const d = await ask<OrderDocument>(token, `/orders/${id}/documents/${kind}`, q);
    return {
      name: `${d.title} ${d.number}${d.paper && d.versions.length > 1 ? ` v${d.paper.version}` : ""}${d.order.status === "cancelled" ? " (cancelled)" : ""}`,
      path: `/print/orders/${id}/${kind}${q ? `?v=${q.v}` : ""}`,
    };
  };

/** A paper the app makes: a version (?v=), which payment, plan item or factory (?ref=). */
const paper =
  (kind: PaperKind): Kind =>
  async (id, token, url) => {
    const q: Record<string, string> = {};
    for (const k of ["v", "ref"]) {
      const v = url.searchParams.get(k);
      if (v && /^[\w-]{1,60}$/.test(v)) q[k] = v;
    }
    const d = await ask<PaperDocView>(token, `/orders/${id}/papers/${kind}/doc`, q);
    const qs = new URLSearchParams(q);
    return {
      name: `${d.label} ${d.doc.number}${d.paper && d.versions.length > 1 ? ` v${d.paper.version}` : ""}${d.final || d.live ? "" : " (draft)"}`,
      path: `/print/orders/${id}/${kind}${qs.size ? `?${qs}` : ""}`,
    };
  };

/** A party's statement of account: the period, the currency, the number it was issued with. */
const statement =
  (kind: string): Kind =>
  async (id, token, url) => {
    const q: Record<string, string> = {};
    for (const [k, ok] of [
      ["from", DAY],
      ["to", DAY],
      ["cur", /^[A-Z]{3}$/],
      ["no", /^\d{1,5}$/],
    ] as const) {
      const v = url.searchParams.get(k);
      if (v && ok.test(v)) q[k] = v;
    }
    const s = await ask<LedgerStatement>(token, `/ledger/parties/${kind}/${id}/statement`, { from: q.from, to: q.to, currency: q.cur, no: q.no });
    const qs = new URLSearchParams(q);
    return { name: s.share.fileName, path: `/print/ledger/${kind}/${id}${qs.size ? `?${qs}` : ""}` };
  };

const KINDS: Record<string, { id: (id: string) => boolean; target: Kind }> = {
  ...Object.fromEntries(LEDGER_PARTY_KINDS.map((k) => [`ledger-${k}`, { id: (id: string) => UUID.test(id), target: statement(k) }])),
  ...Object.fromEntries(PAPER_KINDS.map((k) => [k, { id: (id: string) => UUID.test(id), target: paper(k) }])),
  revisions: {
    id: (id) => UUID.test(id),
    target: async (id, token) => {
      const r = await ask<RevisionDoc>(token, `/revisions/${id}`);
      return {
        name: `Quotation ${r.quotation.refNo}-R${r.number}${r.status === "draft" ? " (draft)" : ""}`,
        path: `/print/revisions/${id}`,
      };
    },
  },
  proforma: { id: (id) => UUID.test(id), target: orderDocument("proforma") },
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
    // Priced documents: the internal copy (every price, cost and payment) when asked for.
    if ((kind === "revisions" || kind === "proforma") && new URL(req.url).searchParams.get("copy") === "internal") {
      target = { name: `${target.name} (internal)`, path: `${target.path}${target.path.includes("?") ? "&" : "?"}copy=internal` };
    }
  } catch (e) {
    if (e instanceof ApiError)
      return new Response(e.status === 404 ? "Not found" : e.message, { status: e.status === 422 ? 404 : e.status });
    throw e;
  }

  const out = await withChromium(session, (render) => render(target.path, { report: kind === "report" }));
  if (out instanceof Response) return out;
  return new Response(Buffer.from(out), { headers: attachmentHeaders(pdfName(target.name), "application/pdf") });
}
