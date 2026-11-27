import type { ReactNode } from "react";
import { can } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderFlowOf, orderMoneyOf, orderOf } from "@/lib/order-data";
import { getPeople } from "@/lib/loaders";
import { optional } from "@/components/print/data";
import { date, money } from "@/lib/format";
import type { FollowUpList, Note } from "@/lib/types-notes";
import { dueText } from "@/components/notes/kinds";
import { today } from "@/components/orders/today";
import { keyDates, orderPeople } from "@/components/orders/order-facts";
import { PanelCard, PanelFacts, PanelLink, PanelNotes, PanelWho } from "@/components/records/panel-pieces";
import { QuickNote } from "@/components/notes/note-forms";
import { AssignSelect } from "@/app/(app)/inquiries/[id]/panels";
import { addNoteAction } from "@/app/(app)/follow-ups/actions";
import { assignOrderAction } from "@/app/(app)/orders/actions";
import { dataOf, failedWhat, part } from "@/lib/part";
import { CouldNotLoad } from "@/components/common/could-not-load";

/**
 * Beside every tab of an order, drawn once by its layout (canvas board "One side panel for every record"): who
 * handles it with the other side and the next follow-up, its key dates, its money and its notes — the shared
 * panel pieces, and on a phone one bar that opens them.
 */
export async function OrderSide({ id }: { id: string }) {
  const me = await requireUser();
  const o = await orderOf(id);
  const mayAssign = can(me, "inquiries.assign") && o.status !== "cancelled";
  const [flow, m, notes, followUps, peoplePart] = await Promise.all([
    optional(() => orderFlowOf(id)),
    can(me, "sourcing.manage") ? optional(() => orderMoneyOf(id)) : Promise.resolve(null),
    optional(() => api.get<Note[]>(`/orders/${id}/notes`)),
    optional(() => api.get<FollowUpList>("/follow-ups", { orderId: id, open: "true" })),
    part("the people to tell", () => getPeople()),
  ]);
  const people = dataOf(peoplePart) ?? [];
  // The parts that could not be read, said once at the top (the rest works).
  const failed = failedWhat(peoplePart);
  const base = `/orders/${o.id}`;
  const paid = (m?.factories?.rows ?? []).filter((r) => Number(r.owed) > 0 || Number(r.paid) > 0);
  // Exact, as the order's own pages show them (whole units are for headline tiles only).
  const figures = [
    { label: "Order total", value: money(o.money.total, o.currency) },
    { label: "Received", value: money(o.money.received, o.currency) },
    { label: "Still due", value: money(o.money.due, o.currency) },
    ...paid.map((r) => ({ label: paid.length > 1 ? `Paid to ${r.factory.name}` : "Paid to supplier", value: money(r.paid, r.currency) })),
  ];
  const dates = keyDates(o, flow, today());
  const nextUp = [...(followUps?.rows ?? [])].sort((a, b) => `${a.dueOn}${a.dueAt ?? ""}`.localeCompare(`${b.dueOn}${b.dueAt ?? ""}`))[0];
  const late = dates.find((d) => d.tone === "late");
  const due = Number(o.money.due);
  // The bar on a phone: who, what is late, what is still to come.
  const bar = [
    o.inquiry.assignee?.name ?? "Nobody handles it",
    late ? `${late.label.toLowerCase()} ${late.value}` : null,
    o.status === "open" && due > 0 ? `${money(o.money.due, o.currency)} to come` : due <= 0 ? "paid in full" : null,
  ];
  const form: ReactNode = o.status !== "cancelled" ? <QuickNote action={addNoteAction.bind(null, { key: "orderId", id: o.id })} people={people} /> : undefined;
  return (
    <PanelCard title="Order" bar={bar}>
      {failed && <CouldNotLoad what={failed} />}
      <PanelWho
        title="Order"
        responsible={o.inquiry.assignee?.name ?? null}
        picker={mayAssign ? <AssignSelect action={assignOrderAction.bind(null, o.id, o.inquiry.id)} people={people} current={o.inquiry.assignee?.id ?? null} /> : undefined}
        people={orderPeople(o, flow)}
        followUp={nextUp ? { text: dueText(nextUp.dueOn, nextUp.dueAt), late: nextUp.late, href: `${base}/history#follow-ups` } : null}
      />
      <PanelFacts title="Dates" rows={dates} />
      <PanelFacts title="Finance" rows={figures} action={o.money ? <PanelLink href={`${base}/costs`}>Costs</PanelLink> : undefined} />
      <PanelNotes notes={(notes ?? []).map((n) => ({ id: n.id, body: n.body, by: n.author.name, when: date(n.at) }))} allHref={`${base}/history`} form={form} max={3} />
    </PanelCard>
  );
}

/** A tab of the order: only its boxes. The order's top and panel are drawn once by its layout (RecordFrame). */
export function OrderPage({ children }: { id?: string; children: ReactNode }) {
  return <>{children}</>;
}
