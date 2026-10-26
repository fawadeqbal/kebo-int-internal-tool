import type { Metadata } from "next";
import { api } from "@/lib/api";
import { load } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { FactoryDetail, FactoryOrder } from "@/lib/types-orders";
import {
  Columns,
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
import { backTo, companyOr, optional } from "@/components/print/data";
import { today } from "@/components/orders/today";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const fo = await load(() => api.get<FactoryOrder>(`/factory-orders/${id}`));
  return { title: `Purchase order ${fo.refNo}` };
}

/** Kebo's purchase order to the factory: the factory's prices, deposit and ready date (never the customer). */
export default async function PurchaseOrderPrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const fo = await load(() => api.get<FactoryOrder>(`/factory-orders/${id}`));
  const [company, factory] = await Promise.all([companyOr(null), optional(() => api.get<FactoryDetail>(`/factories/${fo.factory.id}`))]);
  const c = fo.currency;
  const watermark = fo.status === "draft" ? "DRAFT" : fo.status === "cancelled" ? "CANCELLED" : null;
  const vatRates = [...new Set(fo.lines.map((l) => l.vatRate))];

  return (
    <>
      <PrintToolbar title={`Purchase order ${fo.refNo}`} backHref={backTo(sp.back, "/orders")} pdfHref={`/pdf/factory-orders/${fo.id}`} />
      <Sheet watermark={watermark}>
        <Letterhead
          company={company}
          title="Purchase order"
          number={fo.refNo}
          meta={[
            { label: "Date", value: date(fo.sentOn ?? today()) },
            { label: "Currency", value: c },
            ...(fo.readyOn
              ? [{ label: fo.status === "confirmed" ? "Ready date (confirmed)" : "Ready date wanted", value: date(fo.readyOn) }]
              : []),
          ]}
        />
        <Columns>
          <PartyBox
            title="Supplier"
            party={{
              name: factory?.name ?? fo.factory.name,
              lines: [
                factory?.address,
                factory?.contactPerson && `Attn: ${factory.contactPerson}`,
                [factory?.phone, factory?.email, factory?.wechat && `WeChat ${factory.wechat}`].filter(Boolean).join(" · ") || null,
              ],
            }}
          />
          <FactsBox
            title="Terms"
            items={[
              {
                label: "Prices",
                value: `${c}, ${fo.pricesIncludeVat ? `VAT included (${vatRates.map((r) => `${r}%`).join(", ")})` : "before VAT"}`,
              },
              { label: "Deposit", value: `${fo.depositPercent}% · ${money(fo.deposit, c)}` },
              { label: "Payment terms", value: fo.paymentTerms ?? `${fo.depositPercent}% deposit with the order, balance before loading` },
              { label: "VAT invoice", value: "Special VAT invoice (fapiao) for the full amount, for export tax refund" },
              {
                label: "Delivery",
                value: fo.readyOn ? `Goods ready by ${date(fo.readyOn)}` : "Ready date to be confirmed by the supplier",
              },
            ]}
          />
        </Columns>
        <LinesTable
          rows={fo.lines}
          columns={[
            { label: "No.", className: "w-8 text-[#64748b]", render: (_l, i) => i + 1 },
            { label: "Description", render: (l) => <Describe description={l.description} model={l.model} /> },
            { label: "Qty", className: "w-16 text-right", render: (l) => num(l.quantity) },
            { label: "Unit", className: "w-12", render: (l) => l.unit },
            { label: "Unit price", className: "w-28 text-right tabular whitespace-nowrap", render: (l) => money(l.unitPrice, c) },
            { label: "VAT", className: "w-12 text-right tabular", render: (l) => `${l.vatRate}%` },
            { label: "Amount", className: "w-32 text-right tabular whitespace-nowrap font-medium", render: (l) => money(l.lineTotal, c) },
          ]}
        />
        <Totals
          currency={c}
          total={fo.total}
          totalLabel={fo.pricesIncludeVat ? "Total (VAT included)" : "Total (before VAT)"}
          rows={[{ label: `Deposit ${fo.depositPercent}%`, value: money(fo.deposit, c) }]}
        />
        <TextBlock title="Notes and requirements">{fo.notes}</TextBlock>
        <TextBlock title="General conditions">
          {[
            "1. Quality and specifications as agreed and as per the approved samples. The buyer may inspect the goods before loading.",
            "2. Packing suitable for export sea freight. Shipping marks as advised by the buyer.",
            "3. Please confirm this order and the ready date by signing and returning a copy.",
          ].join("\n")}
        </TextBlock>
        <SignOff left={`Buyer: ${company.name}`} right={`Supplier: ${factory?.name ?? fo.factory.name} (signature, stamp and date)`} />
      </Sheet>
    </>
  );
}
