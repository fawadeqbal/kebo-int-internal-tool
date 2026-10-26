import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  CurrencyMismatchError,
  costDocLines,
  costSummary,
  convertMinor,
  documentTotals,
  formatMinor,
  fromMinor,
  fxRate,
  marginPercent,
  money,
  priceForMargin,
  profitBy,
  profitTotals,
  settle,
  splitDeposit,
  toMinor,
  unitCostMinor,
  vatInside,
} from "../src";

describe("minor units", () => {
  it("converts without floating-point drift", () => {
    expect(toMinor("0.1") + toMinor("0.2")).toBe(30);
    expect(toMinor("1,234.56")).toBe(123456);
    expect(toMinor("1.005")).toBe(101); // 1.005 * 100 is 100.4999… in floating point
    expect(toMinor("-2.345")).toBe(-235);
    expect(toMinor({ toString: () => "99.99" })).toBe(9999); // Prisma Decimal
    expect(toMinor("")).toBe(0);
    expect(toMinor("abc")).toBe(0);
    expect(fromMinor(123450)).toBe("1234.50");
    expect(fromMinor(-5)).toBe("-0.05");
  });

  it("refuses to mix currencies", () => {
    expect(add(money("1", "usd"), money("2", "USD")).amount).toBe(300);
    expect(() => add(money("1", "USD"), money("1", "CNY"))).toThrow(CurrencyMismatchError);
  });

  it("allocates so the parts always add up", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1]).reduce((a, b) => a + b)).toBe(-100);
    expect(allocate(500, [0, 0])).toEqual([0, 500]);
    const parts = allocate(210_000, [2_000_000, 100_000]);
    expect(parts).toEqual([200_000, 10_000]);
  });

  it("formats for display", () => {
    expect(formatMinor(1_250_800_000, "PKR")).toBe("PKR 12,508,000.00");
  });
});

describe("document totals", () => {
  const items = [{ quantity: 2, unitPrice: 565 }];

  it("adds VAT on top", () => {
    const t = documentTotals(items, 30, { rate: 13, pricesIncludeVat: false });
    expect([t.subtotal, t.discount, t.vat, t.total, t.net]).toEqual([113000, 3000, 14300, 124300, 110000]);
  });

  it("shows the VAT inside the total when prices include it", () => {
    const t = documentTotals(items, 30, { rate: 13, pricesIncludeVat: true });
    expect([t.subtotal, t.discount, t.vat, t.total, t.net]).toEqual([113000, 3000, 12655, 110000, 97345]);
  });

  it("keeps the discount between zero and the subtotal and spreads it over the lines", () => {
    expect(documentTotals([{ quantity: 1, unitPrice: 100 }], 500).total).toBe(0);
    expect(documentTotals([{ quantity: 1, unitPrice: 100 }], -50).total).toBe(10000);
    const t = documentTotals(
      [
        { quantity: 2, unitPrice: "5250000" },
        { quantity: 1, unitPrice: "150000" },
      ],
      50000,
      { rate: 18, pricesIncludeVat: false },
    );
    expect(t.total).toBe(1_250_800_000);
    expect(t.lines.reduce((s, l) => s + l.discountShare, 0)).toBe(t.discount);
  });

  it("handles decimal quantities", () => {
    expect(documentTotals([{ quantity: "2.5", unitPrice: "33.33" }], 0).subtotal).toBe(8333); // 83.325 → 83.33
  });
});

describe("costing", () => {
  it("converts through the main currency and never at an unknown rate", () => {
    const rates = { CNY: 7.1, EUR: 0.92 };
    expect(fxRate("CNY", "USD", "USD", rates)).toBe(7.1);
    expect(fxRate("CNY", "EUR", "USD", rates)).toBeCloseTo(7.1 / 0.92, 10);
    expect(fxRate("JPY", "USD", "USD", rates)).toBeNull();
    expect(convertMinor(710_000, 7.1)).toBe(100_000);
    expect(() => convertMinor(1, 0)).toThrow();
  });

  it("costs a factory price with VAT and the export rebate", () => {
    expect(unitCostMinor({ unitPriceMinor: 113_00, vatRate: 13, pricesIncludeVat: true })).toBe(113_00);
    expect(unitCostMinor({ unitPriceMinor: 100_00, vatRate: 13, pricesIncludeVat: false })).toBe(113_00);
    // 13% VAT, 13% rebate: the whole VAT comes back
    expect(unitCostMinor({ unitPriceMinor: 113_00, vatRate: 13, pricesIncludeVat: true, rebateRate: 13 })).toBe(100_00);
    // 9% rebate on 13% VAT: 4% of the net price stays a cost
    expect(unitCostMinor({ unitPriceMinor: 113_00, vatRate: 13, pricesIncludeVat: true, rebateRate: 9 })).toBe(104_00);
    expect(vatInside(113_00, 13)).toBe(13_00);
  });

  it("works margins both ways on the selling price, without our VAT", () => {
    expect(priceForMargin(85_00, 15)).toBe(100_00);
    expect(marginPercent(100_00, 85_00)).toBe(15);
    expect(marginPercent(0, 85_00)).toBeNull();
    expect(marginPercent(80_00, 85_00)).toBe(-6.3);
    const vat = { rate: 13, pricesIncludeVat: true };
    expect(priceForMargin(85_00, 15, vat)).toBe(113_00);
    expect(marginPercent(113_00, 85_00, vat)).toBe(15);
  });

  it("sums the costing box and counts uncosted lines apart", () => {
    const s = costSummary([
      { quantity: 2, unitPriceMinor: 100_00, unitCostMinor: 85_00 },
      { quantity: 1, unitPriceMinor: 50_50, unitCostMinor: 40_25 },
      { quantity: 1, unitPriceMinor: 300_00, unitCostMinor: null },
    ]);
    expect(s).toEqual({ costMinor: 21025, salesMinor: 25050, profitMinor: 4025, marginPercent: 16.1, uncostedLines: 1 });
  });
});

describe("deposit and settlement", () => {
  it("splits deposit and balance exactly", () => {
    expect(splitDeposit(1_000_001, 30)).toEqual({ deposit: 300_000, balance: 700_001 });
    expect(splitDeposit(1000, 0)).toEqual({ deposit: 0, balance: 1000 });
    expect(splitDeposit(1000, 150)).toEqual({ deposit: 1000, balance: 0 });
  });

  it("tracks a 30/70 deal through to paid, counting bank charges", () => {
    const due = 10_000_00;
    expect(settle(due, [], 30).status).toBe("unpaid");
    expect(settle(due, [{ amountMinor: 1_000_00 }], 30)).toMatchObject({ status: "partly_paid", depositOutstandingMinor: 2_000_00 });
    expect(settle(due, [{ amountMinor: 2_975_00, bankChargesMinor: 25_00 }], 30)).toMatchObject({ status: "deposit_paid", outstandingMinor: 7_000_00 });
    const done = settle(due, [{ amountMinor: 2_975_00, bankChargesMinor: 25_00 }, { amountMinor: 6_980_00, bankChargesMinor: 20_00 }], 30);
    expect(done).toMatchObject({ status: "paid", outstandingMinor: 0, receivedMinor: 9_955_00, bankChargesMinor: 45_00 });
  });

  it("treats a tiny unexplained shortfall as paid only within tolerance", () => {
    expect(settle(100_00, [{ amountMinor: 99_90 }], 0, 50).status).toBe("paid");
    expect(settle(100_00, [{ amountMinor: 99_00 }], 0, 50).status).toBe("partly_paid");
    expect(settle(100_00, [{ amountMinor: 101_00 }]).status).toBe("overpaid");
  });
});

describe("profit", () => {
  // Machine 2 × 10,000 (cost 8,000 each), freight 1,000 (no cost), discount 2,100
  const a = {
    id: "a",
    discountMinor: 2_100_00,
    vatRate: 0,
    pricesIncludeVat: false,
    lines: [
      { docId: "a", lineTotalMinor: 20_000_00, quantity: 2, unitCostMinor: 8_000_00, keys: { customer: "Al-Shifa", factory: "Jinan" } },
      { docId: "a", lineTotalMinor: 1_000_00, quantity: 1, unitCostMinor: null, keys: { customer: "Al-Shifa", factory: "—" } },
    ],
  };
  const b = {
    id: "b",
    discountMinor: 0,
    vatRate: 0,
    pricesIncludeVat: false,
    lines: [{ docId: "b", lineTotalMinor: 5_000_00, quantity: 1, unitCostMinor: 4_900_00, keys: { customer: "Gulf Foods", factory: "Wenzhou" } }],
  };

  it("spreads the discount and keeps uncosted revenue apart", () => {
    const t = profitTotals(costDocLines(a));
    expect(t).toMatchObject({
      revenueMinor: 18_900_00,
      costedRevenueMinor: 18_000_00,
      uncostedRevenueMinor: 900_00,
      costMinor: 16_000_00,
      profitMinor: 2_000_00,
      marginPercent: 11.1,
      coveragePercent: 95,
    });
  });

  it("takes our VAT out of revenue when prices include it", () => {
    const [l] = costDocLines({ ...b, vatRate: 13, pricesIncludeVat: true, lines: [{ ...b.lines[0], lineTotalMinor: 113_00, unitCostMinor: 90_00 }] });
    expect(l.revenueMinor).toBe(100_00);
    expect(l.profitMinor).toBe(10_00);
  });

  it("groups by any key", () => {
    const lines = [...costDocLines(a), ...costDocLines(b)];
    expect(profitBy(lines, "customer").map((g) => [g.key, g.profitMinor])).toEqual([
      ["Al-Shifa", 2_000_00],
      ["Gulf Foods", 100_00],
    ]);
    expect(profitBy(lines, "factory").find((g) => g.key === "Wenzhou")?.marginPercent).toBe(2);
  });
});
