import type { Metadata } from "next";
import { BALANCE_TERMS_LABEL } from "@kebo/shared";
import { toMinor } from "@kebo/money";
import { amountInWords } from "@kebo/utils";
import { api } from "@/lib/api";
import { load } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import type { InvoiceDoc, ShipmentDoc } from "@/lib/types-orders";
import {
  Columns,
  customerLines,
  Describe,
  FactsBox,
  Letterhead,
  LinesTable,
  num,
  PartyBox,
  Sheet,
  SignOff,
  TextBlock,
  Totals,
} from "@/components/print/doc";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo, companyOr, customerOr, optional } from "@/components/print/data";

const titleOf = (i: InvoiceDoc) => (i.type === "proforma" ? "Proforma invoice" : "Commercial invoice");
const numberOf = (i: InvoiceDoc) => i.number ?? `Draft · ${i.order.refNo}`;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const i = await load(() => api.get<InvoiceDoc>(`/invoices/${id}`));
  return { title: `${titleOf(i)} ${numberOf(i)}` };
}

/** Proforma (asks for the deposit, with Kebo's bank details) or commercial invoice (bills one shipment). */
export default async function InvoicePrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const inv = await load(() => api.get<InvoiceDoc>(`/invoices/${id}`));
  const [company, customer, shipment] = await Promise.all([
    companyOr(inv.companySnapshot),
    customerOr(inv.customerSnapshot, async () => ({ customerId: (await api.get<OrderView>(`/orders/${inv.order.id}`)).customer.id })),
    inv.shipmentId ? optional(() => api.get<ShipmentDoc>(`/shipments/${inv.shipmentId}`)) : null,
  ]);
  const proforma = inv.type === "proforma";
  const c = inv.currency;
  const vat = inv.vatRate > 0 ? `${inv.pricesIncludeVat ? "Incl. " : ""}VAT ${inv.vatRate}%` : null;
  const incoterm = `${inv.order.incoterm}${inv.order.incotermPlace ? ` ${inv.order.incotermPlace}` : ""}`;
  const payment = `${inv.depositPercent ? `${inv.depositPercent}% deposit; ` : ""}${BALANCE_TERMS_LABEL[inv.order.balanceTerms]}`;
  const watermark = inv.status === "draft" ? "DRAFT" : inv.status === "void" ? "VOID" : null;

  return (
    <>
      <PrintToolbar
        title={`${titleOf(inv)} ${numberOf(inv)}`}
        backHref={backTo(sp.back, `/orders/${inv.order.id}/invoices`)}
        pdfHref={`/pdf/invoices/${inv.id}`}
      />
      <Sheet watermark={watermark}>
        <Letterhead
          company={company}
          title={titleOf(inv)}
          number={inv.number ?? "DRAFT"}
          meta={[
            { label: "Date", value: inv.issueDate ? date(inv.issueDate) : "Not issued" },
            ...(inv.dueDate ? [{ label: proforma ? "Deposit due" : "Payment due", value: date(inv.dueDate) }] : []),
            { label: "Our order", value: inv.order.refNo },
          ]}
        />
        <Columns>
          <PartyBox title={proforma ? "Bill to" : "Sold to (consignee)"} party={customerLines(customer)} />
          <FactsBox
            title={proforma ? "Terms" : "Shipment and terms"}
            items={[
              { label: "Incoterm", value: `${incoterm} (Incoterms® 2020)` },
              { label: "Payment", value: payment },
              { label: "Currency", value: c },
              { label: "Country of origin", value: proforma ? null : "China" },
              ...(shipment
                ? [
                    { label: "Shipment", value: shipment.refNo },
                    { label: "B/L number", value: shipment.blNo },
                    { label: "Vessel / transport", value: shipment.transport },
                    {
                      label: "From → to",
                      value:
                        shipment.portOfLoading || shipment.portOfDischarge
                          ? `${shipment.portOfLoading ?? "—"} → ${shipment.portOfDischarge ?? "—"}`
                          : null,
                    },
                    {
                      label: "Shipped on",
                      value: shipment.departedOn ? date(shipment.departedOn) : shipment.etd ? `ETD ${date(shipment.etd)}` : null,
                    },
                  ]
                : []),
            ]}
          />
        </Columns>
        <LinesTable
          rows={inv.lines}
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
          total={inv.total}
          totalLabel={`Total ${incoterm}`}
          rows={[
            { label: "Subtotal", value: money(inv.subtotal, c) },
            { label: "Discount", value: Number(inv.discount) ? `− ${money(inv.discount, c)}` : null },
            { label: vat ?? "VAT", value: vat ? money(inv.vatAmount, c) : null },
          ]}
          extra={
            proforma && inv.deposit && Number(inv.deposit) > 0 ? (
              <div className="mt-2 rounded-md border-2 border-kebo-gold px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[10pt] font-bold whitespace-nowrap">
                  <span>Deposit to pay ({inv.depositPercent}%)</span>
                  <span className="tabular">{money(inv.deposit, c)}</span>
                </div>
                <p className="mt-0.5 text-[7.5pt] text-[#475569]">{amountInWords(toMinor(inv.deposit), c)}</p>
              </div>
            ) : null
          }
        />
        {proforma && company.bankDetails && (
          <section className="mt-5 break-inside-avoid rounded-md border border-kebo-line bg-kebo-paper px-3 py-2">
            <h2 className="mb-1 text-[7.5pt] font-semibold tracking-[0.08em] text-kebo-deep uppercase">Pay by bank transfer to</h2>
            <p className="font-mono text-[8.5pt] whitespace-pre-line">{company.bankDetails}</p>
            <p className="mt-1 text-[8pt] text-[#475569]">
              Please quote {inv.number ?? inv.order.refNo} with your payment. Bank charges outside China are for the buyer&apos;s account.
            </p>
          </section>
        )}
        <TextBlock title="Notes">{inv.notes}</TextBlock>
        <SignOff
          left={`For and on behalf of ${company.name}`}
          right={proforma ? "Confirmed by the buyer (signature, stamp and date)" : undefined}
          footer={company.invoiceFooter}
        />
      </Sheet>
    </>
  );
}
