import { can, FLOW_STEP_LABEL, FLOW_STEPS, type FlowStep } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { orderHistoryOf, orderMoneyOf, orderOf, orderStepsOf } from "@/lib/order-data";
import { today } from "@/components/orders/today";
import { HistoryTable, historyText } from "@/components/common/history-list";
import { FilterCard } from "@/components/common/filter-card";
import { optional } from "@/components/print/data";
import { api } from "@/lib/api";
import type { DealDetail } from "@/lib/types";
import type { FollowUpList, Note } from "@/lib/types-notes";
import { FollowUpsCard, NotesCard } from "@/components/notes/cards";
import { getPeople } from "@/lib/loaders";
import Link from "next/link";
import { cancelOrderAction } from "../../actions";
import { CancelOrderForm } from "../forms";

export const metadata = { title: "Order notes and history" };

/**
 * The order's Notes tab (the record's activity): notes and follow-ups, then every change with its reason (or
 * one step's). Cancelling sits here, away from the everyday buttons.
 */
export default async function OrderHistory({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; q?: string; who?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const step = (FLOW_STEPS as readonly string[]).includes(sp.step ?? "") ? (sp.step as FlowStep) : undefined;
  const me = await requireUser();
  const o = await orderOf(id);
  const manage = can(me, "orders.manage") && o.status !== "cancelled";
  const [history, steps, m, notes, followUps, people, deal] = await Promise.all([
    orderHistoryOf(id, step),
    optional(() => orderStepsOf(id)),
    manage ? optional(() => orderMoneyOf(id)) : Promise.resolve(null),
    optional(() => api.get<Note[]>(`/orders/${id}/notes`)),
    optional(() => api.get<FollowUpList>("/follow-ups", { orderId: id })),
    optional(() => getPeople()),
    optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`)),
  ]);
  const pos = manage ? await optional(() => api.get<{ items: { number: string }[] }>(`/orders/${id}/purchase-orders`)) : null;
  const ended = [
    o.quotation ? `The quotation R${o.quotation.number} becomes \u201cvoid\u201d` : null,
    pos?.items.length ? `${pos.items.map((x) => x.number).join(", ")} ${pos.items.length === 1 ? "is" : "are"} cancelled` : null,
  ].filter(Boolean);
  const voids = ended.length ? `${ended.join(" and ")}.` : undefined;
  const people2 = [...new Map(history.map((e) => [e.by?.id ?? "system", e.by?.name ?? "System"])).entries()].map(([value, label]) => ({ value, label }));
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = history.filter((e) => (!q || historyText(e).includes(q)) && (!sp.who || (e.by?.id ?? "system") === sp.who));
  const factoryPaid = (m?.factories?.rows ?? [])
    .filter((r) => Number(r.paid) > 0)
    .map((r) => `${r.currency} ${Number(r.paid).toLocaleString("en-US", { minimumFractionDigits: 2 })} to ${r.factory.name}`);
  const base = `/orders/${o.id}/history`;
  const shown = steps?.steps.map((s) => s.key) ?? [...FLOW_STEPS];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <FilterCard
          search="Search history…"
          value={sp.q}
          clearHref={base}
          selects={[
            { name: "who", label: "Who", value: sp.who, options: people2 },
            { name: "step", label: "Step", value: step, options: shown.map((s) => ({ value: s, label: FLOW_STEP_LABEL[s] })) },
          ]}
        />
        <Card>
          <HistoryTable
            entries={rows}
            empty={q || sp.who ? "Nothing matches. Clear the search or choose everyone." : step ? "Nothing changed in this step yet." : "Nothing has changed yet."}
          />
        </Card>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <NotesCard
          on={{ key: "orderId", id: o.id }}
          notes={notes ?? []}
          canAdd={can(me, "orders.update")}
          contacts={deal?.customer.contacts.map((c) => ({ id: c.id, name: c.name }))}
          footer={
            deal && deal.notes.length > 0 ? (
              <p className="text-xs text-text-2">
                The inquiry has {deal.notes.length} note{deal.notes.length === 1 ? "" : "s"} too ·{" "}
                <Link href={`/inquiries/${deal.id}#notes`} className="font-medium text-primary hover:underline">
                  Read them on {deal.refNo}
                </Link>
              </p>
            ) : null
          }
        />
        <FollowUpsCard
          on={{ key: "orderId", id: o.id }}
          label={`${o.refNo} · ${o.customer.name}`}
          rows={followUps?.rows ?? []}
          people={people ?? []}
          meId={me.id}
        />
      </div>
      {manage && (
        <Card className="border-bad/25">
          <CardHeader
            title="Cancel the order"
            description="Only if the customer called it off. The inquiry becomes lost and can be reopened. Money is never left hanging on a cancelled order."
          />
          <CardBody>
            <CancelOrderForm
              action={cancelOrderAction.bind(null, o.id)}
              refNo={o.refNo}
              customer={o.customer.name}
              received={o.money.received}
              currency={o.currency}
              factoryPaid={factoryPaid}
              today={today()}
              total={o.money.total}
              voids={voids}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
