import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isPaperKind, PAYMENT_KIND_LABEL, type PaperKind, type PaymentKind } from "@kebo/shared";
import { api } from "@/lib/api";
import { docBrand, load } from "@/lib/session";
import type { OrderDocument, OrderDocumentKind } from "@/lib/types-orders";
import type { PaperDocView } from "@/lib/types-papers";
import { PaperSheet } from "@/components/print/paper";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo, langLinks, pdfIn } from "@/components/print/data";
import { docLangOf, type DocLang } from "@/components/print/zh";
import { CASE_COLUMNS, CaseTotals, casesOf, kg, m3 } from "@/components/print/cases";
import { getSettings } from "@/lib/loaders";
import {
  docDate,
  docFootCell,
  docItem,
  docMoney,
  docQty,
  docWords,
  InternalTable,
  KeboDoc,
  labelled,
  marginOf,
  portBullets,
  textBullets,
  type DocColumn,
  totalPriceLabel,
} from "@/components/print/kebo-doc";
import { UUID } from "@/lib/ids";

/** The print page for the customer's or the internal copy, keeping where Back goes. */
const copyHref = (path: string, back: string | undefined, internal: boolean, v: string | null | undefined, lang: DocLang) =>
  `${path}?${new URLSearchParams({ ...(back ? { back } : {}), ...(internal ? { copy: "internal" } : {}), ...(v ? { v } : {}), ...(lang === "zh" ? { lang } : {}) })}`;

const KINDS: readonly OrderDocumentKind[] = ["proforma", "packing-list"];

const TITLE: Record<OrderDocumentKind, string> = { proforma: "PROFORMA  INVOICE", "packing-list": "PACKING  LIST" };
const NUMBER_LABEL: Record<OrderDocumentKind, string> = { proforma: "Invoice.NO.", "packing-list": "Packing List NO." };

/** A paper the app makes: ?v= a version, ?opts= options to preview, ?ref= which payment, plan item or factory. */
type PaperQuery = { v?: string; opts?: string; ref?: string; now?: string; embed?: string; back?: string; lang?: string };
const paperQuery = (sp: PaperQuery) =>
  Object.fromEntries(
    (["v", "opts", "ref", "now"] as const).flatMap((k) => (sp[k] && /^[\w,.-]{1,200}$/.test(sp[k]!) ? [[k, sp[k]!]] : [])),
  ) as Record<string, string>;

async function getPaper(id: string, kind: PaperKind, sp: PaperQuery) {
  if (!UUID.test(id)) notFound();
  return load(() => api.get<PaperDocView>(`/orders/${id}/papers/${kind}/doc`, paperQuery(sp)));
}

async function getDoc(id: string, kind: string, v?: string) {
  if (!KINDS.includes(kind as OrderDocumentKind) || !UUID.test(id)) notFound();
  return load(() => api.get<OrderDocument>(`/orders/${id}/documents/${kind}`, v && /^\d{1,3}$/.test(v) ? { v } : undefined));
}

/** "Proforma invoice KEB… · version 2", "(draft)", and a snapshot rebuilt from the data says so (the toolbar only, never the paper). */
function docTitle(d: OrderDocument) {
  const version = d.paper && d.versions.length > 1 ? ` · version ${d.paper.version}` : "";
  const state = !d.number ? " (draft, not issued)" : d.paper?.status === "draft" ? " (draft)" : "";
  const rebuilt = d.final && d.paper?.rebuiltOn ? ` · rebuilt from the data on ${d.paper.rebuiltOn}` : "";
  return `${d.title} ${d.number ?? ""}${version}${state}${rebuilt}`.replace(/\s+/g, " ").trim();
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<{ copy?: string } & PaperQuery>;
}): Promise<Metadata> {
  const [{ id, kind }, sp] = await Promise.all([params, searchParams]);
  if (isPaperKind(kind)) {
    const p = await getPaper(id, kind, sp);
    return { title: `${p.label} ${p.doc.number}${p.final ? "" : " (draft)"}` };
  }
  const d = await getDoc(id, kind, sp.v);
  return { title: `${d.title} ${d.number ?? "(draft)"}${d.paper && d.versions.length > 1 ? ` v${d.paper.version}` : ""}${sp.copy === "internal" && d.kind !== "packing-list" ? " (internal)" : ""}` };
}

type Line = OrderDocument["lines"][number];

/**
 * An order's documents, made from the order itself (GET /orders/:id/documents/:kind),
 * all in Kebo's own layout (components/print/kebo-doc.tsx):
 *  - proforma: the whole order with Kebo's bank details — the one invoice Kebo sends
 *    (once shipped it also carries the ship date and B/L number);
 *  - packing-list: the goods only, with packages, weights and volume.
 * The customer's copy shows the items and one total; ?copy=internal adds unit prices,
 * amounts, costs and margin, and every payment.
 */
export default async function OrderDocumentPrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<{ back?: string; copy?: string } & PaperQuery>;
}) {
  const [{ id, kind }, sp] = await Promise.all([params, searchParams]);
  if (isPaperKind(kind)) return <PaperPrint id={id} kind={kind} sp={sp} />;
  const d = await getDoc(id, kind, sp.v);
  // The buyer as on the order (frozen when it was made; a final version keeps the one it was printed with).
  const customer = d.customer;
  const o = d.order;
  const v = d.paper && d.versions.length > 1 ? String(d.paper.version) : null;
  const c = d.currency;
  const t = d.totals;
  const packing = d.kind === "packing-list";
  const internal = !packing && sp.copy === "internal";
  const costs = internal && d.lines.some((l) => l.unitCost != null);
  const unitPrices = !packing && (await getSettings()).sales.quoteUnitPrices;
  const lang = docLangOf(sp.lang);

  const toolbar = (
    <PrintToolbar
      title={docTitle(d)}
      backHref={backTo(sp.back, `/orders/${o.id}`)}
      pdfHref={pdfIn(
        `/pdf/${d.kind}/${o.id}${internal || v ? `?${new URLSearchParams({ ...(internal ? { copy: "internal" } : {}), ...(v ? { v } : {}) })}` : ""}`,
        lang,
      )}
      copies={
        packing
          ? undefined
          : {
              current: internal ? "internal" : "customer",
              customer: copyHref(`/print/orders/${o.id}/${d.kind}`, sp.back, false, v, lang),
              internal: copyHref(`/print/orders/${o.id}/${d.kind}`, sp.back, true, v, lang),
            }
      }
      languages={langLinks(`/print/orders/${o.id}/${d.kind}`, sp, lang)}
    />
  );

  const no: DocColumn<Line> = { label: "No.", width: 28.5, render: (l, i) => l.no ?? i + 1 };
  const description: DocColumn<Line> = {
    label: packing ? "Description of goods" : "Equipment Description",
    render: (l) => docItem(l.description, l.model),
  };
  const qty: DocColumn<Line> = { label: "Quantity", width: internal ? 58 : 71.4, render: (l) => docQty(l.quantity, l.unit) };

  const columns: DocColumn<Line>[] = packing
    ? [
        no,
        description,
        { label: "Quantity", width: 58, render: (l) => docQty(l.quantity, l.unit) },
        {
          label: "Packages",
          width: 82,
          wrap: true,
          render: (l) => (l.packing?.packages ? docQty(l.packing.packages, l.packing.packageType) : ""),
        },
        { label: "N.W. (kg)", width: 52, align: "right", render: (l) => kg(l.packing?.netWeightKg) },
        { label: "G.W. (kg)", width: 52, align: "right", render: (l) => kg(l.packing?.grossWeightKg) },
        { label: "CBM", width: 42, align: "right", render: (l) => m3(l.packing?.cbm) },
      ]
    : internal
      ? [
          no,
          description,
          qty,
          ...(costs
            ? ([
                { label: "Unit cost", width: 62, align: "right", render: (l) => (l.unitCost != null ? docMoney(l.unitCost, c) : "") },
                { label: "Margin", width: 42, align: "right", render: (l) => marginOf(l.unitPrice ?? 0, l.unitCost) },
              ] satisfies DocColumn<Line>[])
            : []),
          { label: "Unit price", width: 66, align: "right", render: (l) => docMoney(l.unitPrice ?? 0, c) },
          { label: "Amount", width: 74, align: "right", render: (l) => docMoney(l.lineTotal ?? 0, c) },
        ]
      : unitPrices
        ? // Settings › Sales: customer copies show each line's price (review 24 Nov, O-29).
          [
            no,
            description,
            qty,
            { label: "Unit price", width: 66, align: "right", render: (l) => docMoney(l.unitPrice ?? 0, c) },
            { label: "Amount", width: 74, align: "right", render: (l) => docMoney(l.lineTotal ?? 0, c) },
          ]
        : [no, description, qty];

  // Subtotal and discount: always on the internal copy, on the customer's only when there is a discount.
  const sums =
    t && (internal || Number(t.discount))
      ? [
          { label: "Subtotal", value: docMoney(t.subtotal, c) },
          ...(Number(t.discount) ? [{ label: "Discount", value: docMoney(-Number(t.discount), c) }] : []),
        ]
      : [];

  // The packing list prints its shipment's ports (versions made before that print what they printed: from the terms).
  // The ports and origin are in the details under the title; versions made before them print them here.
  const details = d.details ?? null;
  const ports = details ? [] : portBullets(o.incoterm, o.incotermPlace, o.portOfDischarge, packing ? d.shipment : null, lang);
  const pk = d.packing;
  const tradeTerm = `${o.incoterm}${o.incotermPlace ? ` ${o.incotermPlace}` : ""}`;
  const bullets = packing
    ? [
        // As the customer's own packing list ends: the payment and the trade term.
        d.paymentLine ? labelled("Payment:", d.paymentLine, lang) : null,
        details ? labelled("Trade term:", tradeTerm, lang) : null,
        pk?.containerNo ? labelled("Container No.:", pk.containerNo, lang) : null,
        pk?.shippingMarks ? labelled("Shipping marks:", `\n${pk.shippingMarks}`, lang) : null,
        o.blNo ? labelled("B/L No.:", o.blNo, lang) : null,
        o.shippedOn ? labelled("Shipped on:", docDate(o.shippedOn), lang) : null,
        ...ports,
        details ? null : "Country of origin: China",
      ]
    : [
        o.customerRef ? labelled("Your order No.:", o.customerRef, lang) : null,
        d.paymentSentence,
        ...textBullets(d.paymentTermsText),
        o.leadTime ? `Delivery: ${o.leadTime}` : null,
        o.warranty ? `Warranty: ${o.warranty}` : null,
        ...textBullets(d.deliveryTermsText),
        ...textBullets(d.notes),
        ...ports,
        o.shippedOn ? labelled("Shipped on:", docDate(o.shippedOn), lang) : null,
        o.blNo ? labelled("B/L No.:", o.blNo, lang) : null,
      ];

  // The packing list case by case, in the customer's format (25 Nov 2026): a row per case, each item over its
  // cases. Versions made before the cases print as they were (a row per item).
  const caseRows = packing && pk && d.lines.every((l) => l.packing?.cases) ? casesOf(d.lines) : null;
  const caseTotal = caseRows && pk ? <CaseTotals rows={caseRows} totals={pk.totals} lang={lang} /> : null;

  const packingTotals =
    packing && pk ? (
      <tr style={{ breakInside: "avoid" }}>
        <td colSpan={3} style={{ ...docFootCell(), paddingLeft: 0 }}>
          Total: {d.lines.length} item{d.lines.length === 1 ? "" : "s"}
          {pk.totals.packages > 0 ? `, ${pk.totals.packages} packages` : ""}
        </td>
        <td style={docFootCell()}>{pk.totals.packages || ""}</td>
        <td style={docFootCell("right")}>
          {Number(pk.totals.netWeightKg) ? kg(pk.totals.netWeightKg) : ""}
        </td>
        <td style={docFootCell("right")}>
          {Number(pk.totals.grossWeightKg) ? kg(pk.totals.grossWeightKg) : ""}
        </td>
        <td style={{ ...docFootCell("right"), paddingRight: 0 }}>
          {Number(pk.totals.cbm) ? m3(pk.totals.cbm) : ""}
        </td>
      </tr>
    ) : null;

  const internalPart =
    internal && t ? (
      <>
        <InternalTable
          title="Money (internal)"
          rows={[
            ["Order total", docMoney(t.total, c)],
            [`Deposit (${t.depositPercent}%)`, docMoney(t.deposit, c)],
            ...(Number(t.charged ?? 0) > 0 ? [["Charged to the customer (expenses)", docMoney(t.charged, c)] as [string, string]] : []),
            ["Received so far", docMoney(t.received, c)],
            [Number(t.charged ?? 0) > 0 ? `Still due (incl. ${docMoney(t.charged, c)} charged)` : "Still due", docMoney(t.due, c)],
            ...(costs
              ? [
                  [
                    "Supplier cost (items with a cost)",
                    docMoney(
                      d.lines.reduce((s, l) => s + (l.unitCost != null ? Number(l.unitCost) * Number(l.quantity) : 0), 0),
                      c,
                    ),
                  ],
                  [
                    "Margin on those items",
                    marginOf(
                      d.lines.reduce((s, l) => s + (l.unitCost != null ? Number(l.lineTotal ?? 0) : 0), 0),
                      d.lines.reduce((s, l) => s + (l.unitCost != null ? Number(l.unitCost) * Number(l.quantity) : 0), 0),
                    ) || "—",
                  ],
                ]
              : []),
          ]}
        />
        <InternalTable
          title="Payments received (internal)"
          head={["Date", "For", "Reference", "Bank charges", "Amount"]}
          rows={
            d.payments.length
              ? d.payments.map((p) => [
                  docDate(p.paidOn),
                  PAYMENT_KIND_LABEL[p.kind as PaymentKind] ?? p.kind,
                  p.reference ?? "",
                  docMoney(p.bankCharges, p.currency),
                  docMoney(p.amount, p.currency),
                ])
              : [["No payments yet", "", "", "", ""]]
          }
        />
      </>
    ) : null;

  const doc = {
    brand: await docBrand(),
    company: d.company,
    customer,
    title: TITLE[d.kind],
    numberLabel: NUMBER_LABEL[d.kind],
    number: d.number ?? "DRAFT",
    date: d.date,
    // The packing list names its invoice, as the customer's own does.
    meta:
      d.kind === "proforma"
        ? []
        : [{ label: "Order NO.", value: o.refNo }, ...(o.proformaNo ? [{ label: "Invoice No.", value: o.proformaNo }] : [])],
    heading: o.documentTitle,
    sums,
    total: t ? { label: totalPriceLabel(o.incoterm, d.lines), words: docWords(t.total, c), amount: docMoney(t.total, c) } : null,
    // Payment, delivery, warranty and packing words: "Terms", not all under "Payment terms" (O-29).
    boxTitle: packing ? "Shipping details:" : "Terms:",
    bullets: bullets.filter(Boolean),
    bank: packing ? null : d.bankDetails,
    internal: internalPart,
    watermark: d.watermark,
    details,
    lang,
  };
  return (
    <>
      {toolbar}
      {caseRows ? (
        <KeboDoc {...doc} columns={CASE_COLUMNS} rows={caseRows} foot={caseTotal} />
      ) : (
        <KeboDoc {...doc} columns={columns} rows={d.lines} foot={packingTotals} />
      )}
    </>
  );
}

/**
 * A paper the app makes (sales contract, commercial invoice, …) in the same
 * template, from GET /orders/:id/papers/:kind/doc: a final version as it was
 * made, else made from the order now with a DRAFT watermark. ?embed=1 (the Make
 * page's preview) leaves out the toolbar.
 */
async function PaperPrint({ id, kind, sp }: { id: string; kind: PaperKind; sp: PaperQuery }) {
  const p = await getPaper(id, kind, sp);
  const q = new URLSearchParams(paperQuery(sp));
  q.delete("opts");
  const lang = docLangOf(sp.lang);
  const pdf = pdfIn(`/pdf/${kind}/${id}${q.size ? `?${q}` : ""}`, lang);
  return (
    <>
      {sp.embed !== "1" && (
        <PrintToolbar
          title={`${p.label} ${p.doc.number}${p.paper && p.versions.length > 1 ? ` · version ${p.paper.version}` : ""}${p.final || p.live ? "" : p.kept ? (kind === "payment-request" ? " (not sent)" : "") : " (draft)"}`}
          backHref={backTo(
            sp.back,
            // Kept as sent: no Make page to go back to. A request (a row of the payment plan now) and a receipt go
            // back to the Payment step.
            kind === "payment-request" && sp.ref && UUID.test(sp.ref)
              ? `/orders/${id}/payment`
              : p.kept
                ? `/orders/${id}/payment`
                : `/orders/${id}/papers/${kind}${sp.ref ? `?ref=${encodeURIComponent(sp.ref)}` : ""}`,
          )}
          pdfHref={pdf}
          languages={langLinks(`/print/orders/${id}/${kind}`, sp, lang)}
        />
      )}
      <div className={sp.embed === "1" ? "pt-4" : undefined}>
        <PaperSheet doc={p.doc} brand={await docBrand()} watermark={p.watermark} lang={lang} />
      </div>
    </>
  );
}
