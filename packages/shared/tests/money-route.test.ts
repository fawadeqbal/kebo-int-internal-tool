import { describe, expect, it } from "vitest";
import { divideMinor } from "@kebo/money";
import {
  allocateOldestFirst,
  balanceTermsOf,
  countsAsMinor,
  creditBalances,
  defaultFactoryPlan,
  factoryDueOn,
  factoryPlanStatus,
  lcChecks,
  lcChecksLine,
  planHow,
  planWhen,
  rebuildPlan,
  receivedForMinor,
  routePlan,
  routeSummary,
  type RouteTerms,
} from "../src";

const informal: RouteTerms = { route: "informal", balanceWhen: "before_shipment", lcTerms: null, lcDays: null };
const lc90: RouteTerms = { route: "letter_of_credit", balanceWhen: null, lcTerms: "deferred", lcDays: 90 };

describe("money v2: any currency", () => {
  it("counts a payment at the rate, exactly, half away from zero", () => {
    // PKR 1,500,000.00 at 280 per USD = USD 5,357.142857… → 5,357.14
    expect(countsAsMinor(150_000_000, 280)).toBe(535_714);
    // PKR 1,400.00 at 280 = USD 5.00 exactly; 0.07 at 0.14 = 0.50
    expect(countsAsMinor(140_000, 280)).toBe(500);
    expect(divideMinor(7, "0.14")).toBe(50);
    // Half a cent rounds away from zero: 1.25 / 2.5 → 0.50; 0.05 / 2 = 0.025 → 0.03
    expect(divideMinor(5, 2)).toBe(3);
    // A rate with decimals (CNY 7.12 per USD): CNY 110,209.00 → USD 15,478.79
    expect(countsAsMinor(11_020_900, "7.12")).toBe(1_547_879);
    // The same currency counts as itself; no rate means nothing.
    expect(countsAsMinor(12_345, 280, true)).toBe(12_345);
    expect(divideMinor(100, 0)).toBe(0);
    expect(receivedForMinor(535_714, 280)).toBe(149_999_920);
  });
});

describe("money v2: the route builds the plan", () => {
  it("builds deposit and the route's balance", () => {
    const plan = routePlan(6_300_000, 30, informal, "2026-11-01", 10);
    expect(plan).toEqual([
      { label: "Deposit 30%", amountMinor: 1_890_000, dueOn: "2026-11-11", part: "deposit", dueRule: null, dueDays: null },
      { label: "Balance before shipment", amountMinor: 4_410_000, dueOn: null, part: "balance", dueRule: null, dueDays: null },
    ]);
    const lc = routePlan(6_300_000, 30, lc90, "2026-11-01", 10);
    expect(lc[1]).toMatchObject({ label: "Balance through the LC", dueRule: "after_papers", dueDays: 90, dueOn: null });
    // Deferred: due 90 days after the papers reached their bank; at sight: that day.
    expect(routePlan(6_300_000, 30, lc90, "2026-11-01", 10, "2027-01-20")[1]!.dueOn).toBe("2027-04-20");
    expect(routePlan(6_300_000, 30, { ...lc90, lcTerms: "at_sight" }, "2026-11-01", 10, "2027-01-20")[1]!.dueOn).toBe("2027-01-20");
    // No deposit: one payment.
    expect(routePlan(100_00, 0, informal, "2026-11-01", 10)).toMatchObject([{ label: "Payment", part: "balance" }]);
  });

  it("rebuilds only what is not paid", () => {
    const stored = [
      { id: "d", label: "Deposit 30%", amountMinor: 1_890_000, dueOn: "2026-11-11" },
      { id: "b", label: "Balance before shipment", amountMinor: 4_410_000, dueOn: null },
    ];
    const fresh = routePlan(6_300_000, 30, lc90, "2026-11-01", 10);
    // Deposit paid: kept; the balance replaced by the LC's.
    const paid = rebuildPlan(stored, 1_890_000, fresh);
    expect(paid.keep.map((k) => k.id)).toEqual(["d"]);
    expect(paid.add).toMatchObject([{ label: "Balance through the LC", amountMinor: 4_410_000 }]);
    // Nothing paid: everything rebuilt.
    expect(rebuildPlan(stored, 0, fresh).keep).toEqual([]);
    // Part of the deposit paid: the deposit is rebuilt too (the payments still count against it).
    expect(rebuildPlan(stored, 1_000_000, fresh).add).toHaveLength(2);
    // A hand-made first instalment bigger than the new deposit: the rest of the plan is what is left.
    const odd = rebuildPlan([{ id: "x", label: "First", amountMinor: 2_000_000, dueOn: null }, ...stored.slice(1)], 2_000_000, fresh);
    expect(odd.add).toEqual([expect.objectContaining({ amountMinor: 4_300_000 })]);
  });

  it("says how and when", () => {
    expect(routeSummary(lc90)).toBe("LC, deferred 90 days");
    expect(routeSummary({ ...informal, balanceWhen: "against_bl_copy" })).toBe("Informal, against the B/L copy");
    expect(planHow("balance", lc90)).toBe("LC, deferred 90 days");
    expect(planHow("deposit", lc90)).toBe("T/T");
    expect(planWhen({ part: "balance", dueRule: "after_papers", dueDays: 90 }, lc90)).toBe("90 days after the papers");
    expect(balanceTermsOf(lc90, "before_shipment")).toBe("letter_of_credit");
    expect(balanceTermsOf({ ...informal, balanceWhen: "against_bl_copy" }, "letter_of_credit")).toBe("against_bl_copy");
    expect(balanceTermsOf({ route: "bank_contract", balanceWhen: null, lcTerms: null, lcDays: null }, "letter_of_credit")).toBe("against_bl_copy");
  });
});

describe("money v2: LC checks", () => {
  const base = { currency: "USD", balanceMinor: 4_410_000, readyOn: "2027-01-07", eta: "2027-02-06", courierDays: 4 };
  it("checks amount, currency, ship-by and expiry", () => {
    const checks = lcChecks({ ...base, lc: { amount: "44100.00", currency: "USD", latestShipOn: "2027-01-05", expiresOn: "2027-02-10" } });
    expect(Object.fromEntries(checks.map((c) => [c.key, c.ok]))).toEqual({ amount: true, currency: true, ship_by: false, expiry: true });
    expect(checks.find((c) => c.key === "ship_by")!.detail).toBe("LC ship by 2027-01-05 · factory ready 2027-01-07 · ask for an amendment");
    expect(lcChecksLine(checks)).toBe("3 of 4 match");
    // Expiry: ETA + courier days must be on or before it.
    expect(lcChecks({ ...base, lc: { amount: "44100", currency: "USD", latestShipOn: "2027-01-10", expiresOn: "2027-02-09" } }).find((c) => c.key === "expiry")!.ok).toBe(false);
    // Missing data: not known yet (null), never a pass.
    const none = lcChecks({ ...base, readyOn: null, eta: null, lc: null });
    expect(none.every((c) => c.ok === null)).toBe(true);
    expect(lcChecksLine(none)).toBe("0 of 4 match");
    // Short and in the wrong currency.
    const bad = lcChecks({ ...base, lc: { amount: "40000", currency: "EUR", latestShipOn: null, expiresOn: null } });
    expect(bad.slice(0, 2).map((c) => c.ok)).toEqual([false, false]);
  });

  it("warns when our ship-by is later than the LC's latest shipment (we keep ours, both are shown)", () => {
    const lc = { amount: "44100.00", currency: "USD", latestShipOn: "2027-01-15", expiresOn: "2027-02-20" };
    const late = lcChecks({ ...base, lc, shipBy: "2027-01-20" }).find((c) => c.key === "our_ship_by")!;
    expect(late).toMatchObject({ ok: false, detail: "our ship-by 2027-01-20 is after the LC's latest shipment 2027-01-15 · ship by 2027-01-15, or ask for an amendment" });
    expect(lcChecks({ ...base, lc, shipBy: "2027-01-15" }).find((c) => c.key === "our_ship_by")).toMatchObject({ ok: true, detail: "ship by 2027-01-15 · LC latest 2027-01-15" });
    expect(lcChecks({ ...base, lc: { ...lc, latestShipOn: null }, shipBy: "2027-01-15" }).find((c) => c.key === "our_ship_by")!.ok).toBeNull();
    // No ship-by of ours: nothing to compare (the four checks as before).
    expect(lcChecks({ ...base, lc }).map((c) => c.key)).toEqual(["amount", "currency", "ship_by", "expiry"]);
  });
});

describe("money v2: one transfer, credit", () => {
  it("fills the oldest due first, the rest is left over", () => {
    const r = allocateOldestFirst(
      [
        { id: "b", dueOn: "2026-11-20", orderedOn: "2026-10-01", openMinor: 378_000 },
        { id: "a", dueOn: "2026-11-11", orderedOn: "2026-10-05", openMinor: 1_890_000 },
        { id: "c", dueOn: null, orderedOn: "2026-09-01", openMinor: 500_000 },
      ],
      3_000_000,
    );
    expect(r.takes).toEqual([
      { id: "a", takesMinor: 1_890_000 },
      { id: "b", takesMinor: 378_000 },
      { id: "c", takesMinor: 500_000 },
    ]);
    expect(r.leftMinor).toBe(232_000);
    expect(allocateOldestFirst([{ id: "a", dueOn: null, orderedOn: "2026-10-05", openMinor: 1000 }], 400).takes[0]!.takesMinor).toBe(400);
  });

  it("keeps the credit as in − used − refund (a fee is not credit)", () => {
    expect(
      creditBalances([
        { kind: "in", amountMinor: 732_000, currency: "USD" },
        { kind: "used", amountMinor: 100_000, currency: "USD" },
        { kind: "refund", amountMinor: 32_000, currency: "USD" },
        { kind: "fee", amountMinor: 50_000, currency: "USD" },
        { kind: "in", amountMinor: 1000, currency: "CNY" },
      ]),
    ).toEqual({ USD: 600_000, CNY: 1000 });
  });
});

describe("money v2: the factory payment plan", () => {
  it("starts with an advance when ordered and the balance on the ready date", () => {
    expect(defaultFactoryPlan(36_736_300, 30)).toEqual([
      { label: "Advance 30%", percent: 30, amountMinor: 11_020_890, dueRule: "on_order", dueOn: null },
      { label: "Balance 70%", percent: 70, amountMinor: 25_715_410, dueRule: "on_ready", dueOn: null },
    ]);
    expect(defaultFactoryPlan(1000, 0)).toEqual([{ label: "Payment", percent: 100, amountMinor: 1000, dueRule: "on_ready", dueOn: null }]);
  });

  it("dates the balance by the ready date, and pays the parts in order", () => {
    const rows = defaultFactoryPlan(1_000_000, 30);
    expect(factoryDueOn(rows[1]!, "2026-11-08", "2027-01-07")).toBe("2027-01-07");
    const s = factoryPlanStatus(rows, 300_000, "2026-11-08", "2027-01-07", "2026-11-02", 3);
    expect(s.map((r) => [r.status, r.due, r.inDays])).toEqual([
      ["paid", "2026-11-08", 6],
      ["later", "2027-01-07", 66],
    ]);
    // The ready date moved earlier and passed: the balance is late.
    expect(factoryPlanStatus(rows, 300_000, "2026-11-08", "2026-11-01", "2026-11-02", 3)[1]!.status).toBe("late");
    // Part paid on the advance, due today.
    expect(factoryPlanStatus(rows, 100_000, "2026-11-02", null, "2026-11-02", 3)[0]).toMatchObject({ status: "due", paidMinor: 100_000, openMinor: 200_000 });
  });
});
