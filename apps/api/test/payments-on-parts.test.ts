import { describe, expect, it } from "vitest";
import { paymentsOnParts } from "../src/modules/billing/factory-plan";

/** Which payments paid each part of a factory's plan: payments pay the parts in order. */
describe("paymentsOnParts", () => {
  const parts = [{ amountMinor: 3000 }, { amountMinor: 7000 }];

  it("gives each part the payments that went to it, a payment split over two parts", () => {
    expect(paymentsOnParts(parts, [{ id: "a", minor: 2000 }, { id: "b", minor: 5000 }])).toEqual([
      [
        { id: "a", minor: 2000 },
        { id: "b", minor: 1000 },
      ],
      [{ id: "b", minor: 4000 }],
    ]);
  });

  it("puts what is paid beyond the parts on none, and skips a part of nothing", () => {
    expect(paymentsOnParts([{ amountMinor: 0 }, { amountMinor: 1000 }], [{ id: "a", minor: 1500 }])).toEqual([[], [{ id: "a", minor: 1000 }]]);
    expect(paymentsOnParts(parts, [])).toEqual([[], []]);
    expect(paymentsOnParts([], [{ id: "a", minor: 100 }])).toEqual([]);
  });
});
