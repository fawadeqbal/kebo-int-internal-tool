import { dayMonth } from "@/lib/format";
import type { CostSheetRow } from "@/lib/types-money";

/**
 * The cost sheet's words. Plain functions, so the server's page and the browser's Excel button both use them.
 */

/** Where a cost comes from. */
export const COST_FROM: Record<CostSheetRow["from"], string> = { factory: "Purchase order", shipment: "Shipping", payment: "Payment", quotation: "Quotation", typed: "Added here" };

/** Where a cost stands: "Paid 17 Nov", "To pay", "To repay", "Part paid", "Estimate". */
export const costState = (r: Pick<CostSheetRow, "state" | "on">) =>
  r.state === "paid" ? `Paid${r.on ? ` ${dayMonth(r.on)}` : ""}` : r.state === "part_paid" ? "Part paid" : r.state === "to_repay" ? "To repay" : r.state === "estimate" ? "Estimate" : "To pay";
