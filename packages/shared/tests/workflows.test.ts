import { describe, expect, it } from "vitest";
import {
  canStartRevision,
  defaultPlan,
  planStatus,
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

  it("warns before shipping when goods are missing or not packed", () => {
    const goods = { short: ["Maize sheller: 60 of 100 pcs"], lines: 2, received: 1, packed: false };
    const ship = checkMove("in_production", "shipped", "open", { ...money, receivedMinor: 10_000_00, goods });
    expect(ship.ok && ship.warnings.map((w) => w.code)).toEqual(["not_received", "no_packing_list"]);
    expect(ship.ok && ship.warnings[0]!.message).toBe("Not everything has come in from the factory (Maize sheller: 60 of 100 pcs).");
    const ready = checkMove("in_production", "shipped", "open", { ...money, receivedMinor: 10_000_00, goods: { short: [], lines: 2, received: 2, packed: true } });
    expect(ready.ok && ready.warnings).toEqual([]);
  });

  it("guides production: goods coming in, then the packing list, then shipping", () => {
    const base: OrderFacts = { ...money, receivedMinor: 3_000_00, stage: "in_production", status: "open", stageSince: "2026-10-01", readyOn: "2026-11-01", shippedOn: null };
    expect(orderNeeds({ ...base, goods: { short: ["x"], lines: 2, received: 0, packed: false } }, "2026-10-20")!.title).toBe("Goods due from the factory");
    expect(orderNeeds({ ...base, goods: { short: ["x"], lines: 2, received: 1, packed: false } }, "2026-10-20")!.title).toBe("Goods coming in from the factory (1 of 2 items complete)");
    expect(orderNeeds({ ...base, goods: { short: [], lines: 2, received: 2, packed: false } }, "2026-10-20")!.title).toBe("All goods are in: make the packing list");
    expect(orderNeeds({ ...base, goods: { short: [], lines: 2, received: 2, packed: true } }, "2026-11-02")).toEqual({ title: "Packed and ready: mark as shipped", due: "2026-11-01", late: true });
  });

  it("reads received quantities and packing lines from forms", async () => {
    const { receiptInput, packingInput } = await import("../src");
    const lineId = "6f1c3a52-6c55-4d34-9d7c-1f1f4f4f4f4f";
    expect(receiptInput.parse({ lines: [{ lineId, receivedQty: "0.29" }] }).lines[0]!.receivedQty).toBe(0.29);
    expect(receiptInput.parse({ lines: [{ lineId, receivedQty: "" }] }).lines[0]!.receivedQty).toBe(0);
    expect(receiptInput.safeParse({ lines: [{ lineId, receivedQty: "-1" }] }).success).toBe(false);
    const p = packingInput.parse({ lines: [{ lineId, packages: "12", packageType: "", netWeightKg: "", grossWeightKg: "130.5", cbm: "1.2" }] });
    expect(p.lines[0]).toEqual({ lineId, packages: 12, packageType: "Carton", netWeightKg: null, grossWeightKg: 130.5, cbm: 1.2 });
    expect(packingInput.safeParse({ lines: [{ lineId, packages: "1.5" }] }).success).toBe(false);
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
      options: [{ prices: [{ lineId: "6f1c1f2e-9d3a-4a4b-8c3e-2b1d0e9f8a7b", unitPrice: "12500.50" }], charges: [{ description: "Sea freight", quantity: "1", unitPrice: "800" }] }],
    });
    expect(r.depositPercent).toBe(30);
    expect(r.options[0]).toMatchObject({ factoryQuoteId: null, discount: 0, prices: [{ unitPrice: 12500.5 }], charges: [{ type: "charge", unit: "lot", unitPrice: 800 }] });
    expect(r.incoterm).toBe("FOB");
  });

  it("explains what is missing in plain words", () => {
    const bad = inquiryInput.safeParse({ customerId: "x", category: "", items: [] });
    expect(bad.success).toBe(false);
    const messages = bad.error!.issues.map((i) => i.message);
    // The list of items is optional; the requirement then has to say what is needed.
    expect(messages).toEqual(expect.arrayContaining(["Choose a customer", "Choose a category", "Write what the customer needs, or add their list of items"]));
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
    expect(s.company.website).toBe("www.keboint.com"); // Kebo's details, as on its proforma
  });
});

describe("review fixes", () => {
  it("reads blank form fields as not given, never as 0", async () => {
    const { revisionInput, chargeInput } = await import("../src");
    const charge = chargeInput.parse({ description: "Freight", quantity: "1", unitPrice: "10", unitCost: "" });
    expect(charge.unitCost).toBeNull();
    expect(chargeInput.safeParse({ description: "Freight", quantity: "2", unitPrice: "" }).error?.issues[0].message).toBe("Enter a price");
    const rev = revisionInput.parse({ validUntil: "2026-12-01", depositPercent: "", options: [{ prices: [], charges: [{ description: "Freight", quantity: 1, unitPrice: 5 }] }] });
    expect(rev.depositPercent).toBe(30);
    expect(revisionInput.safeParse({ validUntil: "2026-12-01", options: [] }).success).toBe(false);
  });

  it("only accepts what the database columns can hold", async () => {
    const { chargeInput, amount } = await import("../src");
    expect(chargeInput.safeParse({ description: "x", quantity: "1.005", unitPrice: 1 }).success).toBe(false);
    expect(chargeInput.safeParse({ description: "x", quantity: "0.001", unitPrice: 1 }).success).toBe(false);
    expect(amount().safeParse(1e12).success).toBe(false);
  });

  it("says which of the customer's items an offer covers", async () => {
    const { coverage, optionLetter } = await import("../src");
    const items = [
      { id: "a", parentId: null, no: "1" },
      { id: "b", parentId: null, no: "2" },
      { id: "b1", parentId: "b", no: "2.1" },
      { id: "c", parentId: null, no: "3" },
    ];
    expect(coverage(items, ["a", "b1", null])).toEqual({ covered: ["1", "2"], missing: ["3"] });
    expect(optionLetter(0) + optionLetter(2)).toBe("AC");
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

describe("tax", () => {
  it("adds each factory item's tax on top of its price", async () => {
    const { taxSentence } = await import("../src");
    expect(taxSentence(100_00, 13, "CNY")).toBe("CNY 100.00 + 13% tax = CNY 113.00");
    expect(taxSentence(100_00, 0, "CNY")).toBe("CNY 100.00, no tax");
  });

  it("takes 13% unless an item says otherwise, and nothing else about tax", async () => {
    const { factoryInput, factoryQuoteInput, factoryQuoteLineInput, revisionInput } = await import("../src");
    expect(factoryInput.parse({ name: "X" })).not.toHaveProperty("vatRate");
    expect(factoryQuoteLineInput.parse({ description: "x", quantity: 1, unitPrice: 10 }).taxRate).toBe(13);
    expect(factoryQuoteLineInput.parse({ description: "x", quantity: 1, unitPrice: 10, taxRate: "9" }).taxRate).toBe(9);
    expect(factoryQuoteLineInput.parse({ description: "x", quantity: 1, unitPrice: 10, hsCode: "8437", rebateRate: 13 })).not.toHaveProperty("hsCode");
    const quote = factoryQuoteInput.parse({ newFactoryName: "X", receivedOn: "2026-10-20", lines: [{ description: "x", quantity: 1, unitPrice: 10 }] });
    expect(quote).not.toHaveProperty("vatRate");
    expect(revisionInput.parse({ validUntil: "2026-11-01", vatRate: 13, options: [{ prices: [] }] })).not.toHaveProperty("vatRate");
  });
});

describe("line numbers", () => {
  it("numbers items 1, 2, 3 and their parts 3.1, 3.2", async () => {
    const { lineNumbers } = await import("../src");
    expect(lineNumbers([{ key: "a" }, { key: "b" }, { key: "b1", parentKey: "b" }, { key: "b2", parentKey: "b" }, { key: "c" }, { key: "x", parentKey: "missing" }])).toEqual(["1", "2", "2.1", "2.2", "3", "4"]);
  });
});

describe("reasons", () => {
  it("offers quick choices for every kind of change", async () => {
    const { REASON_CHOICES, inquiryInput, splitItemInput } = await import("../src");
    expect(Object.values(REASON_CHOICES).every((c) => c.length >= 2)).toBe(true);
    const base = { customerId: "8d5c1f0e-3c51-4c9e-9b8e-7f3c2a1b0c9d", category: "Machinery", items: [{ description: "x", quantity: 1 }] };
    expect(inquiryInput.parse({ ...base, reason: "  Customer changed the quantity " }).reason).toBe("Customer changed the quantity");
    expect(inquiryInput.parse(base).reason).toBeUndefined();
    expect(splitItemInput.safeParse({ parts: [] }).success).toBe(false);
  });
});


describe("payment plan", () => {
  it("starts from the terms: deposit dated, balance dated later", () => {
    expect(defaultPlan(10_000_00, 30, "2026-10-01", 7)).toEqual([
      { label: "Deposit 30%", amountMinor: 3_000_00, dueOn: "2026-10-08" },
      { label: "Balance", amountMinor: 7_000_00, dueOn: null },
    ]);
    expect(defaultPlan(10_000_00, 0, "2026-10-01", 7)).toHaveLength(1);
  });

  it("pays the earliest instalment first and says where each stands", () => {
    const plan = [
      { label: "Deposit", amountMinor: 3_000_00, dueOn: "2026-10-08" },
      { label: "Second", amountMinor: 3_000_00, dueOn: "2026-10-20" },
      { label: "Balance", amountMinor: 4_000_00, dueOn: "2026-12-01" },
    ];
    const s = planStatus(plan, 4_000_00, "2026-10-21", 3);
    expect(s.map((i) => [i.status, i.paidMinor, i.openMinor])).toEqual([
      ["paid", 3_000_00, 0],
      ["late", 1_000_00, 2_000_00],
      ["open", 0, 4_000_00],
    ]);
    expect(planStatus(plan, 0, "2026-10-06", 3)[0]!.status).toBe("due_soon");
  });
});

describe("proforma numbers", () => {
  it("builds KEB + issue date + customer letters + the handler's count", async () => {
    const { proformaNumber, customerLetters } = await import("../src");
    expect(proformaNumber("KEB", "2026-09-16", "TN", 7)).toBe("KEB260916TN07");
    expect(proformaNumber("KEB", "2026-01-02", "ap", 123)).toBe("KEB260102AP123");
    expect(customerLetters("Tanzania Nuts Ltd")).toBe("TN");
    expect(customerLetters("Al-Shifa Pharma Ltd")).toBe("AP");
    expect(customerLetters("The Kampala Juice Company")).toBe("KJ");
    expect(customerLetters("Nile")).toBe("NI");
    expect(customerLetters("Société Générale SARL")).toBe("SG");
    expect(customerLetters("Kampala Juices mvpx")).toBe("KJ");
    expect(customerLetters("北京")).toBe("XX");
  });
});
