import Link from "next/link";
import { can, FLOW_STEPS, ORDER_TAB_LABEL, type FlowStep } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { getPeople } from "@/lib/loaders";
import { orderHistoryOf, orderOf, orderSectionsOf } from "@/lib/order-data";
import type { DealDetail } from "@/lib/types";
import type { FollowUpList, Note } from "@/lib/types-notes";
import { optional } from "@/components/print/data";
import { HistoryTable, historyText } from "@/components/common/history-list";
import { FilterCard } from "@/components/common/filter-card";
import { FollowUpsCard, NotesCard } from "@/components/notes/cards";
import { OrderPage } from "@/components/order-sections/order-side";

export const metadata = { title: "Order · history" };

/**
 * History (design "the order, final"): every change on the order with who made it, when, why and the
 * stage it belongs to, with a search and stage and person filters; then the notes and the follow-ups.
 * Nothing is edited here. Cancelling is in the order's ⋯ menu.
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
  const [history, sections, notes, followUps, people, deal] = await Promise.all([
    orderHistoryOf(id, step),
    optional(() => orderSectionsOf(id)),
    optional(() => api.get<Note[]>(`/orders/${id}/notes`)),
    optional(() => api.get<FollowUpList>("/follow-ups", { orderId: id })),
    optional(() => getPeople()),
    optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`)),
  ]);
  const who = [...new Map(history.map((e) => [e.by?.id ?? "system", e.by?.name ?? "System"])).entries()].map(([value, label]) => ({ value, label }));
  const q = sp.q?.trim().toLowerCase() ?? "";
  const rows = history.filter((e) => (!q || historyText(e).includes(q)) && (!sp.who || (e.by?.id ?? "system") === sp.who));
  const stages = sections?.stages ?? [...FLOW_STEPS];
  const stageOf = Object.fromEntries(rows.map((e) => [e.id, e.step && (FLOW_STEPS as readonly string[]).includes(e.step) ? ORDER_TAB_LABEL[e.step as FlowStep] : ORDER_TAB_LABEL.overview]));
  return (
    <OrderPage id={id}>
      <section aria-label="History" className="min-w-0">
        <FilterCard
          search="Search history…"
          value={sp.q}
          clearHref={`/orders/${o.id}/history`}
          selects={[
            { name: "step", label: "Stage", value: step, options: stages.map((s) => ({ value: s, label: ORDER_TAB_LABEL[s] })) },
            { name: "who", label: "Who", value: sp.who, options: who },
          ]}
        />
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <HistoryTable
            entries={rows}
            tags={{ label: "Stage", of: stageOf }}
            empty={q || sp.who ? "Nothing matches. Clear the search or choose everyone." : step ? "Nothing changed in this stage yet." : "Nothing has changed yet."}
          />
        </div>
      </section>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
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
        <FollowUpsCard on={{ key: "orderId", id: o.id }} label={`${o.refNo} · ${o.customer.name}`} rows={followUps?.rows ?? []} people={people ?? []} meId={me.id} />
      </div>
    </OrderPage>
  );
}
