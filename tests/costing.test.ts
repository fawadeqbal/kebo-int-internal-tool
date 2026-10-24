import { describe, expect, it } from "vitest";
import { convert, costSummary, fxRate, marginPercent, priceForMargin, unitPriceWithVat, vatPart } from "@/lib/costing";

describe("costing", () => {
  it("adds VAT only when the factory quoted without it", () => {
    expect(unitPriceWithVat(1000, 13, true)).toBe(1000);
    expect(unitPriceWithVat(1000, 13, false)).toBe(1130);
    expect(unitPriceWithVat(1000, 0, false)).toBe(1000);
    expect(vatPart(1130, 13)).toBe(130);
  });

  it("converts through the main currency", () => {
    const rates = { CNY: 7.1, EUR: 0.92 };
    expect(fxRate("CNY", "USD", "USD", rates)).toBe(7.1);
    expect(fxRate("USD", "USD", "USD", rates)).toBe(1);
    expect(fxRate("CNY", "EUR", "USD", rates)).toBeCloseTo(7.1 / 0.92, 10);
    expect(fxRate("JPY", "USD", "USD", rates)).toBeNull();
    expect(convert(7100, 7.1)).toBe(1000);
  });

  it("works margin both ways on the selling price", () => {
    expect(priceForMargin(85, 15)).toBe(100);
    expect(marginPercent(100, 85)).toBe(15);
    expect(marginPercent(0, 85)).toBeNull();
    expect(marginPercent(80, 85)).toBe(-6.3);
  });

  it("sums cost, sales and profit of costed lines", () => {
    const s = costSummary([
      { quantity: 2, unitPrice: 100, unitCost: 85 },
      { quantity: 1, unitPrice: "50.5", unitCost: "40.25" },
      { quantity: 1, unitPrice: 300, unitCost: null },
    ]);
    expect(s).toEqual({ costCents: 21025, salesCents: 25050, profitCents: 4025, marginPercent: 16.1, uncosted: 1 });
  });
});
