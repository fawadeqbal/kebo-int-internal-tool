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

  it("works margins without our VAT when prices include it", () => {
    const vat = { rate: 13, included: true };
    expect(priceForMargin(85, 15, vat)).toBe(113);
    expect(marginPercent(113, 85, vat)).toBe(15);
    expect(priceForMargin(85, 15, { rate: 13, included: false })).toBe(100);
    expect(costSummary([{ quantity: 1, unitPrice: 113, unitCost: 85 }], vat)).toEqual({ costCents: 8500, salesCents: 10000, profitCents: 1500, marginPercent: 15, uncosted: 0 });
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

import { calculateTotals } from "@/lib/utils/money";

describe("one VAT", () => {
  const items = [{ quantity: 2, unitPrice: 565 }];
  it("adds VAT on top by default", () => {
    const t = calculateTotals(items, 30, 13);
    expect([t.subtotal, t.discount, t.taxAmount, t.total]).toEqual([113000, 3000, 14300, 124300]);
  });
  it("shows the VAT inside the total when prices include it", () => {
    const t = calculateTotals(items, 30, 13, true);
    expect([t.subtotal, t.discount, t.taxAmount, t.total]).toEqual([113000, 3000, 12655, 110000]);
  });
  it("is plain when exempt", () => {
    expect(calculateTotals(items, 0, 0, true).total).toBe(113000);
  });
});
