import { describe, expect, it } from "vitest";
import { expenseIn, factoryPosition, orderMoney, orderPosition, orderProfit, settle } from "../src";

const pay = (amountMinor: number, bankChargesMinor = 0) => ({ amountMinor, bankChargesMinor });

describe("orderPosition: one money truth for the customer", () => {
  it("is settle() where nothing is charged and the plan is as accepted", () => {
    // A grid of totals, deposits and payments: the same status, settled, due and deposit as before.
    for (const total of [0, 1_000_00, 12_345_67])
      for (const pct of [0, 30, 33.33, 100])
        for (const payments of [[], [pay(100_00)], [pay(2_975_00, 25_00)], [pay(total)], [pay(total + 1)]]) {
          const old = settle(total, payments, pct);
          const p = orderPosition({ totalMinor: total, payments, depositPercent: pct });
          expect(p.status).toBe(old.status);
          expect(p.settledMinor).toBe(old.settledMinor);
          expect(p.dueMinor).toBe(old.outstandingMinor);
          expect(p.depositOutstandingMinor).toBe(old.depositOutstandingMinor);
          expect(p.depositReceived).toBe(old.depositOutstandingMinor === 0 && (pct > 0 || old.outstandingMinor === 0));
          // The plan built from the accepted % says the same.
          const plan = [{ amountMinor: p.depositMinor, part: "deposit" }, { amountMinor: total - p.depositMinor, part: "balance" }];
          if (p.depositMinor > 0) expect(orderPosition({ totalMinor: total, payments, depositPercent: pct, plan })).toEqual({ ...p, depositFromPlan: true });
        }
  });

  it("adds what was charged to the customer to the balance", () => {
    // USD 10,000 paid in full, USD 800 inspection charged: USD 800 still due, not "paid".
    const p = orderPosition({ totalMinor: 10_000_00, payments: [pay(10_000_00)], depositPercent: 30, chargedMinor: 800_00 });
    expect(p).toMatchObject({ totalMinor: 10_000_00, chargedMinor: 800_00, owedMinor: 10_800_00, dueMinor: 800_00, status: "partly_paid", overpaidMinor: 0 });
    const done = orderPosition({ totalMinor: 10_000_00, payments: [pay(10_000_00), pay(790_00, 10_00)], depositPercent: 30, chargedMinor: 800_00 });
    expect(done).toMatchObject({ dueMinor: 0, status: "paid" });
    // Nothing paid yet and nothing but the charge to pay: the deposit is still the plan's.
    expect(orderPosition({ totalMinor: 0, payments: [], depositPercent: 0, chargedMinor: 50_00 })).toMatchObject({ dueMinor: 50_00, depositReceived: false });
  });

  it("takes the deposit from the plan when it was edited (50% instead of 30%)", () => {
    const plan = [
      { amountMinor: 5_000_00, part: "deposit" },
      { amountMinor: 5_000_00, part: "balance" },
    ];
    const p = orderPosition({ totalMinor: 10_000_00, payments: [pay(3_000_00)], depositPercent: 30, plan });
    expect(p).toMatchObject({ depositMinor: 5_000_00, depositPercent: 50, depositFromPlan: true, depositReceived: false, depositOutstandingMinor: 2_000_00, status: "partly_paid" });
    expect(orderPosition({ totalMinor: 10_000_00, payments: [pay(5_000_00)], depositPercent: 30, plan })).toMatchObject({ depositReceived: true, status: "deposit_paid" });
    // A plan typed by hand without a deposit row: the accepted % still asks for the deposit.
    const typed = [{ amountMinor: 10_000_00, part: null }];
    expect(orderPosition({ totalMinor: 10_000_00, payments: [], depositPercent: 30, plan: typed })).toMatchObject({ depositMinor: 3_000_00, depositPercent: 30, depositFromPlan: false });
  });

  it("turns a charged expense into the order's currency", () => {
    expect(expenseIn({ amountMinor: 800_00, currency: "USD", rate: 1 }, "USD", null)).toBe(800_00);
    // CNY 710 at 7.1 → USD 100 → order in EUR at 0.9 per USD = EUR 90.
    expect(expenseIn({ amountMinor: 710_00, currency: "CNY", rate: 7.1 }, "EUR", 0.9)).toBe(90_00);
    expect(expenseIn({ amountMinor: 710_00, currency: "CNY", rate: 7.1 }, "EUR", null)).toBeNull();
  });
});

describe("factoryPosition: one truth for what we owe a factory", () => {
  const fx = { main: "USD", rates: { CNY: 7.1 } };
  const line = (factoryId: string, unitPriceMinor: number, quantity: number, taxRate = 0, taxIncluded = false, currency = "CNY") => ({
    factoryId,
    currency,
    unitPriceMinor,
    taxRate,
    taxIncluded,
    quantity,
  });

  it("owes the price with tax, less what we paid and what the factory bears", () => {
    // CNY 100 + 13% × 10 = 1,130; paid 500; a CNY 130 inspection the factory bears.
    const [f] = factoryPosition(
      [line("a", 100_00, 10, 13)],
      [{ factoryId: "a", currency: "CNY", amountMinor: 500_00 }],
      [{ factoryId: "a", currency: "CNY", amountMinor: 130_00, rate: 7.1 }],
      fx,
    );
    expect(f).toMatchObject({ owedMinor: 1_130_00, paidMinor: 500_00, takenOffMinor: 130_00, settledMinor: 630_00, toPayMinor: 500_00, overpaidMinor: 0 });
    // Tax included: the price as it is.
    expect(factoryPosition([line("a", 113_00, 10, 13, true)], [], [], fx)[0]!.owedMinor).toBe(1_130_00);
  });

  it("turns a factory's expense in another currency at its rate and the Settings rate", () => {
    // USD 100 charged to a CNY factory: USD 100 → CNY 710.
    const [f] = factoryPosition([line("a", 1_000_00, 1)], [], [{ factoryId: "a", currency: "USD", amountMinor: 100_00, rate: 1 }], fx);
    expect(f!.takenOffMinor).toBe(710_00);
    // No rate for the factory's currency: left out (never counted at 1:1).
    const [g] = factoryPosition([line("a", 1_000_00, 1, 0, false, "EUR")], [], [{ factoryId: "a", currency: "USD", amountMinor: 100_00, rate: 1 }], fx);
    expect(g!.takenOffMinor).toBe(0);
    // A factory with no lines on the order: its expense has nowhere to go.
    expect(factoryPosition([], [], [{ factoryId: "b", currency: "CNY", amountMinor: 1_00, rate: 7.1 }], fx)).toEqual([]);
  });

  it("lists factories only paid (owed 0) after those with lines", () => {
    const rows = factoryPosition([line("a", 1_00, 1)], [{ factoryId: "b", currency: "CNY", amountMinor: 5_00 }], [], fx);
    expect(rows.map((r) => [r.key, r.owedMinor, r.paidMinor, r.toPayMinor, r.overpaidMinor])).toEqual([
      ["a:CNY", 1_00, 0, 1_00, 0],
      ["b:CNY", 0, 5_00, 0, 0],
    ]);
  });
});

describe("orderMoney: named profit figures", () => {
  const facts = {
    revenueMinor: 12_000_00,
    costedRevenueMinor: 10_000_00,
    goodsCostMinor: 6_000_00,
    basisCostMinor: 1_000_00,
    receivedMinor: 5_000_00,
    factoryPaidMinor: 3_000_00,
    expensesMinor: 1_500_00,
    basisPaidMinor: 1_200_00,
    bankChargesMinor: 50_00,
  };

  it("names each figure once", () => {
    const m = orderMoney({ ...facts, beforeSaleMinor: 100_00 });
    expect(m).toMatchObject({
      grossOnQuoteMinor: 3_000_00,
      // 1,000 of the freight paid for the planned basis; 500 more is a cost, and the bank charges.
      expectedMinor: 3_000_00 - 500_00 - 50_00,
      netMinor: 3_000_00 - 500_00 - 50_00 - 100_00,
      cashMinor: 5_000_00 - 3_000_00 - 1_500_00,
      grossMarginPercent: 30,
      marginPercent: 24.5,
      coveragePercent: 83,
    });
  });

  it("is the old orderProfit under its old names (earned = expected)", () => {
    const m = orderMoney(facts);
    expect(orderProfit(facts)).toMatchObject({ earnedMinor: m.expectedMinor, cashMinor: m.cashMinor, marginPercent: m.marginPercent });
  });
});
