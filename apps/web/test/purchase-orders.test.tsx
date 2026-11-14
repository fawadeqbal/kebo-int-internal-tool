import { describe, expect, it } from "vitest";
import { PURCHASE_ORDER_STATUS, PURCHASE_ORDERS, purchaseOrderHref } from "@/lib/purchase-orders";
import { MODULE_PAGES } from "@/lib/nav";

// Purchase orders keep a list, and each one a page of its own that shows it (it is changed on its sales order).
describe("purchase orders", () => {
  it("have a page of their own under the list: the sales order it is on, then the supplier", () => {
    expect(PURCHASE_ORDERS).toBe("/operations/purchase-orders");
    expect(purchaseOrderHref("0b6c", "9a1b")).toBe("/operations/purchase-orders/0b6c/9a1b");
    // The list is in the menu, so the page above a purchase order is found by its address.
    expect(MODULE_PAGES.find((m) => m.key === "purchasing")!.pages.map((p) => p.href)).toContain(PURCHASE_ORDERS);
  });

  it("say where each one stands in the same words on the list and on the page", () => {
    expect(Object.keys(PURCHASE_ORDER_STATUS).sort()).toEqual(["cancelled", "in_production", "late", "not_sent", "ready", "shipped"]);
    expect(PURCHASE_ORDER_STATUS.not_sent).toEqual({ label: "Not sent", meaning: "warn" });
    expect(PURCHASE_ORDER_STATUS.late).toEqual({ label: "Ready date passed", meaning: "bad" });
  });
});
