import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { can, shipByVsLc, STEP_PATH } from "@kebo/shared";
import { buttonClass, Card, CardBody, CardHeader, cn } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderFlowOf, orderHistoryOf, orderMoneyOf, orderOf, orderStepsOf } from "@/lib/order-data";
import { date, dateTime } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { orderCostsSetup } from "@/components/orders/costs-data";
import { compactChanges } from "@/components/orders/side-panel";
import {
  KeepAnEye,
  KeyDates,
  MoneyCard,
  OrderFigures,
  OrderStory,
  overviewFacts,
  RecentChanges,
  WhatNext,
  WhatTheyBought,
  WhoIsInvolved,
} from "@/components/orders/overview";
import { NoteForm } from "../../inquiries/[id]/panels";
import { detailsAction, orderNoteAction } from "../actions";
import { DetailsCard } from "./forms";
import { incotermOf, termsOf } from "./shared";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const o = await orderOf(id);
  return { title: `Order ${o.refNo}` };
}

/** How many changes Recent changes loads (five show, the rest scroll). */
const CHANGES = 100;

/**
 * The order for a manager, top to bottom: what to do now; the order in one
 * sentence and its journey; six figures; what happens next and what to watch,
 * the money and what they bought beside Details, who's involved and the key
 * dates; the notes; and the recent changes of every step.
 */
export default async function OrderOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const [steps, m, flow, recent, deal, costs] = await Promise.all([
    orderStepsOf(id),
    optional(() => orderMoneyOf(id)),
    optional(() => orderFlowOf(id)),
    optional(() => orderHistoryOf(id, undefined, CHANGES)),
    optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`)),
    orderCostsSetup(id).then((x) => x?.costs ?? null),
  ]);
  const base = `/orders/${o.id}`;
  const open = o.status !== "cancelled";
  const now = today();
  const name = (uid: string | null) => (uid ? (deal?.people[uid] ?? "Someone") : "System");
  const doNow = steps.doNow;
  const finished = o.status === "closed" && !doNow;
  const f = overviewFacts({ o, steps, flow, m, costs, deal, now });
  // Shipped on, the B/L and the container are Shipment 1's: edited on Shipping when the company has the module.
  const onShipping = flow?.modules.shipping ?? true;
  const lcLatest = flow?.payment.route === "letter_of_credit" ? (flow.payment.bankContract?.latestShipOn ?? null) : null;

  return (
    <div className="flex flex-col gap-5">
      {open && doNow ? (
        <section
          aria-label="Do this now"
          className={cn(
            "flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
            doNow.late ? "border-bad/30 bg-bad-soft" : "border-primary/20 bg-primary-soft/70",
          )}
        >
          <p className={cn("flex min-w-0 items-start gap-2 text-sm", doNow.late && "text-bad")}>
            {doNow.late ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            )}
            <span>
              <span className="font-semibold">Do this now · {doNow.title}</span>{" "}
              <span className={doNow.late ? "" : "text-text-2"}>
                {doNow.dueOn ? `${doNow.late ? "was due" : "is due"} ${date(doNow.dueOn)}` : doNow.needs ? `needs ${doNow.needs}` : ""} (
                {doNow.label})
              </span>
            </span>
          </p>
          <Link href={`${base}/${STEP_PATH[doNow.step]}`} className={buttonClass(doNow.late ? "danger" : "primary", "sm", "w-fit")}>
            Open {doNow.label}
          </Link>
        </section>
      ) : finished ? (
        <p className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-soft px-4 py-3 text-sm">
          <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
          <span className="font-medium">Done: every step is ticked and the order is closed.</span>
        </p>
      ) : null}


      <OrderStory o={o} f={f} />
      <OrderFigures o={o} f={f} steps={steps} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="@container flex min-w-0 flex-col gap-5">
          <div className="grid items-start gap-5 @[700px]:grid-cols-[1.2fr_1fr]">
            {o.status === "open" && <WhatNext f={f} base={base} />}
            <KeepAnEye f={f} />
          </div>
          <MoneyCard f={f} costs={costs} base={base} />
          <WhatTheyBought o={o} f={f} />
        </div>
        <aside className="flex min-w-0 flex-col gap-5">
          <DetailsCard
            action={detailsAction.bind(null, o.id)}
            canEdit={can(me, "orders.update") && open}
            today={now}
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
              containerNo: o.goods.containerNo,
              documentTitle: o.documentTitle,
              portOfDischarge: o.portOfDischarge,
            }}
            readyEach={
              (o.readyBy ?? []).filter((r) => r.factoryId).length > 1
                ? { count: (o.readyBy ?? []).filter((r) => r.factoryId).length, href: `/orders/${o.id}/factory#factory` }
                : null
            }
            shown={{
              shipBy: o.shipBy ? date(o.shipBy) : null,
              readyOn: o.readyOn ? date(o.readyOn) : null,
              shippedOn: o.shippedOn ? date(o.shippedOn) : null,
              blNo: o.blNo,
            }}
            shipment={{
              onShipping,
              label: "Shipment 1",
              href: `${base}/shipping#goto=shipment.departedOn,shipment.blNo,shipment.containerNo`,
            }}
            lc={lcLatest ? { latest: date(lcLatest), late: !!shipByVsLc(o.shipBy, lcLatest)?.late } : null}
            suggestShipBy={o.shipBySuggested ? { on: o.shipBySuggested, shown: date(o.shipBySuggested) } : null}
          />
          <WhoIsInvolved o={o} f={f} deal={deal} />
          <KeyDates o={o} f={f} deal={deal} />
        </aside>
      </div>

      {deal && (
        <Card>
          <CardHeader title="Notes" description={`Shared with inquiry ${deal.refNo}`} />
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

      <RecentChanges lines={compactChanges(recent ?? [])} more={(recent?.length ?? 0) >= CHANGES} historyHref={`${base}/history`} />
    </div>
  );
}
