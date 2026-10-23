import { describe, expect, it } from "vitest";
import { calculateTotals, formatCents, fromCents, toCents } from "@/lib/utils/money";

describe("money", () => {
  it("converts to and from cents without floating-point drift", () => {
    expect(toCents("0.1")).toBe(10);
    expect(toCents("1,234.56")).toBe(123456);
    expect(fromCents(toCents("0.1") + toCents("0.2"))).toBe("0.30");
  });

  it("calculates line totals, discount, tax and total", () => {
    const t = calculateTotals(
      [
        { quantity: 2, unitPrice: "5250000" },
        { quantity: 1, unitPrice: "150000" },
      ],
      50000,
      18,
    );
    expect(t.subtotal).toBe(1_065_000_000);
    expect(t.discount).toBe(5_000_000);
    expect(t.taxAmount).toBe(190_800_000);
    expect(t.total).toBe(1_250_800_000); // PKR 12,508,000.00
  });

  it("never lets the discount exceed the subtotal or go negative", () => {
    expect(calculateTotals([{ quantity: 1, unitPrice: 100 }], 500, 0).total).toBe(0);
    expect(calculateTotals([{ quantity: 1, unitPrice: 100 }], -50, 0).total).toBe(10000);
  });

  it("rounds tax to the nearest paisa", () => {
    expect(calculateTotals([{ quantity: 3, unitPrice: "33.33" }], 0, 17).taxAmount).toBe(1700); // 99.99 * 17% = 16.9983
  });

  it("formats amounts for display", () => {
    expect(formatCents(1_250_800_000)).toBe("PKR 12,508,000.00");
  });
});
