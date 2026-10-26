import { describe, expect, it } from "vitest";
import {
  canStartRevision,
  checkManualMove,
  checkStepAction,
  initialStates,
  orderPlan,
  planFor,
  stageAfter,
  supersededBy,
  can,
  inquiryInput,
  revisionInput,
  stageMoveInput,
  type MilestoneState,
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

describe("order plan", () => {
  const facts: OrderFacts = {
    status: "open",
    orderedOn: "2026-11-02",
    shipBy: "2026-12-20",
    readyOn: null,
    currency: "USD",
    totalMinor: 10_000_00,
    depositPercent: 30,
    balanceTerms: "before_shipment",
  };
  const done = (states: MilestoneState[], key: MilestoneState["key"], on: string): MilestoneState[] =>
    states.map((s) => (s.key === key ? { ...s, status: "done", doneOn: on } : s));

  it("orders the steps by the payment terms", () => {
    const before = planFor("before_shipment");
    expect(before.indexOf("customer_balance")).toBeLessThan(before.indexOf("shipped"));
    const blCopy = planFor("against_bl_copy");
    expect(blCopy.indexOf("shipped")).toBeLessThan(blCopy.indexOf("customer_balance"));
  });

  it("starts with the proforma and asks for the exact deposit", () => {
    const plan = orderPlan(facts, initialStates(facts), "2026-11-02");
    expect(plan.stage).toBe("awaiting_deposit");
    expect(plan.next?.key).toBe("proforma_sent");
    expect(plan.next?.due).toBe("2026-11-03");
    const deposit = plan.steps.find((s) => s.key === "customer_deposit")!;
    expect(deposit.hint).toBe("30% deposit: USD 3,000.00");
    expect(deposit.due).toBe("2026-11-08"); // proforma due + 5 days, while the proforma is not sent yet
  });

  it("works due dates from what really happened, and flags late steps", () => {
    let states = initialStates(facts);
    states = done(states, "proforma_sent", "2026-11-10"); // a week late
    const plan = orderPlan(facts, states, "2026-11-20");
    const deposit = plan.steps.find((s) => s.key === "customer_deposit")!;
    expect(deposit.due).toBe("2026-11-15");
    expect(deposit.overdue).toBe(true);
    expect(plan.next?.key).toBe("customer_deposit");
    expect(plan.overdue).toBeGreaterThanOrEqual(1);
  });

  it("never asks for the documents before the goods have shipped", () => {
    const plan = orderPlan(facts, initialStates(facts), "2026-11-02");
    const due = (k: string) => plan.steps.find((s) => s.key === k)!.due!;
    expect(due("documents_released") > due("shipped")).toBe(true);
    expect(due("documents_released") >= due("customer_balance")).toBe(true);
  });

  it("skips the deposit step for 0% deposit terms", () => {
    const noDeposit = { ...facts, depositPercent: 0 };
    const states = initialStates(noDeposit);
    expect(states.find((s) => s.key === "customer_deposit")?.status).toBe("skipped");
    const plan = orderPlan(noDeposit, done(states, "proforma_sent", "2026-11-03"), "2026-11-03");
    expect(plan.next?.key).toBe("factory_order");
    expect(plan.stage).toBe("in_production");
  });

  it("keeps money in before money out unless a manager overrides with a note", () => {
    const states = initialStates(facts);
    const ctx = { terms: facts.balanceTerms, states, orderStatus: "open" as const, canOverride: false };
    expect(checkStepAction("factory_deposit", "done", ctx)).toMatchObject({ ok: false, code: "deposit_first" });
    expect(checkStepAction("factory_deposit", "done", { ...ctx, canOverride: true })).toMatchObject({ ok: false, code: "note_required" });
    expect(checkStepAction("factory_deposit", "done", { ...ctx, canOverride: true, note: "Long-time customer, deposit on the way" })).toEqual({
      ok: true,
      overridden: true,
    });
  });

  it("lets optional steps be skipped but not required ones", () => {
    const ctx = { terms: facts.balanceTerms, states: initialStates(facts), orderStatus: "open" as const, canOverride: false };
    expect(checkStepAction("samples_approved", "skip", ctx)).toEqual({ ok: true, overridden: false });
    expect(checkStepAction("customer_deposit", "skip", ctx)).toMatchObject({ ok: false, code: "required_step" });
  });

  it("does not release documents before the balance, except under a letter of credit", () => {
    const states = initialStates(facts);
    const ctx = { states, orderStatus: "open" as const, canOverride: false };
    expect(checkStepAction("documents_released", "done", { ...ctx, terms: "before_shipment" })).toMatchObject({ ok: false, code: "balance_first" });
    expect(checkStepAction("documents_released", "done", { ...ctx, terms: "letter_of_credit" })).toMatchObject({ ok: true });
  });

  it("reaches ready to ship, shipped and closed", () => {
    let states = initialStates(facts);
    for (const k of ["proforma_sent", "customer_deposit", "factory_order", "factory_deposit", "factory_confirmed"] as const) states = done(states, k, "2026-11-10");
    states = states.map((s) => (s.key === "samples_approved" || s.key === "inspection_passed" || s.key === "factory_vat_invoice" ? { ...s, status: "skipped" } : s));
    expect(orderPlan(facts, states, "2026-11-10").stage).toBe("ready_to_ship");
    for (const k of ["customer_balance", "factory_balance", "shipped"] as const) states = done(states, k, "2026-12-18");
    expect(orderPlan(facts, states, "2026-12-18").stage).toBe("shipped");
    states = done(states, "documents_released", "2026-12-19");
    const plan = orderPlan(facts, states, "2026-12-19");
    expect(plan.complete).toBe(true);
    expect(plan.stage).toBe("closed");
    expect(plan.next).toBeNull();
  });
});

describe("permissions", () => {
  it("lets staff tick steps but not override gates or record payments", () => {
    expect(can("staff", "milestones.update")).toBe(true);
    expect(can("staff", "milestones.override")).toBe(false);
    expect(can("staff", "payments.record")).toBe(false);
    expect(can("manager", "milestones.override")).toBe(true);
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
    expect(s.plan.depositDays).toBe(5);
    expect(s.company.website).toBe("keboint.com");
  });
});

describe("review fixes", () => {
  it("does not undo a step another done step depended on, unless a manager explains", async () => {
    const { checkStepAction, initialStates } = await import("../src");
    const states = initialStates({ depositPercent: 30, balanceTerms: "before_shipment" }).map((s) =>
      s.key === "customer_deposit" || s.key === "factory_deposit" ? { ...s, status: "done" as const, doneOn: "2026-11-01" } : s,
    );
    const ctx = { terms: "before_shipment" as const, states, orderStatus: "open" as const, canOverride: false };
    expect(checkStepAction("customer_deposit", "undo", ctx)).toMatchObject({ ok: false, code: "dependents_done" });
    expect(checkStepAction("customer_deposit", "undo", { ...ctx, canOverride: true })).toMatchObject({ ok: false, code: "note_required" });
    expect(checkStepAction("customer_deposit", "undo", { ...ctx, canOverride: true, note: "Deposit bounced" })).toEqual({ ok: true, overridden: true });
    expect(checkStepAction("factory_deposit", "undo", ctx)).toEqual({ ok: true, overridden: false });
  });

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
