import { can } from "@kebo/shared";
import type { Me } from "@/lib/session";
import type { OrderView } from "@/lib/types-orders";
import { moveStageAction } from "../actions";
import { StageActions } from "./forms";

/**
 * The order's own move, as a checklist tool: "Shipped" when the shipping
 * module is off, and "Order closed" at the end. The stages follow the steps
 * otherwise; these two are still pressed by people.
 */
export function stageTool(me: Me, o: OrderView, to: "shipped" | "done", today: string) {
  if (!can(me, "orders.update") || o.status === "cancelled" || o.next?.to !== to) return null;
  return (
    <StageActions
      key={o.stage}
      next={o.next}
      back={null}
      action={moveStageAction.bind(null, o.id)}
      today={today}
      readyOn={o.readyOn}
      shippedOn={o.shippedOn}
      blNo={o.blNo}
    />
  );
}
