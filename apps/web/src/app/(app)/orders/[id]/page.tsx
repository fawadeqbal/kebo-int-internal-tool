import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { can, ROUTE_NAME } from "@kebo/shared";
import { Badge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderFilesOf, orderMoneyOf, orderOf, orderSectionsOf } from "@/lib/order-data";
import { orderName } from "@/lib/titles";
import { date, dayMonth, money } from "@/lib/format";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { HeaderSlot } from "@/components/orders/header-slot";
import { FileChip } from "@/components/files/file-tools";
import { OrderPage } from "@/components/order-sections/order-side";
import { Section } from "@/components/order-sections/section";
import { SectionFiles } from "@/components/order-sections/section-files";
import { AgreedWindow, OrderWindow } from "@/components/order-sections/overview-windows";
import { AgreedGroups } from "@/components/order-sections/agreed";
import type { OrderView } from "@/lib/types-orders";
import { agreedAction, detailsAction, moveStageAction } from "../actions";
import { StageActions } from "./forms";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await orderOf(id);
  return { title: orderName(o) };
}

const DASH = <span className="font-normal text-muted">—</span>;

/** The Change window's line under Ship by: how it is worked out, and when to type one. */
function shipHintOf(a: NonNullable<OrderView["agreed"]>): string {
  const f = a.shipByFrom;
  const days = a.leadDays ?? 0;
  if (f?.by === "typed") return "Typed by hand. Empty it to have it worked out from the lead time again.";
  if (f?.by === "drawings") return "Type it once the drawings are approved.";
  if (f?.by === "order") return `Worked out: ${days} days after the order. Type a date only when the customer agreed another one.`;
  if (f?.by === "deposit")
    return f.on
      ? `Worked out: ${days} days after the deposit of ${dayMonth(f.on)}. Type a date only when the customer agreed another one.`
      : "Worked out once the deposit is in. Type a date only when the customer agreed one.";
  return "Type a date only when the customer agreed one.";
}

/**
 * The order's Overview (design "the order, final"; "terms that travel"): where each stage stands in one line;
 * their order (their PO and the quotation they accepted); what was agreed with the customer (Delivery · Payment ·
 * Warranty · Conditions, copied from the quotation when it was accepted); the items with what came in, was
 * packed and was delivered; and every file of the order. Nothing is done here
 * except their PO, changing what was agreed and closing the order; each line opens its tab.
 */
export default async function OrderOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const [sections, files, m] = await Promise.all([optional(() => orderSectionsOf(id)), optional(() => orderFilesOf(id)), optional(() => orderMoneyOf(id))]);
  const base = `/orders/${o.id}`;
  const now = today();
  const open = o.status === "open";
  const canEdit = can(me, "orders.update") && open;
  const ordered = o.word !== "Confirmed";
  // Closing: once the goods are delivered (or have left, for a company without Delivery & SAT).
  const closable = canEdit && o.next?.to === "done" && (o.word === "Delivered" || !(sections?.stages ?? []).includes("delivery"));
  const all = files?.files ?? [];
  const n = (v: string) => Number(v).toLocaleString("en-US");
  const a = o.agreed ?? null;
  const q = o.quotation;
  const from = q ? `${q.refNo} R${q.number}` : null;
  const payLine = m
    ? [m.route.route ? ROUTE_NAME[m.route.route] : "How they pay: not decided yet", ...m.plan.items.map((i) => `${i.label}${i.status === "paid" ? ", paid" : ""}`)].join(" · ")
    : "The plan is on the Payment tab.";

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
        title="Their order"
        cols={4}
        rows={[
          { label: "Customer's order no.", value: o.customerRef },
          { label: "Customer's order date", value: o.customerPoOn ? date(o.customerPoOn) : null },
          {
            label: "They accepted",
            value: q ? (
              <>
                <Link href={`/inquiries/${o.inquiry.id}/quotation`} className="text-primary underline underline-offset-2">
                  {from}
                </Link>
                <span className="font-normal">
                  {q.option ? ` · Option ${q.option}` : ""}
                  {q.acceptedOn ? ` · ${dayMonth(q.acceptedOn)}` : ""}
                </span>
              </>
            ) : (
              date(o.orderedOn)
            ),
          },
        ]}
        actions={
          canEdit && (
            <OrderWindow
              orderId={o.id}
              sub={`${o.refNo} · ${o.customer.name}`}
              action={detailsAction.bind(null, o.id)}
              today={now}
              canFiles={!!files?.canUpload}
              values={{ customerRef: o.customerRef ?? null, customerPoOn: o.customerPoOn ?? null }}
            />
          )
        }
        files={<SectionFiles orderId={o.id} section="order" canAdd={!!files?.canUpload && open} />}
      />

      {a && (
        <Section
          id="agreed"
          title="Agreed with the customer"
          actions={
            <>
              {/* (The quotation it came from is in Their order, above: said once.) */}
              {a.changes > 0 && (
                <Link href={`${base}/history?q=${encodeURIComponent("agreed with the customer")}`} className="text-xs font-medium text-primary hover:underline">
                  Changed {a.changes}×
                </Link>
              )}
              {canEdit && (
                <AgreedWindow
                  title={`What we agreed with ${o.customer.name}`}
                  sub={`${o.refNo}${from ? ` · from ${from}${q?.acceptedOn ? `, accepted ${date(q.acceptedOn)}` : ""}` : ""}`}
                  action={agreedAction.bind(null, o.id)}
                  values={{
                    incoterm: o.incoterm,
                    incotermPlace: o.incotermPlace,
                    portOfDischarge: a.portOfDischarge,
                    leadDays: a.leadDays,
                    leadFrom: a.leadFrom,
                    shipBy: o.shipBy,
                    warrantyMonths: a.warrantyMonths,
                    warrantyFrom: a.warrantyFrom,
                    warranty: a.warranty,
                    deliveryConditions: a.deliveryConditions,
                    paymentConditions: a.paymentConditions,
                    notes: a.notes,
                  }}
                  shipHint={shipHintOf(a)}
                  payment={payLine}
                  paymentHref={`${base}/payment`}
                />
              )}
            </>
          }
        >
          <AgreedGroups o={o} m={m} base={base} satTab={(sections?.stages ?? []).includes("delivery")} />
        </Section>
      )}

      {/* "The customer and the factory, side by side" (sideBySide / SideBySideTable in order-sections/agreed) is hidden
          for now (Fawad, 16 Nov 2026): quotation options will each carry their own terms first. */}

      <section aria-label="Items" className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <h2 className="px-5 pt-4 pb-2 text-[15px] font-bold">
          Items <span className="font-normal text-muted">· {o.lines.length}</span>
        </h2>
        <Table>
          <THead>
            <tr>
              <Th>No.</Th>
              <Th>Item</Th>
              <Th className="text-right">Quantity</Th>
              <Th className="text-right">Amount</Th>
              <Th>From the supplier</Th>
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
                      <Badge tone="neutral">At the supplier</Badge>
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
          <p className="px-[18px] pb-3.5 text-[12.5px] text-text-2">No file yet.</p>
        )}
      </Section>
    </OrderPage>
  );
}
