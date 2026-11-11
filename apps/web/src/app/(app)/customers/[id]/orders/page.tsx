import type { OrderStatus } from "@kebo/shared";
import { StatusBadge, type StatusMeaning } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { requireUser, hasFeature } from "@/lib/session";
import { customerOf, customerPaymentsOf } from "@/lib/party-data";
import { date, money, plural, TZ } from "@/lib/format";
import type { CustomerDetail } from "@/lib/types-people";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { RecordEmpty, RecordListCard, RecordRow } from "@/components/common/record";
import { late, owes } from "../shared";

export const metadata = { title: "Customer orders" };

type Order = CustomerDetail["orders"][number];

const ORDER_STATUS: Record<OrderStatus, { label: string; meaning: StatusMeaning }> = {
  open: { label: "In progress", meaning: "info" },
  closed: { label: "Done", meaning: "ok" },
  cancelled: { label: "Cancelled", meaning: "neutral" },
};

/** The customer's Orders tab: every order, newest first, with where it is and what is still due. */
export default async function CustomerOrders({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const [c, pay, board] = await Promise.all([customerOf(id), customerPaymentsOf(id), hasFeature("orders_board")]);
  const today = todayIn(TZ);
  const paying = new Map((pay?.orders ?? []).map((o) => [o.id, o]));
  const openOrders = c.orders.filter((o) => o.status === "open").length;
  // Where each open order is in the flow (orders board module).
  const steps =
    openOrders && board
      ? new Map(
          ((await api.get<{ items: { id: string; current: { label: string; sub: string } | null }[] }>("/order-board").catch(() => null))?.items ?? []).map((i) => [
            i.id,
            i.current,
          ]),
        )
      : null;

  const statusOf = (o: Order) => {
    const p = paying.get(o.id);
    return o.status === "open" && p && late(p, today) ? { label: "Payment late", meaning: "bad" as const } : ORDER_STATUS[o.status];
  };
  const lineOf = (o: Order) => {
    const p = paying.get(o.id);
    const cur = o.status === "open" ? steps?.get(o.id) : undefined;
    const where = cur ? cur.label : o.status === "open" && steps ? "every step done" : null;
    const due = p && owes(p) ? `${money(p.due, p.currency)} due` : null;
    return [`ordered ${date(o.orderedOn)}`, where, due].filter(Boolean).join(" · ");
  };
  const menuOf = (o: Order): MenuEntry[] => [
    { label: "Open", href: `/orders/${o.id}` },
    { label: "Payments", href: `/orders/${o.id}/payment` },
    { label: "Copy link", copy: `/orders/${o.id}` },
  ];

  return (
    <RecordListCard
      title="Orders"
      count={c.orders.length}
      description={c.orders.length ? `${plural(openOrders, "open order")} · newest first` : undefined}
      empty={<RecordEmpty title="No orders yet">An order appears here when this customer accepts a quotation.</RecordEmpty>}
    >
      {c.orders.map((o) => {
        const s = statusOf(o);
        return (
          <RecordRow
            key={o.id}
            href={`/orders/${o.id}`}
            title={o.refNo}
            sub={lineOf(o)}
            status={<StatusBadge meaning={s.meaning}>{s.label}</StatusBadge>}
            figure={money(o.total, o.currency)}
            menu={<RowMenu items={menuOf(o)} label={`Actions for ${o.refNo}`} />}
          />
        );
      })}
    </RecordListCard>
  );
}
