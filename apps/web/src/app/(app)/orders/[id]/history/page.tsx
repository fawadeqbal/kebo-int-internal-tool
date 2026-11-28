import Link from "next/link";
import { can, FLOW_STEPS, ORDER_TAB_LABEL, type FlowStep } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderNotesOf, orderOf, orderPeopleOf, orderSectionsOf } from "@/lib/order-data";
import { historyPage, whoOptions } from "@/lib/history";
import type { DealDetail } from "@/lib/types";
import type { FollowUpList } from "@/lib/types-notes";
import { optional } from "@/components/print/data";
import { HistoryTable } from "@/components/common/history-list";
import { FilterCard } from "@/components/common/filter-card";
import { FollowUpsCard, NotesCard } from "@/components/notes/cards";
import { OrderPage } from "@/components/order-sections/order-side";
import { orderTitle } from "@/lib/titles";
import { RecordBox } from "@/components/common/record-box";
import { linkClass, Pager, RULES, toPage, toPageSize } from "@kebo/ui";

export const generateMetadata = orderTitle("History");

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
  searchParams: Promise<{ step?: string; q?: string; who?: string; page?: string; size?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const step = (FLOW_STEPS as readonly string[]).includes(sp.step ?? "") ? (sp.step as FlowStep) : undefined;
  const me = await requireUser();
  const o = await orderOf(id);
  const [history, sections, notes, followUps, people, deal] = await Promise.all([
    historyPage("order", id, { page: toPage(sp.page), pageSize: toPageSize(sp.size), q: sp.q?.trim() || undefined, who: sp.who, step }),
    optional(() => orderSectionsOf(id)),
    optional(() => orderNotesOf(id)),
    optional(() => api.get<FollowUpList>("/follow-ups", { orderId: id })),
    optional(() => orderPeopleOf(id)),
    optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`)),
  ]);
  const who = whoOptions(people ?? []);
  const q = sp.q?.trim() ?? "";
  const rows = history.rows;
  const stages = sections?.stages ?? [...FLOW_STEPS];
  const stageOf = Object.fromEntries(
    rows.map((e) => [
      e.id,
      e.step && (FLOW_STEPS as readonly string[]).includes(e.step) ? ORDER_TAB_LABEL[e.step as FlowStep] : ORDER_TAB_LABEL.overview,
    ]),
  );
  return (
    <OrderPage id={id}>
      <section aria-label="History" className={RULES.page.stack}>
        <FilterCard
          search="Search history…"
          value={sp.q}
          clearHref={`/orders/${o.id}/history`}
          selects={[
            { name: "step", label: "Stage", value: step, options: stages.map((s) => ({ value: s, label: ORDER_TAB_LABEL[s] })) },
            { name: "who", label: "Who", value: sp.who, options: who },
          ]}
        />
        <RecordBox
          title="Changes"
          count={`${history.total} ${history.total === 1 ? "change" : "changes"}`}
          what="changes"
          canEdit={false}
        >
          <HistoryTable
            entries={rows}
            tags={{ label: "Stage", of: stageOf }}
            empty={
              q || sp.who
                ? "Nothing matches. Clear the search or choose everyone."
                : step
                  ? "Nothing changed in this stage yet."
                  : "Nothing has changed yet."
            }
          />
        </RecordBox>
        <Pager base={`/orders/${id}/history`} params={{ q: sp.q, who: sp.who, step }} page={history.page} pageSize={history.pageSize} total={history.total} bare />
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
                <Link href={`/inquiries/${deal.id}#notes`} className={linkClass}>
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
    </OrderPage>
  );
}
