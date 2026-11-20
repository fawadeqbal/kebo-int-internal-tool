import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { can, PAPER, ROUTE_NAME, type Tone } from "@kebo/shared";
import { Badge, cn, Notice, linkClass, Dash } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderFilesOf, orderFlowOf, orderMoneyOf, orderOf } from "@/lib/order-data";
import { orderName } from "@/lib/titles";
import { date, dayMonth, money, qty } from "@/lib/format";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { keyDates } from "@/components/orders/order-facts";
import { BoxFacts, RecordBox } from "@/components/common/record-box";
import { ItemsBox, type ItemsPhoneRow } from "@/components/records/items-box";
import { PaperFacts, PaperLayout } from "@/components/records/paper-boxes";
import { SheetFact, SheetPart } from "@/components/records/phone-items";
import { Totals } from "@/components/records/totals";
import type { LineColumn, LineRow } from "@/components/lines/line-table";
import { SectionFiles } from "@/components/order-sections/section-files";
import { AgreedWindow, OrderWindow } from "@/components/order-sections/overview-windows";
import { shipByNote } from "@/components/order-sections/agreed";
import type { OrderLineView, OrderView } from "@/lib/types-orders";
import type { OrderMoney } from "@/lib/types-money";
import { agreedAction, detailsAction } from "../actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await orderOf(id);
  return { title: orderName(o) };
}

const DASH = <Dash />;
const two = (v: string | number) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

/** Where one item is now, in one word (the Items box's last column): the furthest it has got. */
function whereOf(l: OrderLineView, o: OrderView, poSent: boolean): { text: string; tone: Tone } | null {
  if (l.type !== "goods") return null;
  const n = Number(l.quantity);
  const out = l.delivered ? Number(l.delivered.qty) : 0;
  if (out > 0) {
    const marked = !!l.delivered?.condition && l.delivered.condition !== "good";
    if (out >= n) return marked ? { text: "Delivered · marked", tone: "warn" } : { text: "Delivered", tone: "ok" };
    return { text: `${qty(out)} of ${qty(n)} delivered`, tone: "warn" };
  }
  if (o.word === "Arrived" || o.word === "Delivered" || o.word === "Done") return { text: "Arrived", tone: "info" };
  if (o.word === "Shipped") return { text: "On its way", tone: "info" };
  if (l.packing.packages) return { text: "Packed", tone: "info" };
  const got = Number(l.receivedQty);
  if (got >= n && n > 0) return { text: `Received${l.receivedOn ? ` ${dayMonth(l.receivedOn)}` : ""}`, tone: "ok" };
  if (got > 0) return { text: `${qty(got)} of ${qty(n)} in`, tone: "warn" };
  return poSent ? { text: "At the supplier", tone: "neutral" } : { text: "Not ordered yet", tone: "neutral" };
}

/** The order's items in the one items box: the quotation's columns, and where each item is now. */
function orderItems(o: OrderView, poSent: boolean) {
  const c = o.currency;
  const where = new Map(o.lines.map((l) => [l.id, whereOf(l, o, poSent)]));
  const pill = (id: string) => {
    const w = where.get(id);
    return w ? <Badge tone={w.tone}>{w.text}</Badge> : DASH;
  };
  const rows: LineRow[] = o.lines.map((l) => ({
    key: l.id,
    parentKey: l.no.includes(".") ? l.no.split(".")[0]! : null,
    values: { description: l.description, model: l.model ?? "", quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, lineTotal: l.lineTotal, where: where.get(l.id)?.text ?? "" },
  }));
  const plain: LineColumn[] = [
    { key: "description", label: "Description", width: "minmax(0,1fr)" },
    ...(o.lines.some((l) => l.model) ? [{ key: "model", label: "Model / part no.", width: "8rem" }] : []),
    { key: "quantity", label: "Quantity", width: "4rem", align: "right" },
    { key: "unit", label: "Unit", width: "4rem" },
    { key: "unitPrice", label: `Unit price ${c}`, width: "6.5rem", align: "right" },
    { key: "lineTotal", label: `Amount ${c}`, width: "7.5rem", align: "right" },
    { key: "where", label: "Where it is", width: "9.5rem" },
  ];
  const columns = plain.map((col): LineColumn => {
    if (col.key === "quantity") return { ...col, format: (v) => qty(v.quantity!) };
    if (col.key === "unitPrice") return { ...col, format: (v) => (Number(v.unitPrice) > 0 ? two(v.unitPrice!) : DASH) };
    if (col.key === "lineTotal") return { ...col, format: (v) => (Number(v.lineTotal) > 0 ? <span className="font-semibold">{two(v.lineTotal!)}</span> : DASH) };
    if (col.key === "where") return { ...col, format: (_v, r) => pill(r.key) };
    return col;
  });
  const phone: ItemsPhoneRow[] = o.lines.map((l) => ({
    key: l.id,
    no: l.no,
    part: l.no.includes("."),
    title: l.description.split("\n")[0],
    under: l.model || undefined,
    sub: Number(l.unitPrice) > 0 ? `${qty(l.quantity)} ${l.unit} × ${two(l.unitPrice)}` : `${qty(l.quantity)} ${l.unit}`,
    amount: Number(l.lineTotal) > 0 ? two(l.lineTotal) : undefined,
    more: where.get(l.id) ? pill(l.id) : undefined,
    sheet: {
      sub: [l.model, `${qty(l.quantity)} ${l.unit}`].filter(Boolean).join(" · "),
      body: (
        <SheetPart>
          <SheetFact label="Unit price">{Number(l.unitPrice) > 0 ? money(l.unitPrice, c) : "—"}</SheetFact>
          <SheetFact label="Amount">{Number(l.lineTotal) > 0 ? money(l.lineTotal, c) : "—"}</SheetFact>
          <SheetFact label="Where it is">{where.get(l.id)?.text ?? "—"}</SheetFact>
        </SheetPart>
      ),
    },
  }));
  return { rows, columns, plain, numbers: o.lines.map((l) => l.no), phone };
}

/** A part of the plan: paid (on the day it was paid in full), or what is still to come. */
function partState(i: OrderMoney["plan"]["items"][number], currency: string): string {
  if (i.status === "paid") {
    const last = i.request.receipts.at(-1)?.paidOn;
    return last ? `paid ${dayMonth(last)}` : "paid";
  }
  if (Number(i.paid) > 0) return `${money(i.open, currency)} to come`;
  return money(i.amount, currency);
}

/**
 * The order's Overview, on the pieces (canvas row "The order on the same pieces", board "The order's Overview, on
 * the pieces"): the boxes of the quotation it was made from — Customer | Delivery & payment, the items with where
 * each one is, Warranty & conditions — each with its own Edit (that part only). No list of stages: each stage's
 * word is on its tab, the next step is the header's one strong button, the dates are in the panel; a notice
 * only when something is late.
 */
export default async function OrderOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const [files, m, flow] = await Promise.all([optional(() => orderFilesOf(id)), optional(() => orderMoneyOf(id)), optional(() => orderFlowOf(id))]);
  const base = `/orders/${o.id}`;
  const now = today();
  const open = o.status === "open";
  const canEdit = can(me, "orders.update") && open;
  const canFiles = !!files?.canUpload && open;
  const a = o.agreed ?? null;
  const q = o.quotation;
  const from = q ? `${q.refNo} R${q.number}` : null;
  const poSent = !!flow?.factory.orderedOn || o.word !== "Confirmed";
  const route = m?.route.route ?? flow?.payment.route ?? null;
  const payLine = m
    ? [route ? ROUTE_NAME[route] : "How they pay: not decided yet", ...m.plan.items.map((i) => `${i.label}${i.status === "paid" ? ", paid" : ""}`)].join(" · ")
    : "The plan is on the Payment tab.";

  // Something late: the one notice, with its own way to fix it (the dates themselves are in the panel).
  const late = open ? keyDates(o, flow, now).find((d) => d.tone === "late" && d.label === "Goods ready") : undefined;

  const items = orderItems(o, poSent);
  const terms = a
    ? PAPER.ofOrder({
        incoterm: o.incoterm,
        incotermPlace: o.incotermPlace,
        portOfDischarge: a.portOfDischarge,
        leadTime: a.leadTime,
        shipBy: o.shipBy ? date(o.shipBy) : null,
        deliveryConditions: a.deliveryConditions,
        paymentRoute: route,
        paymentParts: [],
        paymentConditions: a.paymentConditions,
        warranty: a.warranty,
        warrantyMonths: a.warrantyMonths,
        warrantyFrom: a.warrantyFrom,
        notes: a.notes,
      })
    : null;
  const note = a ? shipByNote(a, o.shipBy) : null;
  const agreedWindow = (part: "terms" | "conditions", title: string) =>
    a &&
    canEdit && (
      <AgreedWindow
        part={part}
        title={title}
        sub={`${o.refNo}${from ? ` · as agreed in ${from}${q?.acceptedOn ? `, accepted ${date(q.acceptedOn)}` : ""}` : ""}`}
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
    );
  // Changed after the quotation was accepted: how often, to the history (said once, on Delivery & payment).
  const changed =
    a && a.changes > 0 ? (
      <Link href={`${base}/history?q=${encodeURIComponent("agreed with the customer")}`} className={cn(linkClass, "px-1 text-xs")}>
        Changed {a.changes}×
      </Link>
    ) : undefined;

  const payment: ReactNode =
    m && m.plan.items.length > 0 ? (
      <span className="flex flex-col gap-0.5">
        {m.plan.items.map((i) => (
          <span key={i.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
            <span className="min-w-0">{i.label}</span>
            <span className={cn("shrink-0 text-md font-normal tabular", i.status === "paid" ? "text-ok" : "text-text-2")}>{partState(i, o.currency)}</span>
          </span>
        ))}
      </span>
    ) : (
      <Link href={`${base}/payment`} className="font-normal text-primary underline underline-offset-2">
        On the Payment tab
      </Link>
    );

  return (
    <>
      {late && (
        <Notice
          tone="bad"
          title={`Goods were due ${late.value.replace(" · ", ", ").replace(/ late$/, " ago")}`}
          action={
            canEdit ? (
              <Link href={`${base}/production?do=ready-date`} scroll={false}>
                Change the ready date
              </Link>
            ) : undefined
          }
        >
          The supplier has not given a new date.
        </Notice>
      )}
      <PaperLayout
        party={
          <RecordBox
            title="Customer"
            what="their order"
            canEdit={canEdit}
            edit={
              <OrderWindow
                orderId={o.id}
                sub={`${o.refNo} · ${o.customer.name}`}
                action={detailsAction.bind(null, o.id)}
                today={now}
                canFiles={canFiles}
                values={{ customerRef: o.customerRef ?? null, customerPoOn: o.customerPoOn ?? null }}
              />
            }
            files={<SectionFiles orderId={o.id} section="order" canAdd={false} quiet />}
          >
            <BoxFacts
              rows={[
                [
                  "Customer",
                  <Link key="c" href={`/customers/${o.customer.id}`} className="text-primary underline underline-offset-2">
                    {o.customer.name}
                  </Link>,
                ],
                ["Contact", o.contactName ?? null],
                ["Their order no.", o.customerRef ?? null],
                ["Their order date", o.customerPoOn ? date(o.customerPoOn) : null],
                [
                  "They accepted",
                  q ? (
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
                ],
              ]}
            />
          </RecordBox>
        }
        terms={
          terms && (
            <RecordBox title="Delivery & payment" what="delivery and payment" canEdit={canEdit} tools={changed} edit={agreedWindow("terms", "Delivery & payment")}>
              <PaperFacts
                terms={terms}
                kind="order"
                box="terms"
                values={{ route: route ? ROUTE_NAME[route] : null, payment }}
                after={{
                  shipBy: note && (
                    <span className={cn("flex items-start gap-1 text-xs font-normal", note.ok ? "text-ok" : "text-text-2")}>
                      {note.ok && <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />}
                      {cap(note.text)}
                    </span>
                  ),
                }}
              />
            </RecordBox>
          )
        }
        prices={
          <ItemsBox
            title="Items"
            count={[`${o.lines.length} item${o.lines.length === 1 ? "" : "s"}`, o.currency].join(" · ")}
            what="items"
            canEdit={false}
            label={`${o.refNo} · items`}
            rows={items.rows}
            columns={items.columns}
            numbers={items.numbers}
            phone={items.phone}
            totals={<Totals rows={[{ label: "Total", value: money(o.total, o.currency), big: true }]} />}
            empty="No items."
          />
        }
        conditions={
          terms && (
            <RecordBox title="Warranty & conditions" what="the warranty and conditions" canEdit={canEdit} edit={agreedWindow("conditions", "Warranty & conditions")}>
              <PaperFacts terms={terms} kind="order" box="conditions" />
            </RecordBox>
          )
        }
      />
    </>
  );
}
