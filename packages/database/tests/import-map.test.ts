import { describe, expect, it } from "vitest";
import { planFor } from "@kebo/shared";
import {
  acceptanceDate,
  counterValues,
  countryHintFromPhone,
  depositPercentFromTerms,
  inferMilestones,
  lineType,
  mapChannel,
  mapHistoryStage,
  mapInquiryStage,
  mapPaymentMethod,
  mapRevisionStatuses,
  mapSettings,
  mapTaxTreatment,
  orderStatusFor,
  parseIncoterm,
  paymentKind,
  type LegacyVersion,
  type MilestoneFacts,
  type StageFacts,
} from "../scripts/import-legacy/map";

const facts = (f: Partial<StageFacts>): StageFacts => ({ status: "pending", assigned: false, quotationSent: false, quotationAccepted: false, statusReason: null, ...f });

describe("inquiry stage", () => {
  it("pending → new, or sourcing when assigned", () => {
    expect(mapInquiryStage(facts({})).stage).toBe("new");
    expect(mapInquiryStage(facts({ assigned: true })).stage).toBe("sourcing");
  });

  it("processing → quoted when a quotation was sent, else sourcing", () => {
    expect(mapInquiryStage(facts({ status: "processing", quotationSent: true })).stage).toBe("quoted");
    expect(mapInquiryStage(facts({ status: "processing" })).stage).toBe("sourcing");
  });

  it("completed → won with an accepted quotation, no judgement needed", () => {
    const r = mapInquiryStage(facts({ status: "completed", quotationSent: true, quotationAccepted: true }));
    expect(r).toMatchObject({ stage: "won", lostReason: null, judgement: null });
  });

  it("completed without an accepted quotation → lost, reason other, old text kept", () => {
    const r = mapInquiryStage(facts({ status: "completed", statusReason: "Went quiet" }));
    expect(r).toMatchObject({ stage: "lost", lostReason: "other", lostNote: "Went quiet" });
    expect(r.judgement).toContain("lost");
    expect(mapInquiryStage(facts({ status: "completed" })).lostNote).toMatch(/without an accepted quotation/);
  });

  it("not completed → lost with the free-text reason as the note", () => {
    expect(mapInquiryStage(facts({ status: "not_completed", statusReason: " Budget not approved " }))).toMatchObject({
      stage: "lost",
      lostReason: "other",
      lostNote: "Budget not approved",
      orderCancelled: false,
    });
  });

  it("an accepted quotation on an open deal makes it won (and is reported)", () => {
    const r = mapInquiryStage(facts({ status: "processing", quotationSent: true, quotationAccepted: true }));
    expect(r.stage).toBe("won");
    expect(r.judgement).toMatch(/processing/);
  });

  it("not completed after acceptance → lost with the order cancelled", () => {
    expect(mapInquiryStage(facts({ status: "not_completed", quotationAccepted: true, statusReason: "Cancelled" }))).toMatchObject({ stage: "lost", orderCancelled: true });
  });

  it("history statuses map to stages", () => {
    expect(mapHistoryStage("pending", false)).toBe("new");
    expect(mapHistoryStage("processing", true)).toBe("sourcing");
    expect(mapHistoryStage("completed", true)).toBe("won");
    expect(mapHistoryStage("completed", false)).toBe("lost");
    expect(mapHistoryStage("not_completed", true)).toBe("lost");
  });
});

describe("quotation revisions", () => {
  const v = (version: number, status: LegacyVersion["status"], deleted = false): LegacyVersion => ({ id: `v${version}`, version, status, deleted });

  it("an older sent version is superseded once a newer one is not a draft", () => {
    const m = mapRevisionStatuses([v(1, "sent"), v(2, "sent"), v(3, "accepted")]);
    expect(m.get("v1")!.status).toBe("superseded");
    expect(m.get("v2")!.status).toBe("superseded");
    expect(m.get("v3")!.status).toBe("accepted");
  });

  it("a newer draft does not supersede the sent version", () => {
    const m = mapRevisionStatuses([v(1, "sent"), v(2, "draft")]);
    expect(m.get("v1")!.status).toBe("sent");
    expect(m.get("v2")).toMatchObject({ status: "draft", discard: false });
  });

  it("deleted versions are ignored when deciding, and keep their status", () => {
    const m = mapRevisionStatuses([v(1, "sent"), v(2, "draft", true)]);
    expect(m.get("v1")!.status).toBe("sent");
    expect(m.get("v2")!.status).toBe("draft");
  });

  it("rejected and expired stay as they are", () => {
    const m = mapRevisionStatuses([v(1, "rejected"), v(2, "expired")]);
    expect(m.get("v1")!.status).toBe("rejected");
    expect(m.get("v2")!.status).toBe("expired");
  });

  it("only one accepted and one open draft survive", () => {
    const m = mapRevisionStatuses([v(1, "accepted"), v(2, "draft"), v(3, "accepted"), v(4, "draft")]);
    expect(m.get("v1")).toMatchObject({ status: "superseded" });
    expect(m.get("v1")!.judgement).toBeTruthy();
    expect(m.get("v2")).toMatchObject({ status: "draft", discard: true });
    expect(m.get("v3")!.status).toBe("accepted");
    expect(m.get("v4")).toMatchObject({ status: "draft", discard: false });
  });

  it("the accepted revision of a cancelled order is void", () => {
    expect(mapRevisionStatuses([v(1, "accepted")], { orderCancelled: true }).get("v1")!.status).toBe("void");
  });
});

describe("lines, channels, payments", () => {
  it("line type follows the old isServiceLine rule on the first line only", () => {
    expect(lineType("Sea freight CIF destination port, incl. export documents")).toBe("charge");
    expect(lineType("Third-party inspection (SGS)")).toBe("charge");
    expect(lineType("Rotary tablet press\nwith freight-ready crating")).toBe("goods");
    expect(lineType("Shippingcontainer seals")).toBe("goods");
    expect(lineType("HPLC system for QC lab")).toBe("goods");
  });

  it("channels and payment methods", () => {
    expect(mapChannel("walk_in")).toBe("visit");
    expect(mapChannel("website")).toBe("website");
    expect(mapPaymentMethod("lc")).toBe("letter_of_credit");
    expect(mapPaymentMethod("cheque")).toBe("cheque");
  });

  it("first payment is the deposit, the rest balance", () => {
    expect([0, 1, 2].map(paymentKind)).toEqual(["deposit", "balance", "balance"]);
  });

  it("tax treatment", () => {
    expect(mapTaxTreatment(true, 13)).toBe("export_zero_rated");
    expect(mapTaxTreatment(false, 13)).toBe("domestic_vat");
    expect(mapTaxTreatment(false, 0)).toBe("export_zero_rated");
  });

  it("country hint from the phone's calling code", () => {
    expect(countryHintFromPhone("+92 300 5123456")).toBe("PK");
    expect(countryHintFromPhone("00971 50 555 0178")).toBe("AE");
    expect(countryHintFromPhone("+1 415 555 0100")).toBe("US");
    expect(countryHintFromPhone("0300 1234567")).toBeNull();
  });
});

describe("terms", () => {
  it("deposit % from the terms text", () => {
    expect(depositPercentFromTerms("1. Payment: 30% advance by bank transfer (T/T); 70% balance")).toBe(30);
    expect(depositPercentFromTerms("50 % deposit, balance before shipment")).toBe(50);
    expect(depositPercentFromTerms("100% in advance")).toBe(100);
    expect(depositPercentFromTerms("Net 30 days")).toBeNull();
    expect(depositPercentFromTerms(null)).toBeNull();
  });

  it("incoterm and place", () => {
    expect(parseIncoterm("CIF Karachi")).toEqual({ incoterm: "CIF", place: "Karachi" });
    expect(parseIncoterm("fob Qingdao, China")).toEqual({ incoterm: "FOB", place: "Qingdao, China" });
    expect(parseIncoterm("C&F Lagos")).toEqual({ incoterm: "CFR", place: "Lagos" });
    expect(parseIncoterm("EXW")).toEqual({ incoterm: "EXW", place: null });
    expect(parseIncoterm("By sea to Karachi")).toBeNull();
    expect(parseIncoterm(null)).toBeNull();
  });

  it("acceptance date: audit first, never before sending or after the first invoice", () => {
    const base = { auditOn: null, updatedOn: "2026-05-09", sentOn: "2026-05-10", createdOn: "2026-05-09", firstInvoiceOn: "2026-05-17" };
    expect(acceptanceDate({ ...base, auditOn: "2026-05-12" })).toEqual({ date: "2026-05-12", inferred: false });
    expect(acceptanceDate(base)).toEqual({ date: "2026-05-10", inferred: true });
    expect(acceptanceDate({ ...base, updatedOn: "2026-05-14" })).toEqual({ date: "2026-05-14", inferred: true });
    expect(acceptanceDate({ ...base, updatedOn: "2026-06-30" })).toEqual({ date: "2026-05-17", inferred: true });
  });
});

describe("milestones", () => {
  const base: MilestoneFacts = { depositPercent: 30, balanceTerms: "before_shipment", totalMinor: 100_000_00, invoices: [], payments: [], shipments: [] };
  const status = (ms: ReturnType<typeof inferMilestones>) => Object.fromEntries(ms.map((m) => [m.key, m.status]));

  it("all 12 steps in plan order, all to do without evidence", () => {
    const ms = inferMilestones(base);
    expect(ms.map((m) => m.key)).toEqual(planFor("before_shipment"));
    expect(ms.map((m) => m.sortOrder)).toEqual([...Array(12).keys()]);
    expect(ms.every((m) => m.status === "todo" && !m.overridden)).toBe(true);
  });

  it("an issued invoice → proforma sent, on the earliest issue date", () => {
    const ms = inferMilestones({ ...base, invoices: [{ ref: "INV-2", on: "2026-06-02", by: "u2" }, { ref: "INV-1", on: "2026-06-01", by: "u1" }] });
    expect(ms.find((m) => m.key === "proforma_sent")).toMatchObject({ status: "done", doneOn: "2026-06-01", doneById: "u1" });
  });

  it("payments reaching the deposit share, then the total", () => {
    const pay = (on: string, amountMinor: number) => ({ ref: on, on, by: "acc", amountMinor });
    const partial = inferMilestones({ ...base, payments: [pay("2026-06-05", 20_000_00)] });
    expect(status(partial).customer_deposit).toBe("todo");

    const deposit = inferMilestones({ ...base, payments: [pay("2026-06-05", 20_000_00), pay("2026-06-09", 10_000_00)] });
    expect(deposit.find((m) => m.key === "customer_deposit")).toMatchObject({ status: "done", doneOn: "2026-06-09" });
    expect(status(deposit).customer_balance).toBe("todo");

    const full = inferMilestones({ ...base, payments: [pay("2026-06-05", 100_000_00)] });
    expect(full.find((m) => m.key === "customer_deposit")).toMatchObject({ status: "done", doneOn: "2026-06-05" });
    expect(full.find((m) => m.key === "customer_balance")).toMatchObject({ status: "done", doneOn: "2026-06-05" });
  });

  it("a 0% deposit leaves the deposit step skipped", () => {
    const ms = inferMilestones({ ...base, depositPercent: 0, payments: [{ ref: "p", on: "2026-06-05", by: "a", amountMinor: 100_000_00 }] });
    expect(status(ms).customer_deposit).toBe("skipped");
    expect(status(ms).customer_balance).toBe("done");
  });

  it("a packing list → shipped; the unrecorded steps before shipping are skipped, not left months late", () => {
    const ms = inferMilestones({ ...base, shipments: [{ ref: "PL-1", on: "2026-07-01", by: "log" }] });
    const shipped = ms.find((m) => m.key === "shipped")!;
    expect(shipped).toMatchObject({ status: "done", doneOn: "2026-07-01", overridden: true });
    expect(shipped.note).not.toMatch(/inspection_passed/); // skipped settles that gate
    expect(shipped.note).toMatch(/customer_balance/); // money still owed is never assumed
    for (const key of ["proforma_sent", "factory_order", "factory_deposit", "factory_confirmed", "samples_approved", "inspection_passed"])
      expect(ms.find((m) => m.key === key)).toMatchObject({ status: "skipped", doneOn: null, doneById: "log", note: expect.stringMatching(/PL-1/) });
    // Skipping a required step (factory order) counts as an override; an optional one (samples) does not.
    expect(ms.find((m) => m.key === "factory_order")!.overridden).toBe(true);
    expect(ms.find((m) => m.key === "samples_approved")!.overridden).toBe(false);
    // Money is never assumed: the deposit and balance stay to do when nothing was paid.
    expect(status(ms)).toMatchObject({ customer_deposit: "todo", customer_balance: "todo", factory_balance: "todo", documents_released: "todo", factory_vat_invoice: "todo" });
  });

  it("without a shipment nothing is skipped", () => {
    expect(inferMilestones(base).some((m) => m.status === "skipped")).toBe(false);
  });

  it("nothing else is ever marked done", () => {
    const ms = inferMilestones({
      ...base,
      invoices: [{ ref: "INV", on: "2026-06-01", by: "u" }],
      payments: [{ ref: "p", on: "2026-06-05", by: "a", amountMinor: 100_000_00 }],
      shipments: [{ ref: "PL", on: "2026-07-01", by: "l" }],
    });
    expect(ms.filter((m) => m.status === "done").map((m) => m.key).sort()).toEqual(["customer_balance", "customer_deposit", "proforma_sent", "shipped"]);
  });

  it("order status", () => {
    expect(orderStatusFor({ legacyStatus: "completed", paidInFull: true, shipped: true })).toBe("closed");
    expect(orderStatusFor({ legacyStatus: "completed", paidInFull: false, shipped: true })).toBe("open");
    expect(orderStatusFor({ legacyStatus: "processing", paidInFull: true, shipped: true })).toBe("open");
    expect(orderStatusFor({ legacyStatus: "not_completed", paidInFull: false, shipped: false })).toBe("cancelled");
  });
});

describe("counters", () => {
  it("continue after the highest imported number, or the old counter when higher", () => {
    const c = counterValues(["RFQ-2026-0034", "RFQ-2026-0002", "RFQ-2025-0101", "QUO-2026-0007", "PL-2026-0020", "junk"], { "QUO-2026": 9, "PL-2026": 20 }, [
      "inquiry",
      "quotation",
    ]);
    expect(Object.fromEntries(c)).toEqual({ "RFQ-2026": 34, "RFQ-2025": 101, "QUO-2026": 9 });
  });
});

describe("settings", () => {
  const old = {
    companyName: "Kebo",
    companyNameLocal: "科波",
    companyAddress: "Jining",
    companyPhone: "+86 1",
    companyEmail: "info@keboint.com",
    companyEmail2: "",
    companyTaxNo: "TAX1",
    companyWebsite: "www.keboint.com",
    bankDetails: "Bank",
    invoiceFooter: "Thanks",
    currency: "usd",
    exchangeRates: { CNY: 7.2 },
    defaultMarginPercent: 18,
    vatRate: 0,
    pricesIncludeVat: false,
    quotationValidityDays: 20,
    invoicePaymentDays: 30,
    reminderPendingDays: 2,
    reminderProcessingDays: 9,
    reminderDueSoonDays: 4,
    defaultQuotationTerms: "1. Payment: 40% advance by T/T",
    categories: ["Pharmaceutical Machinery"],
    notifyEmails: ["boss@keboint.com"],
    notifyNewQuery: false,
    notifyClosed: true,
    notifyQuotation: true,
    notifyPayment: false,
    notifyDailySummary: true,
  };

  it("maps the single old JSON into the five groups", () => {
    const { values, dropped, problems } = mapSettings(old);
    expect(problems).toEqual([]);
    expect(values.company).toMatchObject({ name: "Kebo", nameLocal: "科波", address: "Jining", taxNo: "TAX1", bankDetails: "Bank", invoiceFooter: "Thanks", website: "www.keboint.com" });
    expect(values.sales).toMatchObject({
      currency: "USD",
      exchangeRates: { CNY: 7.2 },
      defaultMarginPercent: 18,
      quotationValidityDays: 20,
      defaultTerms: "1. Payment: 40% advance by T/T",
      defaultDepositPercent: 40,
      categories: ["Pharmaceutical Machinery"],
    });
    expect(values.reminders).toMatchObject({ newDays: 2, sourcingDays: 9, dueSoonDays: 4 });
    expect(values.notifications).toEqual({ emails: ["boss@keboint.com"], newInquiry: false, dealWonOrLost: true, paymentReceived: false, dailySummary: true });
    expect(values.plan.proformaDays).toBe(1);
    expect(dropped.sort()).toEqual(["invoicePaymentDays", "notifyQuotation"]);
  });

  it("the old defaultTaxRate counts as the VAT rate", () => {
    expect(mapSettings({ defaultTaxRate: 13 }).values.sales.vatRate).toBe(13);
  });

  it("nothing stored → all defaults", () => {
    const { values, problems } = mapSettings(null);
    expect(problems).toEqual([]);
    expect(values.sales.defaultDepositPercent).toBe(30);
  });

  it("an unreadable group falls back to its defaults and is reported", () => {
    const { values, problems } = mapSettings({ notifyEmails: ["not-an-email"] });
    expect(values.notifications.emails).toEqual([]);
    expect(problems[0]).toMatch(/^notifications/);
  });
});
