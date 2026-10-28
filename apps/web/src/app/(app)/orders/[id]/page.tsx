import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { can, INSTALMENT_STATUS_LABEL } from "@kebo/shared";
import { Badge, Card, CardBody, CardHeader, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderMoneyOf, orderOf } from "@/lib/order-data";
import { date, dateTime, money, qty } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { NoteForm } from "../../deals/[id]/panels";
import { detailsAction, orderNoteAction } from "../actions";
import { DetailsForm } from "./forms";
import { goodsOf, incotermOf, termsOf } from "./shared";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await orderOf(id);
  return { title: `Order ${o.refNo}` };
}

const more = "flex items-center gap-1 text-sm font-medium text-primary hover:underline";

/** The order at a glance: its goods, the next payment, the notes, and its details. */
export default async function OrderOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const [m, deal] = await Promise.all([orderMoneyOf(id), optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`))]);
  const base = `/orders/${o.id}`;
  const open = o.status !== "cancelled";
  const goods = goodsOf(o);
  const name = (uid: string | null) => (uid ? (deal?.people[uid] ?? "Someone") : "System");
  const next = m.plan.next;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        {goods.length > 0 && (
          <Card>
            <CardHeader
              title="Goods at a glance"
              description={o.goods.allReceived ? (o.goods.packed ? "Everything is in and packed." : "Everything is in; the packing list is next.") : `${o.goods.received} of ${o.goods.lines} complete`}
              actions={
                <Link href={`${base}/goods`} className={more}>
                  Goods and packing <ArrowRight className="size-4" aria-hidden />
                </Link>
              }
            />
            <ul className="divide-y divide-line">
              {goods.map((l) => {
                const inQty = Number(l.receivedQty);
                const full = inQty >= Number(l.quantity);
                return (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="mr-2 inline-block w-8 text-muted tabular">{l.no}</span>
                      <span className="font-medium">{l.description.split("\n")[0]}</span>
                      <span className="text-muted">
                        {" "}
                        × {qty(l.quantity)} {l.unit}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-xs tabular", full ? "text-ok" : inQty > 0 ? "text-warn" : "text-muted")}>
                      {full ? "all in" : `${qty(inQty)} of ${qty(l.quantity)} in`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Money from the customer"
            description={`${termsOf(o)} · in ${o.currency}`}
            actions={
              <Link href={`${base}/money`} className={more}>
                Money <ArrowRight className="size-4" aria-hidden />
              </Link>
            }
          />
          <CardBody className="flex flex-col gap-3 text-sm">
            {next ? (
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span>
                  Next: <span className="font-medium">{next.label}</span>
                  {next.dueOn && <span className="text-muted"> · due {date(next.dueOn)}</span>}{" "}
                  {next.status !== "open" && <Badge tone={next.status === "late" ? "bad" : "warn"}>{INSTALMENT_STATUS_LABEL[next.status]}</Badge>}
                </span>
                <span className="font-semibold tabular">{money(next.open, o.currency)}</span>
              </p>
            ) : (
              <p className="text-ok">Nothing more to receive.</p>
            )}
            <ul className="flex flex-col gap-1">
              {m.plan.items.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className={cn(Number(i.open) <= 0 ? "text-muted line-through" : "text-text-2")}>{i.label}</span>
                  <span className="text-muted tabular">
                    {money(i.paid, o.currency)} of {money(i.amount, o.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {deal && (
          <Card>
            <CardHeader title="Notes" description={`Shared with deal ${deal.refNo}`} />
            <CardBody className="flex flex-col gap-4">
              {open && <NoteForm action={orderNoteAction.bind(null, o.id, deal.id)} />}
              {deal.notes.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {deal.notes.map((n) => (
                    <li key={n.id} className="rounded-lg border border-line p-3">
                      <p className="text-sm whitespace-pre-line">{n.body}</p>
                      <p className="mt-1 text-xs text-muted">
                        {name(n.authorId)} · {dateTime(n.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No notes yet.</p>
              )}
            </CardBody>
          </Card>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-5">
        <Card>
          <CardHeader title="Details" description="Dates and shipping; the ready date and B/L number tick their steps" />
          <CardBody>
            <DetailsForm
              action={detailsAction.bind(null, o.id)}
              canEdit={can(me, "orders.update") && open}
              today={today()}
              fixed={[
                { label: "Incoterm", value: incotermOf(o) },
                { label: "Payment terms", value: termsOf(o) },
                { label: "Ordered on", value: date(o.orderedOn) },
              ]}
              values={{
                shipBy: o.shipBy,
                readyOn: o.readyOn,
                shippedOn: o.shippedOn,
                blNo: o.blNo,
                documentTitle: o.documentTitle,
                portOfDischarge: o.portOfDischarge,
              }}
              shown={{
                shipBy: o.shipBy ? date(o.shipBy) : "Not set",
                readyOn: o.readyOn ? date(o.readyOn) : "Not known yet",
                shippedOn: o.shippedOn ? date(o.shippedOn) : "Not shipped",
                blNo: o.blNo ?? "—",
              }}
            />
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
