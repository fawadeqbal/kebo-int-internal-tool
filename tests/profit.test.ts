import { describe, expect, it } from "vitest";
import { costLines, deals, groupBy, totals, type ProfitLine } from "@/modules/reports/profit-math";

const line = (p: Partial<ProfitLine>): ProfitLine => ({
  docId: "a",
  docNo: "INV-1",
  date: "2026-10-01",
  customer: "Al-Shifa",
  category: "Pharma",
  person: "Faizur",
  factory: "Jinan",
  quantity: 1,
  lineTotalCents: 0,
  docSubtotalCents: 0,
  docDiscountCents: 0,
  unitCost: null,
  ...p,
});

describe("profit", () => {
  // Invoice A: machine 2 × 10,000 (cost 8,000 each), freight 1,000 (no cost), discount 2,100 → subtotal 21,000
  const a = [
    line({ quantity: 2, lineTotalCents: 2_000_000, docSubtotalCents: 2_100_000, docDiscountCents: 210_000, unitCost: 8000 }),
    line({ factory: null, lineTotalCents: 100_000, docSubtotalCents: 2_100_000, docDiscountCents: 210_000 }),
  ];
  // Invoice B: one line 5,000 cost 4,900 (thin margin), another customer and factory
  const b = [line({ docId: "b", docNo: "INV-2", customer: "Gulf Foods", factory: "Wenzhou", category: "Food", lineTotalCents: 500_000, docSubtotalCents: 500_000, unitCost: 4900 })];

  it("spreads the discount by amount and keeps uncosted revenue apart", () => {
    const ls = costLines(a);
    expect(ls[0].netCents).toBe(2_000_000 - 200_000);
    expect(ls[1].netCents).toBe(100_000 - 10_000);
    const t = totals(ls);
    expect(t.revenueCents).toBe(1_890_000);
    expect(t.costedRevenueCents).toBe(1_800_000);
    expect(t.uncostedRevenueCents).toBe(90_000);
    expect(t.costCents).toBe(1_600_000);
    expect(t.profitCents).toBe(200_000);
    expect(t.marginPercent).toBe(11.1);
    expect(t.coveragePercent).toBe(95);
  });

  it("gives the rounding to the last line so the discount adds up", () => {
    const ls = costLines([
      line({ lineTotalCents: 100, docSubtotalCents: 300, docDiscountCents: 100, unitCost: 0.5 }),
      line({ lineTotalCents: 100, docSubtotalCents: 300, docDiscountCents: 100, unitCost: 0.5 }),
      line({ lineTotalCents: 100, docSubtotalCents: 300, docDiscountCents: 100, unitCost: 0.5 }),
    ]);
    expect(ls.reduce((s, l) => s + (100 - l.netCents), 0)).toBe(100);
  });

  it("groups and lists deals", () => {
    const ls = costLines([...a, ...b]);
    const byCustomer = groupBy(ls, (l) => l.customer);
    expect(byCustomer.map((g) => [g.key, g.profitCents])).toEqual([
      ["Al-Shifa", 200_000],
      ["Gulf Foods", 10_000],
    ]);
    const byFactory = groupBy(ls, (l) => l.factory ?? "No factory");
    expect(byFactory.find((g) => g.key === "Wenzhou")?.marginPercent).toBe(2);
    expect(byFactory.at(-1)?.key).toBe("No factory");
    const d = deals(ls).sort((x, y) => (x.marginPercent ?? 0) - (y.marginPercent ?? 0));
    expect(d[0].no).toBe("INV-2");
    expect(totals(ls).documents).toBe(2);
  });

  it("handles nothing costed", () => {
    const t = totals(costLines([line({ lineTotalCents: 5000, docSubtotalCents: 5000 })]));
    expect(t.marginPercent).toBeNull();
    expect(t.profitCents).toBe(0);
    expect(t.uncostedRevenueCents).toBe(5000);
  });
});
