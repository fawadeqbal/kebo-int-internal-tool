import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { can, ORDER_SECTION_LABEL } from "@kebo/shared";
import { Badge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderFilesOf, orderOf, orderSectionsOf } from "@/lib/order-data";
import { date, money } from "@/lib/format";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { HeaderSlot } from "@/components/orders/header-slot";
import { FileChip } from "@/components/files/file-tools";
import { OrderPage } from "@/components/order-sections/order-side";
import { Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { OrderWindow } from "@/components/order-sections/overview-windows";
import { detailsAction, moveStageAction } from "../actions";
import { StageActions } from "./forms";
import { incotermOf } from "./shared";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await orderOf(id);
  return { title: `Order ${o.refNo}` };
}

const DASH = <span className="font-normal text-muted">—</span>;

/**
 * The order's Overview (design "the order, final"): where each stage stands in one line, the order
 * itself, its items with what came in, was packed and was delivered, and every file of the order.
 * Nothing is done here except editing the order's own details and closing it; each line opens its tab.
 */
export default async function OrderOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const [sections, files] = await Promise.all([optional(() => orderSectionsOf(id)), optional(() => orderFilesOf(id))]);
  const base = `/orders/${o.id}`;
  const now = today();
  const open = o.status === "open";
  const canEdit = can(me, "orders.update") && open;
  const ordered = o.word !== "Confirmed";
  // Closing: once the goods are delivered (or have left, for a company without Delivery & SAT).
  const closable = canEdit && o.next?.to === "done" && (o.word === "Delivered" || !(sections?.stages ?? []).includes("delivery"));
  const all = files?.files ?? [];
  const n = (v: string) => Number(v).toLocaleString("en-US");

  return (
    <OrderPage id={id}>
      {closable && (
        <HeaderSlot>
          <StageActions key={o.stage} next={o.next} back={null} action={moveStageAction.bind(null, o.id)} today={now} readyOn={o.readyOn} shippedOn={o.shippedOn} blNo={o.blNo} />
        </HeaderSlot>
      )}
      {o.status === "closed" && o.back && can(me, "orders.update") && (
        <HeaderSlot>
          <StageActions key={o.stage} next={null} back={o.back} action={moveStageAction.bind(null, o.id)} today={now} readyOn={o.readyOn} shippedOn={o.shippedOn} blNo={o.blNo} />
        </HeaderSlot>
      )}

      {sections && sections.stands.length > 0 && (
        <section aria-label="Where it stands" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <h2 className="px-5 pt-4 pb-2.5 text-[15px] font-bold">Where it stands</h2>
          <ul>
            {sections.stands.map((s) => (
              <li key={s.stage} className="border-t border-line">
                <Link
                  href={`${base}/${s.stage}`}
                  className="grid min-h-[50px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-2 text-[13px] hover:bg-surface-2/60 sm:grid-cols-[150px_150px_minmax(0,1fr)_auto_14px]"
                >
                  <b className="font-semibold">{s.label}</b>
                  <span className="justify-self-end sm:justify-self-start">
                    <Badge tone={s.tone}>{s.word}</Badge>
                  </span>
                  <span className="col-span-2 text-text-2 sm:col-span-1">{s.fact}</span>
                  <span className="col-span-2 text-xs text-text-2 sm:col-span-1">{s.missing}</span>
                  <ChevronRight className="size-3.5 text-text-2 max-sm:hidden" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section
        title={ORDER_SECTION_LABEL.order}
        cols={3}
        rows={[
          {
            label: "Customer",
            value: (
              <>
                <Link href={`/customers/${o.customer.id}`} className="text-primary hover:underline">
                  {o.customer.name}
                </Link>
                {o.contactName ? ` · ${o.contactName}` : ""}
              </>
            ),
          },
          { label: "Their PO", value: o.customerRef ? `${o.customerRef}${o.customerPoOn ? ` · ${date(o.customerPoOn)}` : ""}` : null },
          {
            label: "Accepted",
            value: o.quotation ? (
              <>
                <Link href={`/inquiries/${o.inquiry.id}/quotation`} className="text-primary hover:underline">
                  {o.quotation.refNo} R{o.quotation.number}
                </Link>
                {o.quotation.option ? ` · Option ${o.quotation.option}` : ""}
              </>
            ) : (
              date(o.orderedOn)
            ),
          },
          { label: "Incoterm", value: incotermOf(o) },
          { label: "Consignee", value: o.consignee || o.customer.name },
          { label: "Notify party", value: o.notifyParty || "Same as consignee" },
          { label: "Delivery address", value: o.deliveryAddress },
          { label: "Ship by", value: o.shipBy ? date(o.shipBy) : null },
          { label: "Port of discharge", value: o.portOfDischarge },
        ]}
        actions={
          canEdit && (
            <OrderWindow
              orderId={o.id}
              sub={`${o.refNo} · ${o.customer.name}`}
              action={detailsAction.bind(null, o.id)}
              today={now}
              customer={o.customer.name}
              heading={o.inquiry.title}
              canFiles={!!files?.canUpload}
              values={{
                customerRef: o.customerRef ?? null,
                customerPoOn: o.customerPoOn ?? null,
                consignee: o.consignee ?? null,
                notifyParty: o.notifyParty ?? null,
                deliveryAddress: o.deliveryAddress ?? null,
                shipBy: o.shipBy,
                portOfDischarge: o.portOfDischarge,
                documentTitle: o.documentTitle,
              }}
            />
          )
        }
        files={<SectionFiles orderId={o.id} section="order" canAdd={!!files?.canUpload && open} />}
      />

      <section aria-label="Items" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <h2 className="px-5 pt-4 pb-2 text-[15px] font-bold">
          Items <span className="font-normal text-muted">· {o.lines.length}</span>
        </h2>
        <Table>
          <THead>
            <tr>
              <Th>No.</Th>
              <Th>Item</Th>
              <Th className="text-right">Qty</Th>
              <Th className="text-right">Amount</Th>
              <Th>From the factory</Th>
              <Th>Packed</Th>
              <Th>Delivered</Th>
            </tr>
          </THead>
          <tbody>
            {o.lines.map((l) => {
              const goods = l.type === "goods";
              const qty = Number(l.quantity);
              const got = Number(l.receivedQty);
              const out = l.delivered ? Number(l.delivered.qty) : 0;
              const marked = l.delivered?.condition && l.delivered.condition !== "good";
              return (
                <Tr key={l.id}>
                  <Td className="tabular text-text-2">{l.no}</Td>
                  <Td>
                    <span className="font-semibold">{l.description}</span>
                    {l.model && <span className="text-text-2"> · {l.model}</span>}
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {n(l.quantity)} {l.unit}
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">{money(l.lineTotal, o.currency)}</Td>
                  <Td className="whitespace-nowrap">
                    {!goods ? (
                      DASH
                    ) : got >= qty && qty > 0 ? (
                      <Badge tone="ok">Received{l.receivedOn ? ` ${date(l.receivedOn)}` : ""}</Badge>
                    ) : got > 0 ? (
                      <Badge tone="warn">
                        {n(l.receivedQty)} of {n(l.quantity)}
                      </Badge>
                    ) : ordered ? (
                      <Badge tone="neutral">At the factory</Badge>
                    ) : (
                      DASH
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">{goods && l.packing.packages ? `${l.packing.packages.toLocaleString("en-US")} ${l.packing.packageType ?? "packages"}` : DASH}</Td>
                  <Td className="whitespace-nowrap">
                    {!goods || !l.delivered || out <= 0 ? (
                      DASH
                    ) : out >= qty && !marked ? (
                      <Badge tone="ok">Delivered</Badge>
                    ) : (
                      <Badge tone="warn">{out >= qty ? "Delivered · marked" : `${n(l.delivered.qty)} of ${n(l.quantity)}`}</Badge>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line-strong font-bold">
              <td className="px-3.5 py-3" />
              <td className="px-3.5 py-3" colSpan={2}>
                Total {o.currency}
              </td>
              <td className="px-3.5 py-3 text-right tabular">{money(o.total, o.currency)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </Table>
      </section>

      <Section title="All files of this order" state={`${all.length} file${all.length === 1 ? "" : "s"}`}>
        {all.length > 0 ? (
          <ul className="flex flex-wrap gap-x-5 gap-y-2 px-[18px] pb-3.5 text-[12.5px]">
            {all.map((f) => (
              <li key={f.id} className="flex min-w-0 items-center gap-1.5">
                <FileChip file={f} set={all} compact />
                <span className="text-text-2">· {f.sectionLabel ?? f.attachedTo.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-[18px] pb-3.5 text-[12.5px] text-text-2">No file yet. A file is added in its own section.</p>
        )}
      </Section>
    </OrderPage>
  );
}
