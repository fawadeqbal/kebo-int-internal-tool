import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderOf } from "@/lib/order-data";
import type { DealDetail } from "@/lib/types";
import { optional } from "@/components/print/data";
import { OrderItems } from "@/components/orders/overview";

export const metadata = { title: "Order items" };

/** The order's Items tab: what the customer bought, line by line, at the prices of the accepted quotation. */
export default async function OrderItemsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const o = await orderOf(id);
  const deal = await optional(() => api.get<DealDetail>(`/inquiries/${o.inquiry.id}`));
  const accepted = deal?.quotation?.revisions.find((r) => r.status === "accepted") ?? null;
  return <OrderItems o={o} accepted={accepted ? { number: accepted.number } : null} />;
}
