import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PAYMENT_KIND_LABEL, type PaymentKind } from "@kebo/shared";
import { api } from "@/lib/api";
import { load } from "@/lib/session";
import type { OrderDocument, OrderDocumentKind } from "@/lib/types-orders";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo, customerOr } from "@/components/print/data";
import {
  docDate,
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
} from "@/components/print/kebo-doc";

/** The print page for the customer's or the internal copy, keeping where Back goes. */
const copyHref = (path: string, back: string | undefined, internal: boolean) =>
  `${path}?${new URLSearchParams({ ...(back ? { back } : {}), ...(internal ? { copy: "internal" } : {}) })}`;

const KINDS: readonly OrderDocumentKind[] = ["proforma", "packing-list"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Weights with up to 2 decimals and volume with up to 3; blank when not recorded. */
const kg = (v: string | null | undefined) =>
  v === null || v === undefined ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const m3 = (v: string | null | undefined) =>
  v === null || v === undefined ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const TITLE: Record<OrderDocumentKind, string> = { proforma: "PROFORMA  INVOICE", "packing-list": "PACKING  LIST" };
const NUMBER_LABEL: Record<OrderDocumentKind, string> = { proforma: "Invoice.NO.", "packing-list": "Packing List NO." };

async function getDoc(id: string, kind: string) {
  if (!KINDS.includes(kind as OrderDocumentKind) || !UUID.test(id)) notFound();
  return load(() => api.get<OrderDocument>(`/orders/${id}/documents/${kind}`));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kind: string }>;
  searchParams: Promise<{ copy?: string }>;
}): Promise<Metadata> {
  const [{ id, kind }, sp] = await Promise.all([params, searchParams]);
  const d = await getDoc(id, kind);
  return { title: `${d.title} ${d.number}${sp.copy === "internal" && d.kind !== "packing-list" ? " (internal)" : ""}` };
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
  searchParams: Promise<{ back?: string; copy?: string }>;
}) {
  const [{ id, kind }, sp] = await Promise.all([params, searchParams]);
  const d = await getDoc(id, kind);
  // Customer snapshots imported from the old system may be empty: then the customer as it is now.
  const customer = await customerOr(d.customer, async () => ({
    customerId: (await api.get<{ customer: { id: string } }>(`/orders/${id}`)).customer.id,
  })).catch(() => d.customer);
  const o = d.order;
  const c = d.currency;
  const t = d.totals;
  const packing = d.kind === "packing-list";
  const internal = !packing && sp.copy === "internal";
  const costs = internal && d.lines.some((l) => l.unitCost != null);

  const toolbar = (
    <PrintToolbar
      title={`${d.title} ${d.number}`}
      backHref={backTo(sp.back, `/orders/${o.id}`)}
      pdfHref={`/pdf/${d.kind}/${o.id}${internal ? "?copy=internal" : ""}`}
      copies={
        packing
          ? undefined
          : {
              current: internal ? "internal" : "customer",
              customer: copyHref(`/print/orders/${o.id}/${d.kind}`, sp.back, false),
              internal: copyHref(`/print/orders/${o.id}/${d.kind}`, sp.back, true),
            }
      }
    />
  );

  const no: DocColumn<Line> = { label: "No.", width: 28.5, render: (l, i) => l.no ?? i + 1 };
  const description: DocColumn<Line> = {
    label: packing ? "Description of Goods" : "Equipment Description",
    render: (l) => (
      <>
        {l.description}
        {l.model ? `\nModel: ${l.model}` : ""}
      </>
    ),
  };
  const qty: DocColumn<Line> = { label: "Qty.", width: internal ? 58 : 71.4, render: (l) => docQty(l.quantity, l.unit) };

  const columns: DocColumn<Line>[] = packing
    ? [
        no,
        description,
        { label: "Qty.", width: 58, render: (l) => docQty(l.quantity, l.unit) },
        {
          label: "Packages",
          width: 82,
          wrap: true,
          render: (l) => (l.packing?.packages ? `${l.packing.packages} ${l.packing.packageType ?? ""}`.trim() : ""),
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
      : [no, description, qty];

  // Subtotal and discount: always on the internal copy, on the customer's only when there is a discount.
  const sums =
    t && (internal || Number(t.discount))
      ? [
          { label: "Subtotal", value: docMoney(t.subtotal, c) },
          ...(Number(t.discount) ? [{ label: "Discount", value: docMoney(-Number(t.discount), c) }] : []),
        ]
      : [];

  const ports = portBullets(o.incoterm, o.incotermPlace, o.portOfDischarge);
  const pk = d.packing;
  const bullets = packing
    ? [
        pk?.containerNo ? labelled("Container No.:", pk.containerNo) : null,
        pk?.shippingMarks ? labelled("Shipping marks:", `\n${pk.shippingMarks}`) : null,
        o.blNo ? labelled("B/L No.:", o.blNo) : null,
        o.shippedOn ? labelled("Shipped on:", docDate(o.shippedOn)) : null,
        ...ports,
        "Country of origin: China",
      ]
    : [
        d.paymentSentence,
        o.leadTime ? `Delivery: ${o.leadTime}` : null,
        ...textBullets(d.terms),
        ...textBullets(d.notes),
        ...ports,
        o.shippedOn ? labelled("Shipped on:", docDate(o.shippedOn)) : null,
        o.blNo ? labelled("B/L No.:", o.blNo) : null,
      ];

  const packingTotals =
    packing && pk ? (
      <tr style={{ fontWeight: 700, fontSize: "11pt", lineHeight: "13.8pt" }}>
        <td colSpan={3} style={{ border: "0.5pt solid #000", padding: "0 5.6pt" }}>
          Total :
          <span style={{ display: "inline-block", width: "24pt" }} />
          {d.lines.length} item{d.lines.length === 1 ? "" : "s"}
          {pk.totals.packages > 0 ? `, ${pk.totals.packages} packages` : ""}
        </td>
        <td style={{ border: "0.5pt solid #000", padding: "0 5.6pt" }}>{pk.totals.packages || ""}</td>
        <td style={{ border: "0.5pt solid #000", padding: "0 5.6pt", textAlign: "right" }}>
          {Number(pk.totals.netWeightKg) ? kg(pk.totals.netWeightKg) : ""}
        </td>
        <td style={{ border: "0.5pt solid #000", padding: "0 5.6pt", textAlign: "right" }}>
          {Number(pk.totals.grossWeightKg) ? kg(pk.totals.grossWeightKg) : ""}
        </td>
        <td style={{ border: "0.5pt solid #000", padding: "0 5.6pt", textAlign: "right" }}>
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
            ["Received so far", docMoney(t.received, c)],
            ["Still due", docMoney(t.due, c)],
            ...(costs
              ? [
                  [
                    "Factory cost (lines with a cost)",
                    docMoney(
                      d.lines.reduce((s, l) => s + (l.unitCost != null ? Number(l.unitCost) * Number(l.quantity) : 0), 0),
                      c,
                    ),
                  ],
                  [
                    "Margin on those lines",
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

  return (
    <>
      {toolbar}
      <KeboDoc
        company={d.company}
        customer={customer}
        title={TITLE[d.kind]}
        numberLabel={NUMBER_LABEL[d.kind]}
        number={d.number}
        date={d.date}
        meta={d.kind === "proforma" ? [] : [{ label: "Order NO.", value: o.refNo }]}
        heading={o.documentTitle}
        columns={columns}
        rows={d.lines}
        sums={sums}
        total={t ? { label: `Total ${o.incoterm} Price :`, words: docWords(t.total, c), amount: docMoney(t.total, c) } : null}
        foot={packingTotals}
        boxTitle={packing ? "Shipping details:" : "Payment terms:"}
        bullets={bullets.filter(Boolean)}
        bank={packing ? null : d.bankDetails}
        internal={internalPart}
        watermark={o.status === "cancelled" ? "CANCELLED" : packing && !pk?.done ? "DRAFT" : null}
      />
    </>
  );
}
