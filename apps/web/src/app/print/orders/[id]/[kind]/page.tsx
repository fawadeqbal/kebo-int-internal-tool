import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { toMinor } from "@kebo/money";
import { amountInWords } from "@kebo/utils";
import { api } from "@/lib/api";
import { load } from "@/lib/session";
import { date, money, qty } from "@/lib/format";
import type { OrderDocument, OrderDocumentKind } from "@/lib/types-orders";
import { Columns, customerLines, Describe, FactsBox, Letterhead, LinesTable, num, PartyBox, Sheet, SignOff, TextBlock, Totals } from "@/components/print/doc";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo, customerOr } from "@/components/print/data";

/** Weights with up to 2 decimals and volume with up to 3; blank when not recorded. */
const kg = (v: string | null | undefined) => (v === null || v === undefined ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }));
const m3 = (v: string | null | undefined) => (v === null || v === undefined ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 }));

const KINDS: readonly OrderDocumentKind[] = ["proforma", "invoice", "packing-list"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getDoc(id: string, kind: string) {
  if (!KINDS.includes(kind as OrderDocumentKind) || !UUID.test(id)) notFound();
  return load(() => api.get<OrderDocument>(`/orders/${id}/documents/${kind}`));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string; kind: string }> }): Promise<Metadata> {
  const { id, kind } = await params;
  const d = await getDoc(id, kind);
  return { title: `${d.title} ${d.number}` };
}

/**
 * An order's documents, made from the order itself (GET /orders/:id/documents/:kind):
 *  - proforma: the whole order, asking for the deposit, with Kebo's bank details;
 *  - invoice: the whole order, with what was received and the balance due;
 *  - packing-list: the goods only, without prices.
 */
export default async function OrderDocumentPrint({ params, searchParams }: { params: Promise<{ id: string; kind: string }>; searchParams: Promise<{ back?: string }> }) {
  const [{ id, kind }, sp] = await Promise.all([params, searchParams]);
  const d = await getDoc(id, kind);
  // Customer snapshots imported from the old system may be empty: then the customer as it is now.
  const customer = await customerOr(d.customer, async () => ({ customerId: (await api.get<{ customer: { id: string } }>(`/orders/${id}`)).customer.id })).catch(() => d.customer);
  const c = d.currency;
  const t = d.totals;
  const o = d.order;
  const incoterm = `${o.incoterm}${o.incotermPlace ? ` ${o.incotermPlace}` : ""}`;
  const proforma = d.kind === "proforma";
  const invoice = d.kind === "invoice";
  const vat = t && t.vatRate > 0 ? `${t.pricesIncludeVat ? "Incl. " : ""}VAT ${t.vatRate}%` : null;
  const cancelled = o.status === "cancelled";
  const totalUnits = d.lines.reduce((s, l) => s + Number(l.quantity), 0);
  // Packing list: the figures recorded on the order (blank until filled in, so a draft can be completed by hand).
  const pk = d.kind === "packing-list" ? d.packing : null;
  const draft = d.kind === "packing-list" && !pk?.done;

  return (
    <>
      <PrintToolbar title={`${d.title} ${d.number}`} backHref={backTo(sp.back, `/orders/${o.id}`)} pdfHref={`/pdf/${d.kind}/${o.id}`} />
      <Sheet watermark={cancelled ? "CANCELLED" : null}>
        <Letterhead
          company={d.company}
          title={d.title}
          number={d.number}
          meta={[
            { label: "Date", value: date(d.date) },
            { label: "Our order", value: o.refNo },
            { label: "Quotation", value: o.quotation },
            ...(!proforma && o.blNo ? [{ label: "B/L number", value: o.blNo }] : []),
          ]}
        />
        <Columns>
          <PartyBox title={proforma ? "Bill to" : invoice ? "Sold to (consignee)" : "Consignee"} party={customerLines(customer)} />
          <FactsBox
            title={proforma ? "Terms" : "Shipment and terms"}
            items={[
              { label: "Incoterm", value: `${incoterm} (Incoterms® 2020)` },
              { label: "Payment", value: d.kind === "packing-list" ? null : d.paymentTerms },
              { label: "Currency", value: d.kind === "packing-list" ? null : c },
              { label: "Country of origin", value: proforma ? null : "China" },
              { label: "Ship by", value: proforma && o.shipBy ? date(o.shipBy) : null },
              { label: "Shipped on", value: !proforma && o.shippedOn ? date(o.shippedOn) : null },
              { label: "B/L number", value: !proforma ? o.blNo : null },
            ]}
          />
        </Columns>
        {d.showPrices && t ? (
          <>
            <LinesTable
              rows={d.lines}
              columns={[
                { label: "No.", className: "w-8 text-[#64748b]", render: (_l, i) => i + 1 },
                { label: "Description", render: (l) => <Describe description={l.description} model={l.model} hsCode={l.hsCode} /> },
                { label: "Qty", className: "w-16 text-right", render: (l) => num(l.quantity) },
                { label: "Unit", className: "w-12", render: (l) => l.unit },
                { label: "Unit price", className: "w-28 text-right tabular whitespace-nowrap", render: (l) => money(l.unitPrice, c) },
                { label: "Amount", className: "w-32 text-right tabular whitespace-nowrap font-medium", render: (l) => money(l.lineTotal, c) },
              ]}
            />
            <Totals
              currency={c}
              total={t.total}
              totalLabel={`Total ${incoterm}`}
              rows={[
                { label: "Subtotal", value: money(t.subtotal, c) },
                { label: "Discount", value: Number(t.discount) ? `− ${money(t.discount, c)}` : null },
                { label: vat ?? "VAT", value: vat ? money(t.vat, c) : null },
              ]}
              extra={
                proforma && Number(t.deposit) > 0 ? (
                  <div className="mt-2 rounded-md border-2 border-kebo-gold px-2 py-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-[10pt] font-bold whitespace-nowrap">
                      <span>Deposit to pay ({t.depositPercent}%)</span>
                      <span className="tabular">{money(t.deposit, c)}</span>
                    </div>
                    <p className="mt-0.5 text-[7.5pt] text-[#475569]">{amountInWords(toMinor(t.deposit), c)}</p>
                  </div>
                ) : invoice ? (
                  <dl className="mt-2 text-[9pt]">
                    <div className="flex justify-between gap-4 border-b border-kebo-line px-2 py-1">
                      <dt className="text-[#475569]">Received with thanks</dt>
                      <dd className="tabular">{Number(t.received) ? `− ${money(t.received, c)}` : money(0, c)}</dd>
                    </div>
                    <div className="mt-1 rounded-md border-2 border-kebo-gold px-2 py-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-[10pt] font-bold whitespace-nowrap">
                        <dt>Balance due</dt>
                        <dd className="tabular">{money(t.due, c)}</dd>
                      </div>
                      <p className="mt-0.5 text-[7.5pt] text-[#475569]">{Number(t.due) > 0 ? amountInWords(toMinor(t.due), c) : "Paid in full. Thank you."}</p>
                    </div>
                  </dl>
                ) : null
              }
            />
          </>
        ) : (
          <>
            {draft && (
              <p className="mt-4 rounded-md border border-dashed border-[#d97706]/60 bg-[#fffbeb] px-3 py-2 text-[9pt] text-[#92400e]">
                <span className="font-semibold">Draft — packing list not filled in.</span> Packages, weights and volume are added on the order before shipping.
              </p>
            )}
            <LinesTable
              rows={d.lines}
              columns={[
                { label: "No.", className: "w-7 text-[#64748b]", render: (_l, i) => i + 1 },
                { label: "Description of goods", render: (l) => <Describe description={l.description} model={l.model} hsCode={l.hsCode} /> },
                { label: "Quantity", className: "w-20 text-right whitespace-nowrap", render: (l) => <>{num(l.quantity)} {l.unit}</> },
                { label: "Pkgs", className: "w-12 text-right tabular", render: (l) => (l.packing?.packages != null ? qty(l.packing.packages) : "") },
                { label: "Type", className: "w-20", render: (l) => (l.packing?.packages ? (l.packing.packageType ?? "") : "") },
                { label: "Net kg", className: "w-16 text-right tabular whitespace-nowrap", render: (l) => kg(l.packing?.netWeightKg) },
                { label: "Gross kg", className: "w-16 text-right tabular whitespace-nowrap", render: (l) => kg(l.packing?.grossWeightKg) },
                { label: "CBM", className: "w-14 text-right tabular whitespace-nowrap", render: (l) => m3(l.packing?.cbm) },
              ]}
              foot={
                pk &&
                pk.totals.packages > 0 && (
                  <tr className="border-t-2 border-kebo-deep font-semibold">
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5">Total</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap tabular">{qty(totalUnits)}</td>
                    <td className="px-2 py-1.5 text-right tabular">{qty(pk.totals.packages)}</td>
                    <td className="px-2 py-1.5" />
                    <td className="px-2 py-1.5 text-right tabular whitespace-nowrap">{kg(pk.totals.netWeightKg)}</td>
                    <td className="px-2 py-1.5 text-right tabular whitespace-nowrap">{kg(pk.totals.grossWeightKg)}</td>
                    <td className="px-2 py-1.5 text-right tabular whitespace-nowrap">{m3(pk.totals.cbm)}</td>
                  </tr>
                )
              }
            />
            <p className="mt-3 rounded-md bg-kebo-paper px-3 py-2 text-[8.5pt]">
              <span className="text-[#64748b]">Total: </span>
              <span className="font-medium">
                {d.lines.length} line{d.lines.length === 1 ? "" : "s"}, {qty(totalUnits)} units
                {pk && pk.totals.packages > 0 && <>, {qty(pk.totals.packages)} package{pk.totals.packages === 1 ? "" : "s"}</>}
                {pk && Number(pk.totals.grossWeightKg) > 0 && <>, gross weight {kg(pk.totals.grossWeightKg)} kg</>}
                {pk && Number(pk.totals.cbm) > 0 && <>, {m3(pk.totals.cbm)} m³</>}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-6">
              <TextBlock title="Shipping marks" className="rounded-md border border-dashed border-[#94a3b8] p-3">
                {pk?.shippingMarks ? <span className="font-medium text-kebo-ink">{pk.shippingMarks}</span> : <span className="text-[#94a3b8]">{" \n \n "}</span>}
              </TextBlock>
              <TextBlock title="Container" className="rounded-md border border-dashed border-[#94a3b8] p-3">
                {pk?.containerNo ? <span className="font-medium text-kebo-ink">Container no. {pk.containerNo}</span> : <span className="text-[#94a3b8]">{"Container no.:\nSeal no.:"}</span>}
              </TextBlock>
            </div>
          </>
        )}
        {(proforma || invoice) && d.bankDetails && (
          <section className="mt-5 break-inside-avoid rounded-md border border-kebo-line bg-kebo-paper px-3 py-2">
            <h2 className="mb-1 text-[7.5pt] font-semibold tracking-[0.08em] text-kebo-deep uppercase">Pay by bank transfer to</h2>
            <p className="font-mono text-[8.5pt] whitespace-pre-line">{d.bankDetails}</p>
            <p className="mt-1 text-[8pt] text-[#475569]">Please quote {d.number} with your payment. Bank charges outside China are for the buyer&apos;s account.</p>
          </section>
        )}
        <TextBlock title="Terms and conditions">{d.terms}</TextBlock>
        <SignOff
          left={`For and on behalf of ${d.company.name}`}
          right={proforma ? "Confirmed by the buyer (signature, stamp and date)" : undefined}
          footer={d.kind === "packing-list" ? null : d.footer}
        />
      </Sheet>
    </>
  );
}
