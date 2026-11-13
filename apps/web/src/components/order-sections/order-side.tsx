import { can } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderFlowOf, orderMoneyOf, orderOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { date, whole } from "@/lib/format";
import type { Note } from "@/lib/types-notes";
import { today } from "@/components/orders/today";
import { KeyDates, OrderPeople } from "@/components/orders/order-facts";
import { SidePanelCard, SideSection } from "@/components/orders/side-panel-parts";
import { QuickNote } from "@/components/notes/note-forms";
import { addNoteAction } from "@/app/(app)/follow-ups/actions";

/**
 * Beside every tab of an order, always the same: the key dates, the people,
 * the money and the notes. Nothing to tick in it; what it shows is edited in
 * the sections.
 */
export async function OrderSide({ id }: { id: string }) {
  const me = await requireUser();
  const o = await orderOf(id);
  const [flow, m, notes] = await Promise.all([
    optional(() => orderFlowOf(id)),
    can(me, "sourcing.manage") ? optional(() => orderMoneyOf(id)) : Promise.resolve(null),
    optional(() => api.get<Note[]>(`/orders/${id}/notes`)),
  ]);
  const paid = (m?.factories?.rows ?? []).filter((r) => Number(r.owed) > 0 || Number(r.paid) > 0);
  const money: [string, string][] = [
    ["Order total", whole(o.money.total, o.currency)],
    ["Received", whole(o.money.received, o.currency)],
    ["They still owe", whole(o.money.due, o.currency)],
    ...paid.map((r) => [paid.length > 1 ? `Paid to ${r.factory.name}` : "Paid to factory", whole(r.paid, r.currency)] as [string, string]),
  ];
  const latest = (notes ?? []).slice(0, 3);
  return (
    <aside aria-label="Beside the order" className="flex min-w-0 flex-col gap-4">
      <SidePanelCard>
        <KeyDates o={o} flow={flow} now={today()} />
        <OrderPeople o={o} flow={flow} />
        <SideSection title="Money">
          {money.map(([k, v]) => (
            <li key={k} className="flex items-baseline justify-between gap-3 py-1 text-[13px]">
              <span className="text-text-2">{k}</span>
              <span className="text-right font-semibold tabular">{v}</span>
            </li>
          ))}
        </SideSection>
        <SideSection title="Notes" footer={o.status !== "cancelled" ? <div className="mt-2"><QuickNote action={addNoteAction.bind(null, { key: "orderId", id: o.id })} /></div> : undefined}>
          {latest.map((n) => (
            <li key={n.id} className="py-1 text-[13px]">
              <span className="line-clamp-3 [overflow-wrap:anywhere]">{n.body}</span>
              <span className="block text-xs text-text-2">
                {n.author.name} · {date(n.at)}
              </span>
            </li>
          ))}
        </SideSection>
      </SidePanelCard>
    </aside>
  );
}

/**
 * A tab of the order: its sections on the left, the same side panel on the
 * right (under the sections on a narrow screen).
 */
export function OrderPage({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      <OrderSide id={id} />
    </div>
  );
}
