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
  convertAmount,
  restateRates,
  marginPercent,
  money,
  priceForMargin,
  profitBy,
  profitTotals,
  settle,
  splitDeposit,
  toMinor,
  withTaxMinor,
  orderProfit,
  orderCosting,
  payInstalments,
  multiplyMinor,
  percentOfMinor,
  exactDecimal,
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
    expect(allocate(10.5, [1, 1]).reduce((a, b) => a + b)).toBe(11); // fractions are rounded, never loop
    expect(allocate(7, [Infinity, 1])).toEqual([0, 7]);
    expect(allocate(7, [Number.NaN, 2])).toEqual([0, 7]);
    const parts = allocate(210_000, [2_000_000, 100_000]);
    expect(parts).toEqual([200_000, 10_000]);
  });

  it("formats for display", () => {
    expect(formatMinor(1_250_800_000, "PKR")).toBe("PKR 12,508,000.00");
  });
});

describe("document totals", () => {
  const items = [{ quantity: 2, unitPrice: 565 }];

  it("is the subtotal less the discount (sales carry no tax)", () => {
    const t = documentTotals(items, 30);
    expect([t.subtotal, t.discount, t.total]).toEqual([113000, 3000, 110000]);
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
    );
    expect(t.total).toBe(1_060_000_000);
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

  it("converts an amount between USD, CNY and PKR, and restates the rates for a new main currency", () => {
    const rates = { CNY: 7.1, PKR: 280 };
    expect(convertAmount(7100, "CNY", "USD", "USD", rates)).toBe(1000);
    expect(convertAmount(1000, "USD", "PKR", "USD", rates)).toBe(280000);
    expect(convertAmount(100, "CNY", "PKR", "USD", rates)).toBe(3943.66); // 100 / 7.1 * 280
    expect(convertAmount(12.5, "USD", "USD", "USD", rates)).toBe(12.5);
    expect(convertAmount(5, "USD", "PKR", "USD", { CNY: 7.1 })).toBeNull();
    const pkr = restateRates(rates, "USD", "PKR");
    expect(pkr.USD).toBeCloseTo(1 / 280, 12);
    expect(pkr.CNY).toBeCloseTo(7.1 / 280, 12);
    // Same answers whichever currency is the main one.
    expect(convertAmount(7100, "CNY", "USD", "PKR", pkr)).toBe(1000);
    expect(convertAmount(1000, "USD", "PKR", "PKR", pkr)).toBe(280000);
    expect(restateRates({ CNY: 7.1 }, "USD", "PKR")).toEqual({});
  });

  it("adds a factory price's tax on top", () => {
    expect(withTaxMinor(100_00, 13)).toBe(113_00);
    expect(withTaxMinor(100_00, 0)).toBe(100_00);
    expect(withTaxMinor(1_15, 13)).toBe(1_30); // 1.2995 → 1.30
    expect(withTaxMinor(100_50, 13)).toBe(113_57); // 113.565 exactly → 113.57 (floating point gives 113.5649…)
    expect(withTaxMinor(100_50, "13.00")).toBe(113_57);
    expect(withTaxMinor(10_00, 12.5)).toBe(11_25);
    expect(withTaxMinor(1_01, 0.5)).toBe(1_02); // 1.01505
    expect(withTaxMinor(-100_50, 13)).toBe(-113_57);
  });

  it("multiplies money by quantities and percentages exactly", () => {
    expect(multiplyMinor(19_85, 4.1)).toBe(81_39); // 81.385 exactly → 81.39 (floating point gives 81.3849…)
    expect(multiplyMinor(19_85, "4.10")).toBe(81_39);
    expect(multiplyMinor(-19_85, 4.1)).toBe(-81_39);
    expect(multiplyMinor(1_00, 0)).toBe(0);
    expect(multiplyMinor(33_33, "2.5")).toBe(83_33); // 83.325 → 83.33
    expect(multiplyMinor(999_999_999_999, 1)).toBe(999_999_999_999);
    expect(multiplyMinor(1_00, "abc")).toBe(0);
    expect(percentOfMinor(1_000_001, 30)).toBe(300_000); // 300,000.3
    expect(percentOfMinor(10_05, 50)).toBe(5_03); // 502.5 → 503
    expect(exactDecimal("1.50e2")).toEqual({ n: 150n, scale: 0 });
    expect(exactDecimal(0.1)).toEqual({ n: 1n, scale: 1 });
  });

  it("works margins both ways on the selling price", () => {
    expect(priceForMargin(85_00, 15)).toBe(100_00);
    expect(marginPercent(100_00, 85_00)).toBe(15);
    expect(marginPercent(0, 85_00)).toBeNull();
    expect(marginPercent(80_00, 85_00)).toBe(-6.3);
  });

  it("takes the document discount off the costing box", () => {
    // 10 × 10.00 at cost 8.00 with a 5.00 discount: sales 95.00, profit 15.00 → 15.8%
    expect(costSummary([{ quantity: 10, unitPriceMinor: 10_00, unitCostMinor: 8_00 }], 5_00)).toMatchObject({
      salesMinor: 95_00,
      profitMinor: 15_00,
      marginPercent: 15.8,
    });
  });

  it("sums the costing box and counts uncosted lines apart", () => {
    const s = costSummary([
      { quantity: 2, unitPriceMinor: 100_00, unitCostMinor: 85_00 },
      { quantity: 1, unitPriceMinor: 50_50, unitCostMinor: 40_25 },
      { quantity: 1, unitPriceMinor: 300_00, unitCostMinor: null },
    ]);
    expect(s).toEqual({ costMinor: 21025, salesMinor: 25050, profitMinor: 4025, marginPercent: 16.1, uncostedLines: 1, extraCostMinor: 0 });
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
    expect(settle(due, [{ amountMinor: 2_975_00, bankChargesMinor: 25_00 }], 30)).toMatchObject({
      status: "deposit_paid",
      outstandingMinor: 7_000_00,
    });
    const done = settle(
      due,
      [
        { amountMinor: 2_975_00, bankChargesMinor: 25_00 },
        { amountMinor: 6_980_00, bankChargesMinor: 20_00 },
      ],
      30,
    );
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
    lines: [
      { docId: "a", lineTotalMinor: 20_000_00, quantity: 2, unitCostMinor: 8_000_00, keys: { customer: "Al-Shifa", factory: "Jinan" } },
      { docId: "a", lineTotalMinor: 1_000_00, quantity: 1, unitCostMinor: null, keys: { customer: "Al-Shifa", factory: "—" } },
    ],
  };
  const b = {
    id: "b",
    discountMinor: 0,
    lines: [
      { docId: "b", lineTotalMinor: 5_000_00, quantity: 1, unitCostMinor: 4_900_00, keys: { customer: "Gulf Foods", factory: "Wenzhou" } },
    ],
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

  it("counts costs that are not lines (freight to reach our basis) against the costed revenue", () => {
    const t = profitTotals(costDocLines({ ...b, extraCostMinor: 50_00 }));
    expect(t).toMatchObject({ revenueMinor: 5_000_00, costMinor: 4_950_00, profitMinor: 50_00, uncostedRevenueMinor: 0 });
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

describe("order profit", () => {
  it("earned: costed revenue less goods cost and expenses (uncosted revenue apart); cash: in less out", () => {
    const p = orderProfit({
      revenueMinor: 10_000_00,
      costedRevenueMinor: 9_000_00,
      goodsCostMinor: 7_000_00,
      receivedMinor: 3_000_00,
      factoryPaidMinor: 2_000_00,
      expensesMinor: 500_00,
    });
    // 9,000 − 7,000 − 500: the 1,000 without a cost is never profit.
    expect(p).toMatchObject({
      earnedMinor: 1_500_00,
      cashMinor: 500_00,
      marginPercent: 16.7,
      coveragePercent: 90,
      uncostedRevenueMinor: 1_000_00,
    });
  });

  it("counts the costs to reach our basis and bank charges, without counting freight paid for them twice", () => {
    // Sold at 14,500 (14,000 goods + 500 courier with no cost); goods 10,000; 3,000 planned to reach CFR.
    const c = orderCosting(
      [
        { lineTotalMinor: 14_000_00, quantity: 1, unitCostMinor: 10_000_00 },
        { lineTotalMinor: 500_00, quantity: 1, unitCostMinor: null },
      ],
      14_500_00,
      3_000_00,
    );
    expect(c).toEqual({
      revenueMinor: 14_500_00,
      costedRevenueMinor: 14_000_00,
      uncostedRevenueMinor: 500_00,
      goodsCostMinor: 10_000_00,
      basisCostMinor: 3_000_00,
    });
    const base = { ...c, receivedMinor: 0, factoryPaidMinor: 0 };
    expect(orderProfit({ ...base, expensesMinor: 0 })).toMatchObject({ earnedMinor: 1_000_00, marginPercent: 7.1 });
    // Freight of 2,800 paid later is part of the 3,000 planned; a 200 inspection is extra.
    expect(orderProfit({ ...base, expensesMinor: 3_000_00, basisPaidMinor: 2_800_00 })).toMatchObject({
      earnedMinor: 800_00,
      coveredMinor: 2_800_00,
    });
    // Freight beyond the plan is a cost too; bank charges are a cost.
    expect(orderProfit({ ...base, expensesMinor: 3_500_00, basisPaidMinor: 3_500_00, bankChargesMinor: 20_00 })).toMatchObject({
      earnedMinor: 480_00,
    });
  });

  it("rounds negative margins away from zero", () => {
    const p = orderProfit({
      revenueMinor: 80_00,
      costedRevenueMinor: 80_00,
      goodsCostMinor: 85_00,
      receivedMinor: 0,
      factoryPaidMinor: 0,
      expensesMinor: 0,
    });
    // −5 / 80 = −6.25% → −6.3 (Math.round would give −6.2).
    expect(p.marginPercent).toBe(-6.3);
  });

  it("pays instalments in order", () => {
    expect(payInstalments([{ amountMinor: 300 }, { amountMinor: 700 }], 500).map((i) => [i.paidMinor, i.openMinor])).toEqual([
      [300, 0],
      [200, 500],
    ]);
  });
});
describe("costs that are not lines", () => {
  it("adds them to the cost and spreads them over the lines by what each costs", async () => {
    const { costSummary, landedUnitCosts } = await import("../src");
    const lines = [
      { quantity: "1", unitPriceMinor: 120000, unitCostMinor: 100000 },
      { quantity: "10", unitPriceMinor: 1200, unitCostMinor: 1000 },
    ];
    expect(costSummary(lines, 0, 20000)).toMatchObject({ costMinor: 130000, salesMinor: 132000, profitMinor: 2000, extraCostMinor: 20000 });
    // 100,000 and 10,000 of cost: freight 22,000 splits 20,000 / 2,000 → per unit +20,000 and +200.
    expect(landedUnitCosts(lines, 22000)).toEqual([120000, 1200]);
    expect(
      landedUnitCosts(
        [
          { unitCostMinor: null, quantity: 1 },
          { unitCostMinor: 500, quantity: 2 },
        ],
        100,
      ),
    ).toEqual([null, 550]);
    expect(landedUnitCosts(lines, 0)).toEqual([100000, 1000]);
  });
});
