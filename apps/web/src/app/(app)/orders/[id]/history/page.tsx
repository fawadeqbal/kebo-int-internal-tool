import { can } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderOf } from "@/lib/order-data";
import type { HistoryEntry } from "@/lib/types";
import { HistoryList } from "@/components/common/history-list";
import { cancelOrderAction } from "../../actions";
import { CancelOrderForm } from "../forms";

export const metadata = { title: "Order history" };

/** Every change to the order with its reason; cancelling sits here, away from the everyday buttons. */
export default async function OrderHistory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const o = await orderOf(id);
  const history = await api.get<HistoryEntry[]>("/history", { type: "order", id });
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="History" description="Every change, newest first, with the reason when one was asked" />
        <CardBody>
          <HistoryList entries={history} />
        </CardBody>
      </Card>
      {can(me, "orders.manage") && o.status !== "cancelled" && (
        <Card className="border-bad/25">
          <CardHeader title="Cancel the order" description="Only if the customer called it off. The inquiry becomes lost and can be reopened." />
          <CardBody>
            <CancelOrderForm action={cancelOrderAction.bind(null, o.id)} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
