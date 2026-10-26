import { describe, expect, it } from "vitest";
import {
  canStartRevision,
  checkManualMove,
  checkMove,
  orderNeeds,
  stageAfter,
  supersededBy,
  can,
  inquiryInput,
  revisionInput,
  stageMoveInput,
  type OrderFacts,
} from "../src";

describe("inquiry stages", () => {
  it("moves forward by itself and never backwards", () => {
    expect(stageAfter("new", "assigned")).toBe("sourcing");
    expect(stageAfter("quoted", "assigned")).toBeNull();
    expect(stageAfter("sourcing", "quotation_sent")).toBe("quoted");
    expect(stageAfter("new", "quotation_accepted")).toBe("won");
    expect(stageAfter("lost", "quotation_sent")).toBeNull();
    expect(stageAfter("won", "order_cancelled")).toBe("lost");
  });

  it("needs a reason to lose and a manager to reopen", () => {
    expect(checkManualMove("quoted", "lost", { canReopen: false })).toEqual(["Choose why the deal was lost."]);
    expect(checkManualMove("quoted", "lost", { lostReason: "price_too_high", canReopen: false })).toEqual([]);
    expect(checkManualMove("lost", "sourcing", { canReopen: false })).toEqual(["Only a manager can reopen a closed deal."]);
    expect(checkManualMove("won", "lost", { lostReason: "other", canReopen: true })[0]).toMatch(/cannot be moved/);
  });
});

describe("quotation revisions", () => {
  it("supersedes older sent revisions and locks acceptance", () => {
    const revs = [
      { number: 1, status: "sent" as const },
      { number: 2, status: "sent" as const },
    ];
    expect(supersededBy(revs, 2)).toEqual([1]);
    expect(canStartRevision([{ number: 1, status: "accepted" }])).toMatchObject({ ok: false });
    expect(canStartRevision([{ number: 1, status: "draft" }])).toMatchObject({ ok: false });
    expect(canStartRevision([{ number: 1, status: "rejected" }])).toEqual({ ok: true });
  });
});

describe("order stages", () => {
  const money = { totalMinor: 10_000_00, receivedMinor: 0, depositPercent: 30, currency: "USD", balanceTerms: "before_shipment" as const };

  it("moves one stage at a time, forward or back", () => {
    expect(checkMove("confirmed", "in_production", "open", money)).toMatchObject({ ok: true });
    expect(checkMove("in_production", "confirmed", "open", money)).toEqual({ ok: true, warnings: [] });
    expect(checkMove("confirmed", "shipped", "open", money)).toMatchObject({ ok: false, code: "not_next_or_previous" });
    expect(checkMove("shipped", "shipped", "open", money)).toMatchObject({ ok: false, code: "same_stage" });
    expect(checkMove("confirmed", "in_production", "cancelled", money)).toMatchObject({ ok: false, code: "order_not_open" });
  });

  it("warns (never blocks) when money is missing", () => {
    const noDeposit = checkMove("confirmed", "in_production", "open", money);
    expect(noDeposit.ok && noDeposit.warnings.map((w) => w.code)).toEqual(["no_deposit"]);
    expect(noDeposit.ok && noDeposit.warnings[0]!.message).toMatch(/3,000\.00/);
    const deposit = checkMove("confirmed", "in_production", "open", { ...money, receivedMinor: 3_000_00 });
    expect(deposit.ok && deposit.warnings).toEqual([]);
    const ship = checkMove("in_production", "shipped", "open", { ...money, receivedMinor: 3_000_00 });
    expect(ship.ok && ship.warnings.map((w) => w.code)).toEqual(["balance_before_shipping"]);
    const shipLater = checkMove("in_production", "shipped", "open", { ...money, receivedMinor: 3_000_00, balanceTerms: "against_bl_copy" });
    expect(shipLater.ok && shipLater.warnings).toEqual([]);
    const close = checkMove("shipped", "done", "open", { ...money, receivedMinor: 9_000_00 });
    expect(close.ok && close.warnings.map((w) => w.message)).toEqual(["USD 1,000.00 is still due from the customer."]);
  });

  it("says what each open order needs, and when it is late", () => {
    const base: OrderFacts = { ...money, stage: "confirmed", status: "open", stageSince: "2026-10-01", readyOn: null, shippedOn: null };
    expect(orderNeeds(base, "2026-10-05")).toEqual({ title: "Get the deposit (USD 3,000.00)", due: "2026-10-08", late: false });
    expect(orderNeeds(base, "2026-10-09")!.late).toBe(true);
    expect(orderNeeds({ ...base, receivedMinor: 3_000_00 }, "2026-10-05")).toMatchObject({ title: "Deposit is in: start production", late: false });
    expect(orderNeeds({ ...base, receivedMinor: 3_000_00 }, "2026-10-09")).toMatchObject({ late: true }); // never waits forever
    expect(orderNeeds({ ...base, depositPercent: 0 }, "2026-10-09")).toEqual({ title: "Start production (no deposit on these terms)", due: "2026-10-08", late: true });
    expect(orderNeeds({ ...base, stage: "in_production", readyOn: "2026-11-01" }, "2026-11-02")).toEqual({ title: "Goods due from the factory", due: "2026-11-01", late: true });
    expect(orderNeeds({ ...base, stage: "in_production" }, "2026-10-09")).toMatchObject({ title: "Ask the factory for the ready date", due: "2026-11-15" });
    expect(orderNeeds({ ...base, stage: "shipped", shippedOn: "2026-10-20", receivedMinor: 3_000_00 }, "2026-11-04")).toEqual({ title: "Get the balance (USD 7,000.00)", due: "2026-11-03", late: true });
    expect(orderNeeds({ ...base, stage: "shipped", shippedOn: "2026-10-20", receivedMinor: 10_000_00 }, "2026-11-02")).toMatchObject({ title: "Paid in full: close the order", late: false });
    expect(orderNeeds({ ...base, stage: "shipped", shippedOn: "2026-10-20", receivedMinor: 10_000_00 }, "2026-11-04")!.late).toBe(true);
    expect(orderNeeds({ ...base, stage: "done", status: "closed", receivedMinor: 10_000_00 }, "2026-11-04")).toBeNull();
    // Closed with money still owed is still chased.
    expect(orderNeeds({ ...base, stage: "done", status: "closed", shippedOn: "2026-10-20", receivedMinor: 9_000_00 }, "2026-11-04")).toEqual({ title: "Get the balance (USD 1,000.00) — the order is closed", due: "2026-11-03", late: true });
    expect(orderNeeds({ ...base, status: "cancelled" }, "2026-11-04")).toBeNull();
  });
});

describe("permissions", () => {
  it("lets staff move their orders but not record payments or cancel", () => {
    expect(can("staff", "orders.update")).toBe(true);
    expect(can("staff", "payments.record")).toBe(false);
    expect(can("staff", "orders.manage")).toBe(false);
    expect(can("manager", "payments.record")).toBe(true);
    expect(can("manager", "users.manage")).toBe(false);
    expect(can("admin", "users.manage")).toBe(true);
  });
});

describe("input schemas", () => {
  it("accepts form strings and JSON alike", () => {
    const r = revisionInput.parse({
      validUntil: "2026-12-01",
      depositPercent: "30",
      pricesIncludeVat: "on",
      lines: [{ description: "Tablet press", quantity: "2", unitPrice: "12500.50" }],
    });
    expect(r.depositPercent).toBe(30);
    expect(r.pricesIncludeVat).toBe(true);
    expect(r.lines[0]).toMatchObject({ type: "goods", unit: "pcs", unitPrice: 12500.5 });
    expect(r.incoterm).toBe("FOB");
  });

  it("explains what is missing in plain words", () => {
    const bad = inquiryInput.safeParse({ customerId: "x", category: "", items: [] });
    expect(bad.success).toBe(false);
    const messages = bad.error!.issues.map((i) => i.message);
    expect(messages).toEqual(expect.arrayContaining(["Choose a customer", "Choose a category", "Add at least one item"]));
    expect(stageMoveInput.safeParse({ to: "lost" }).error?.issues[0].message).toBe("Choose why the deal was lost");
  });
});

describe("settings", () => {
  it("fills in defaults and survives bad stored values", async () => {
    const { readSettings } = await import("../src");
    const s = readSettings({ sales: { defaultDepositPercent: 50 }, plan: "garbage" });
    expect(s.sales.defaultDepositPercent).toBe(50);
    expect(s.sales.currency).toBe("USD");
    expect(s.reminders.depositDays).toBe(7);
    expect(s.company.website).toBe("keboint.com");
  });
});

describe("review fixes", () => {
  it("reads blank form fields as not given, never as 0", async () => {
    const { revisionInput, quoteLineInput } = await import("../src");
    const line = quoteLineInput.parse({ description: "Valve", quantity: "2", unitPrice: "10", unitCost: "", fxRate: "" });
    expect(line.unitCost).toBeNull();
    expect(line.fxRate).toBeNull();
    expect(quoteLineInput.safeParse({ description: "Valve", quantity: "2", unitPrice: "" }).error?.issues[0].message).toBe("Enter a price");
    const rev = revisionInput.parse({ validUntil: "2026-12-01", depositPercent: "", lines: [{ description: "Valve", quantity: 1, unitPrice: 5 }] });
    expect(rev.depositPercent).toBe(30);
  });

  it("only accepts what the database columns can hold", async () => {
    const { quoteLineInput, amount } = await import("../src");
    expect(quoteLineInput.safeParse({ description: "x", quantity: "1.005", unitPrice: 1 }).success).toBe(false);
    expect(quoteLineInput.safeParse({ description: "x", quantity: "0.001", unitPrice: 1 }).success).toBe(false);
    expect(amount().safeParse(1e12).success).toBe(false);
  });

  it("records the customer's answer to the sent revision even when a newer draft exists", async () => {
    const { canAnswer, draftsDiscardedBy, canStartRevision } = await import("../src");
    const revs = [
      { number: 1, status: "superseded" as const },
      { number: 2, status: "sent" as const },
      { number: 3, status: "draft" as const },
    ];
    expect(canAnswer(revs, 2)).toBe(true);
    expect(canAnswer(revs, 1)).toBe(false);
    expect(draftsDiscardedBy(revs, 2)).toEqual([3]);
    expect(canStartRevision([{ number: 1, status: "void" }])).toEqual({ ok: true });
  });

  it("upper-cases exchange rate codes", async () => {
    const { readSettings } = await import("../src");
    expect(readSettings({ sales: { exchangeRates: { cny: "7.2" } } }).sales.exchangeRates).toEqual({ CNY: 7.2 });
  });
});
