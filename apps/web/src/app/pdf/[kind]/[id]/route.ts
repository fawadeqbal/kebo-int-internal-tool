import { cookies } from "next/headers";
import { apiFetch, ApiError, SESSION_COOKIE } from "@/lib/api";
import type { ReportView } from "@/lib/types-deals";
import type { OrderDocument, RevisionDoc } from "@/lib/types-orders";
import type { PaperDocView } from "@/lib/types-papers";
import { LEDGER_PARTY_KINDS, PAPER_KINDS, type PaperKind, type PaymentPaper } from "@kebo/shared";
import type { LedgerStatement } from "@/lib/types-ledger";
import { attachmentHeaders, pdfName, withChromium } from "../../render";
import { UUID } from "@/lib/ids";
import { copyOf } from "@/components/print/copies";

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
 *   /pdf/voucher-supplier|expense/<id>          a supplier payment's or an expense's voucher (Finance › Payments)
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
    // One shipment's packing list (its packages only), else a version, else the latest.
    const shipment = url.searchParams.get("shipment");
    const q: Record<string, string> | undefined = shipment && UUID.test(shipment) ? { shipment } : v && /^\d{1,3}$/.test(v) ? { v } : undefined;
    const d = await ask<OrderDocument>(token, `/orders/${id}/documents/${kind}`, q);
    return {
      name: `${d.title} ${d.number}${d.paper && d.versions.length > 1 ? ` v${d.paper.version}` : ""}${d.order.status === "cancelled" ? " (cancelled)" : ""}`,
      path: `/print/orders/${id}/${kind}${q ? `?${new URLSearchParams(q)}` : ""}`,
    };
  };

/** A paper the app makes: a version (?v=), which payment, plan item or supplier (?ref=). */
const paper =
  (kind: PaperKind): Kind =>
  async (id, token, url) => {
    const q: Record<string, string> = {};
    for (const k of ["v", "ref", "now"]) {
      const v = url.searchParams.get(k);
      if (v && /^[\w-]{1,60}$/.test(v)) q[k] = v;
    }
    const d = await ask<PaperDocView>(token, `/orders/${id}/papers/${kind}/doc`, q);
    const qs = new URLSearchParams(q);
    return {
      name: `${d.label} ${d.doc.number}${d.paper && d.versions.length > 1 ? ` v${d.paper.version}` : ""}${d.final || d.live ? "" : d.kept ? (d.doc.kind === "payment-request" ? " (not sent)" : "") : " (draft)"}`,
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

/** A supplier payment's or an expense's voucher (Finance › Payments). */
const voucher =
  (kind: "supplier" | "expense"): Kind =>
  async (id, token) => {
    const p = await ask<PaymentPaper>(token, `/treasury/payments/${kind}/${id}/paper`);
    return { name: p.fileName, path: `/print/payments/${kind}/${id}` };
  };

const KINDS: Record<string, { id: (id: string) => boolean; target: Kind }> = {
  "voucher-supplier": { id: (id) => UUID.test(id), target: voucher("supplier") },
  "voucher-expense": { id: (id) => UUID.test(id), target: voucher("expense") },
  ...Object.fromEntries(LEDGER_PARTY_KINDS.map((k) => [`ledger-${k}`, { id: (id: string) => UUID.test(id), target: statement(k) }])),
  ...Object.fromEntries(PAPER_KINDS.map((k) => [k, { id: (id: string) => UUID.test(id), target: paper(k) }])),
  revisions: {
    id: (id) => UUID.test(id),
    target: async (id, token, url) => {
      const r = await ask<RevisionDoc>(token, `/revisions/${id}`);
      // ?sending=1: printed as it goes to the customer (no DRAFT mark), for Share and Email from a draft.
      const sending = url.searchParams.get("sending") === "1";
      return {
        name: `Quotation ${r.quotation.refNo}-R${r.number}${r.status === "draft" && !sending ? " (draft)" : ""}`,
        path: `/print/revisions/${id}${sending ? "?sending=1" : ""}`,
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
    // The copy asked for, when the paper has it (copiesOf): the internal one, or the China customs one (which is
    // always in English + 中文); then the language (English unless chosen).
    const url = new URL(req.url);
    const copy = copyOf(kind, url.searchParams.get("copy"));
    const add = (k: string, v: string) => (target = { ...target, path: `${target.path}${target.path.includes("?") ? "&" : "?"}${k}=${v}` });
    if (copy !== "customer") {
      target = { ...target, name: `${target.name} (${copy === "internal" ? "internal" : "China customs"})` };
      add("copy", copy);
    }
    if (url.searchParams.get("lang") === "zh" && copy !== "customs") add("lang", "zh");
  } catch (e) {
    if (e instanceof ApiError)
      return new Response(e.status === 404 ? "Not found" : e.message, { status: e.status === 422 ? 404 : e.status });
    throw e;
  }

  const out = await withChromium(session, (render) => render(target.path, { report: kind === "report" }));
  if (out instanceof Response) return out;
  return new Response(Buffer.from(out), { headers: attachmentHeaders(pdfName(target.name), "application/pdf") });
}
