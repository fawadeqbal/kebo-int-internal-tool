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
      lines: [{ description: "Tablet press", quantity: "2", unitPrice: "12500.50" }],
    });
    expect(r.depositPercent).toBe(30);
    expect(r.vatRate).toBe(0); // exports carry no VAT
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
    expect(s.company.website).toBe("www.keboint.com"); // Kebo's details, as on its proforma
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

describe("tax", () => {
  it("charges VAT only to customers in China", async () => {
    const { saleVatFor } = await import("../src");
    expect(saleVatFor("CN")).toBe(13);
    expect(saleVatFor("ng")).toBe(0);
    expect(saleVatFor(null)).toBe(0);
  });

  it("gives back price × the rebate rate, never more than the tax, nothing without tax", async () => {
    const { rebateMinor, effectiveRebate } = await import("../src");
    const line = { unitPriceMinor: 100_00, quantity: 10 };
    expect(rebateMinor({ ...line, vatRate: 13, rebateRate: 13 })).toBe(130_00); // 100 × 13% × 10
    expect(rebateMinor({ ...line, vatRate: 13, rebateRate: 9 })).toBe(90_00);
    expect(rebateMinor({ ...line, vatRate: 0, rebateRate: 13 })).toBe(0); // no tax paid, nothing back
    expect(effectiveRebate(13, 3)).toBe(3); // 3% tax caps the rebate
  });

  it("explains a factory price in one line", async () => {
    const { costSentence } = await import("../src");
    const p = { unitPriceMinor: 100_00, currency: "CNY" };
    expect(costSentence({ ...p, vatRate: 13, rebateRate: 13, costMinor: 100_00 })).toBe("CNY 100.00 + 13% tax = CNY 113.00 · 13% rebate back · your cost CNY 100.00");
    expect(costSentence({ ...p, vatRate: 13, rebateRate: 0, costMinor: 113_00 })).toBe("CNY 100.00 + 13% tax = CNY 113.00 · your cost CNY 113.00");
    expect(costSentence({ ...p, vatRate: 0, rebateRate: 13, costMinor: 100_00 })).toBe("CNY 100.00, no tax · your cost CNY 100.00");
  });

  it("reminds about the VAT invoice, then filing the rebate within 90 days", async () => {
    const { rebateNeeds } = await import("../src");
    const o = { shippedOn: "2026-08-01", rebate: [{ amountMinor: 130_00, currency: "CNY" }], vatInvoiceReceivedOn: null, rebateFiledOn: null };
    expect(rebateNeeds(o, "2026-08-20")).toEqual({ title: "Get the factory's special VAT invoice (rebate CNY 130.00)", due: "2026-08-31", late: false, deadline: "2026-10-30" });
    expect(rebateNeeds({ ...o, vatInvoiceReceivedOn: "2026-08-10" }, "2026-10-01")).toEqual({ title: "File the export rebate (CNY 130.00) by 2026-10-30", due: "2026-09-30", late: true, deadline: "2026-10-30" });
    expect(rebateNeeds({ ...o, rebateFiledOn: "2026-09-01" }, "2026-10-01")).toBeNull();
    expect(rebateNeeds({ ...o, shippedOn: null }, "2026-10-01")).toBeNull();
    expect(rebateNeeds({ ...o, rebate: [{ amountMinor: 0, currency: "CNY" }] }, "2026-10-01")).toBeNull();
  });

  it("adds 13% tax to factory prices unless changed, and asks each item's rebate", async () => {
    const { factoryInput, factoryQuoteInput, factoryQuoteLineInput } = await import("../src");
    expect(factoryInput.parse({ name: "X" })).not.toHaveProperty("vatRate"); // nothing about tax on the factory
    const quote = { newFactoryName: "X", receivedOn: "2026-10-20", currency: "CNY", lines: [{ description: "x", quantity: 1, unitPrice: 10, rebateRate: 0 }] };
    expect(factoryQuoteInput.parse(quote).vatRate).toBe(13);
    expect(factoryQuoteInput.parse({ ...quote, vatRate: "15" }).vatRate).toBe(15);
    expect(factoryQuoteLineInput.safeParse({ description: "x", quantity: 1, unitPrice: 10 }).error?.issues[0]!.message).toBe("Choose the export rebate for this item");
    expect(factoryQuoteLineInput.parse({ description: "x", quantity: 1, unitPrice: 10, hsCode: " 8437 .80", rebateRate: "9" })).toMatchObject({ hsCode: "8437.80", rebateRate: 9 });
    expect(factoryQuoteLineInput.safeParse({ description: "x", quantity: 1, unitPrice: 10, hsCode: "ABC", rebateRate: 9 }).success).toBe(false);
  });
});
