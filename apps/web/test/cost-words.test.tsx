import { describe, expect, it } from "vitest";
import { COST_FROM, costState } from "@/components/orders/cost-words";

describe("the cost sheet's words", () => {
  it("says where a cost stands", () => {
    expect(costState({ state: "paid", on: "2026-11-17" })).toBe("Paid 17 Nov");
    expect(costState({ state: "paid", on: null })).toBe("Paid");
    expect(costState({ state: "to_pay", on: "2026-11-17" })).toBe("To pay");
    expect(costState({ state: "to_repay", on: null })).toBe("To repay");
    expect(costState({ state: "part_paid", on: null })).toBe("Part paid");
    expect(costState({ state: "estimate", on: null })).toBe("Estimate");
  });

  it("names where each cost comes from", () => {
    expect(COST_FROM).toEqual({ factory: "Factory order", shipment: "Shipping", payment: "Payment", quotation: "Quotation", typed: "Added here" });
  });
});
