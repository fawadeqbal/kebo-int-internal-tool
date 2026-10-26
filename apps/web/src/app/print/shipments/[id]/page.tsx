import type { Metadata } from "next";
import { api } from "@/lib/api";
import { load } from "@/lib/session";
import { date, qty } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import type { ShipmentDoc } from "@/lib/types-orders";
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
} from "@/components/print/doc";
import { PrintToolbar } from "@/components/print/toolbar";
import { backTo, companyOr, customerOr } from "@/components/print/data";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const s = await load(() => api.get<ShipmentDoc>(`/shipments/${id}`));
  return { title: `Packing list ${s.refNo}` };
}

const cbm = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const kg = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The packing list of one shipment: what is in which packages, weights, volume and the marks. */
export default async function PackingListPrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const s = await load(() => api.get<ShipmentDoc>(`/shipments/${id}`));
  const [company, customer] = await Promise.all([
    companyOr(s.companySnapshot),
    customerOr(s.customerSnapshot, async () => ({ customerId: (await api.get<OrderView>(`/orders/${s.order.id}`)).customer.id })),
  ]);
  const invoices = s.invoices.filter((i) => i.status === "issued" && i.number).map((i) => i.number);
  const types = [...new Set(s.lines.map((l) => l.packageType))];
  const packages = `${s.totals.packages} ${types.length === 1 ? types[0] : "packages"}`.toUpperCase();

  return (
    <>
      <PrintToolbar
        title={`Packing list ${s.refNo}`}
        backHref={backTo(sp.back, `/orders/${s.order.id}/shipments`)}
        pdfHref={`/pdf/shipments/${s.id}`}
      />
      <Sheet>
        <Letterhead
          company={company}
          title="Packing list"
          number={s.refNo}
          meta={[
            { label: "Date", value: date(s.departedOn ?? s.etd ?? s.createdAt) },
            { label: "Our order", value: s.order.refNo },
            ...(invoices.length ? [{ label: "Invoice", value: invoices.join(", ") }] : []),
          ]}
        />
        <Columns>
          <PartyBox title="Consignee" party={customerLines(customer)} />
          <FactsBox
            title="Shipping details"
            items={[
              { label: "Incoterm", value: `${s.order.incoterm}${s.order.incotermPlace ? ` ${s.order.incotermPlace}` : ""}` },
              { label: "Port of loading", value: s.portOfLoading },
              { label: "Port of discharge", value: s.portOfDischarge },
              { label: "Final destination", value: s.finalDestination },
              { label: "Vessel / transport", value: s.transport },
              { label: "Forwarder", value: s.forwarder },
              { label: "B/L number", value: s.blNo },
              { label: "Containers", value: s.containerNos },
              { label: "Seals", value: s.sealNos },
              { label: "ETD / ETA", value: s.etd || s.eta ? `${s.etd ? date(s.etd) : "—"} / ${s.eta ? date(s.eta) : "—"}` : null },
            ]}
          />
        </Columns>
        <LinesTable
          rows={s.lines}
          columns={[
            { label: "No.", className: "w-8 text-[#64748b]", render: (_l, i) => i + 1 },
            { label: "Description of goods", render: (l) => <Describe description={l.description} model={l.model} hsCode={l.hsCode} /> },
            {
              label: "Quantity",
              className: "w-20 text-right whitespace-nowrap",
              render: (l) => (
                <>
                  {num(l.quantity)} {l.unit}
                </>
              ),
            },
            {
              label: "Packages",
              className: "w-24 text-right whitespace-nowrap",
              render: (l) => (
                <>
                  <span className="tabular">{l.packages}</span> <span className="text-[8pt] text-[#64748b]">{l.packageType}</span>
                </>
              ),
            },
            { label: "Net kg", className: "w-20 text-right tabular", render: (l) => kg(l.netWeightKg) },
            { label: "Gross kg", className: "w-20 text-right tabular", render: (l) => kg(l.grossWeightKg) },
            { label: "CBM", className: "w-16 text-right tabular", render: (l) => cbm(l.cbm) },
          ]}
          foot={
            <tr className="bg-kebo-light font-bold">
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 text-kebo-deep uppercase">Total</td>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5 text-right tabular">{s.totals.packages}</td>
              <td className="px-2 py-1.5 text-right tabular">{kg(s.totals.netKg)}</td>
              <td className="px-2 py-1.5 text-right tabular">{kg(s.totals.grossKg)}</td>
              <td className="px-2 py-1.5 text-right tabular">{cbm(s.totals.cbm)}</td>
            </tr>
          }
        />
        <p className="mt-3 rounded-md bg-kebo-paper px-3 py-2 text-[8.5pt]">
          <span className="text-[#64748b]">Total: </span>
          <span className="font-medium">
            {packages} ({qty(s.lines.reduce((t, l) => t + Number(l.quantity), 0))} units) · net {kg(s.totals.netKg)} kg · gross{" "}
            {kg(s.totals.grossKg)} kg · {cbm(s.totals.cbm)} m³
          </span>
        </p>
        <div className="grid grid-cols-2 gap-6">
          <TextBlock title="Shipping marks" mono className="rounded-md border border-dashed border-[#94a3b8] p-3">
            {s.marks}
          </TextBlock>
          <TextBlock title="Notes">{s.notes}</TextBlock>
        </div>
        <SignOff left={`For and on behalf of ${company.name}`} />
      </Sheet>
    </>
  );
}
