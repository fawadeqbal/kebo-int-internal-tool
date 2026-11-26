import { notFound } from "next/navigation";
import Link from "next/link";
import { can, isPaperKind, paperDateText, PAPER_LABEL, PAPER_STEP, portsOf, STEP_PATH } from "@kebo/shared";
import { buttonClass, Card } from "@kebo/ui";
import { api, ApiError } from "@/lib/api";
import { load, requireUser } from "@/lib/session";
import { orderFlowOf, orderOf, orderPapersOf } from "@/lib/order-data";
import type { CustomerNow } from "@/lib/types-orders";
import type { PaperChecks } from "@/lib/types-papers";
import { backTo, optional } from "@/components/print/data";
import { OrderDocWindow, type OrderDocItem } from "@/components/orders/make-paper";
import type { Recipient } from "@/components/send/send";
import { today } from "@/components/orders/today";
import { byStep, docStateOf, orderWindowHref, outOf, rowWindowHref } from "@/lib/doc-links";
import { UUID } from "@/lib/ids";
import { titled } from "@/lib/titles";
import { paperAction } from "../../../papers-actions";
import { addDocumentAction, updateDocumentAction } from "../../../flow-actions";
import { issueProformaAction } from "../../../actions";
import { paperRowsOf } from "../../shared";

const OWN_LABEL: Record<string, string> = { proforma: "Proforma invoice", "packing-list": "Packing list", quotation: "Quotation" };

export async function generateMetadata({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  return titled((await orderOf(id)).refNo, isPaperKind(kind) ? PAPER_LABEL[kind] : (OWN_LABEL[kind] ?? "Document"));
}

/** The shipping advice's message to the customer: the shipment in a few lines (sent by email or WhatsApp, no mail server needed). */
async function adviceText(id: string, number: string, sender: string, greeting: string) {
  const o = await orderOf(id);
  const flow = await optional(() => orderFlowOf(id));
  // Shipment 1 (the primary: listed first), as the shipping advice prints it.
  const s = flow?.shipping?.shipments[0];
  const ports = portsOf(o, s);
  const lines = [
    `Dear ${greeting},`,
    "",
    `Your order ${o.refNo} has been shipped.`,
    s?.vessel ? `Vessel: ${s.vessel}` : null,
    o.blNo ? `${s?.mode === "air" ? "AWB" : "B/L"} No.: ${o.blNo}` : null,
    s?.containerNo ? `Container: ${s.containerNo}${s.containerType ? ` (${s.containerType})` : ""}` : null,
    ports.portOfLoading || ports.portOfDischarge ? `From ${ports.portOfLoading ?? "China"} to ${ports.portOfDischarge ?? ""}` : null,
    s?.etd || s?.eta
      ? [s?.etd ? `ETD ${paperDateText(s.etd)}` : null, s?.eta ? `ETA ${paperDateText(s.eta)}` : null].filter(Boolean).join(" · ")
      : null,
    "",
    `Our shipping advice ${number} is attached.`,
    "",
    "Best regards,",
    sender,
  ].filter((l): l is string => l !== null);
  return { subject: `Shipping advice ${number} · order ${o.refNo}`, text: lines.join("\n") };
}

const clean = (v: string | undefined, re: RegExp) => (v && re.test(v) ? v : null);

/**
 * One of the order's documents in the order's one window (design "One window for documents and files", 26 Nov
 * 2026), whatever it is: a paper the app makes (what it takes, Make final, then Send), the proforma and the
 * packing list (Issue, Make again), the quotation, and the papers others issue (the file, or Upload when it is
 * needed). The strip goes through the order's other documents; ✕ goes back where it was opened.
 */
export default async function OrderDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<{ ref?: string; doc?: string; back?: string; v?: string; copy?: string; lang?: string }>;
}) {
  const [{ id, kind }, sp] = await Promise.all([params, searchParams]);
  if (!UUID.test(id) || !/^[\w-]{1,40}$/.test(kind)) notFound();
  const me = await requireUser();
  const base = `/orders/${id}`;
  const o = await orderOf(id);
  const papers = await optional(() => orderPapersOf(id));
  const rows = byStep(paperRowsOf(o, papers));
  const ref = clean(sp.ref, /^[\w-]{1,60}$/);
  const docId = clean(sp.doc, UUID);
  const fallbackStep = isPaperKind(kind) ? PAPER_STEP[kind] : (rows.find((r) => r.kind === kind)?.step ?? "documents");
  // Back where it was opened from (Documents, a step's page), else its step's page.
  const back = backTo(sp.back, `${base}/${STEP_PATH[fallbackStep]}`);
  const look = { v: clean(sp.v, /^\d{1,3}$/), copy: clean(sp.copy, /^[a-z]{1,20}$/), lang: clean(sp.lang, /^[a-z]{2}$/) };
  const items = rows.map((r) => ({
    key: r.key,
    name: [r.label, r.number].filter(Boolean).join(" "),
    state: docStateOf(r),
    href: rowWindowHref(id, r, back),
    out: outOf(id, r),
  }));
  const customer = await optional(() => api.get<CustomerNow>(`/customers/${o.customer.id}`));
  const contact = customer?.contacts.find((c) => c.isPrimary) ?? customer?.contacts[0] ?? null;
  // Copy: the customer's other contacts with an email (at most two), as a quotation's Send does.
  const cc = (customer?.contacts ?? []).filter((c) => c.email && c !== contact).slice(0, 2).map((c) => c.email).join(", ");
  const toCustomer: Recipient = { name: contact?.name ?? o.customer.name, email: contact?.email ?? null, cc: cc || null, phone: contact?.whatsapp ?? contact?.phone ?? null };
  const common = { order: { id, refNo: o.refNo, customer: o.customer.name }, items, back, sender: me.name, look, today: today() };

  if (isPaperKind(kind)) {
    let p: PaperChecks;
    try {
      p = await load(() => api.get<PaperChecks>(`/orders/${id}/papers/${kind}/checks`, ref ? { ref } : undefined));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 400 || e.status === 422))
        return (
          <Card className="flex flex-col items-start gap-3 p-5">
            <h2 className="text-base font-semibold">{PAPER_LABEL[kind]}</h2>
            <p className="text-sm text-text-2">{e.message}</p>
            <Link href={back} className={buttonClass("secondary", "sm")}>
              Back
            </Link>
          </Card>
        );
      throw e;
    }
    const row = rows.find((r) => r.kind === kind && (r.ref ?? null) === (p.ref ?? null)) ?? rows.find((r) => r.kind === kind) ?? null;
    const text = kind === "shipping-advice" ? await adviceText(id, p.number, me.name, toCustomer.name ?? o.customer.name) : undefined;
    const doc: OrderDocItem = { type: "make", p, run: paperAction.bind(null, id, kind, p.ref), text };
    return (
      <OrderDocWindow
        key={`${kind}:${p.ref ?? ""}`}
        {...common}
        doc={doc}
        current={row?.key ?? null}
        self={orderWindowHref(id, kind, { ref: p.ref })}
        to={p.buyer ? toCustomer : null}
      />
    );
  }

  const row = rows.find((r) => r.kind === kind && (!docId || r.doc?.id === docId)) ?? null;
  if (!row) notFound();
  const self = rowWindowHref(id, row, "").replace(/[?&]back=$/, "");
  const doc: OrderDocItem =
    kind === "proforma" || kind === "packing-list"
      ? {
          type: "own",
          row,
          canMake: !!papers?.canMake,
          issue: kind === "proforma" && !o.proforma && can(me, "orders.update") && o.status === "open" ? issueProformaAction.bind(null, id) : undefined,
        }
      : kind === "quotation"
        ? { type: "quotation", row }
        : {
            type: "upload",
            row,
            canRecord: !!papers?.canRecord,
            add: addDocumentAction.bind(null, id),
            update: row.doc ? updateDocumentAction.bind(null, id, row.doc.id) : undefined,
            dealId: o.inquiry.id,
            today: today(),
            shipNumber: o.blNo,
          };
  return <OrderDocWindow key={row.key} {...common} doc={doc} current={row.key} self={self} to={toCustomer} />;
}
