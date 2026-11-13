import { api } from "@/lib/api";
import { orderMoneyOf, orderOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { today } from "@/components/orders/today";
import { cancelOrderAction } from "../actions";
import { CancelOrderForm } from "./forms";

/**
 * "Cancel the order…" in the order's ⋯ menu (managers): its window, with what the money received and
 * the money paid to the factory become, and what else ends with the order. It opens on any tab.
 */
export async function CancelOrder({ id }: { id: string }) {
  const o = await orderOf(id);
  const [m, pos] = await Promise.all([
    optional(() => orderMoneyOf(id)),
    optional(() => api.get<{ items: { number: string }[] }>(`/orders/${id}/purchase-orders`)),
  ]);
  const ended = [
    o.quotation ? `The quotation R${o.quotation.number} becomes \u201cvoid\u201d` : null,
    pos?.items.length ? `${pos.items.map((x) => x.number).join(", ")} ${pos.items.length === 1 ? "is" : "are"} cancelled` : null,
  ].filter(Boolean);
  const factoryPaid = (m?.factories?.rows ?? [])
    .filter((r) => Number(r.paid) > 0)
    .map((r) => `${r.currency} ${Number(r.paid).toLocaleString("en-US", { minimumFractionDigits: 2 })} to ${r.factory.name}`);
  return (
    <CancelOrderForm
      action={cancelOrderAction.bind(null, o.id)}
      refNo={o.refNo}
      customer={o.customer.name}
      received={o.money.received}
      currency={o.currency}
      factoryPaid={factoryPaid}
      today={today()}
      total={o.money.total}
      voids={ended.length ? `${ended.join(" and ")}.` : undefined}
    />
  );
}
