import { describe, expect, it } from "vitest";
import {
  acceptanceDate,
  counterValues,
  countryHintFromPhone,
  depositPercentFromTerms,
  inferStage,
  lineType,
  mapChannel,
  mapHistoryStage,
  mapInquiryStage,
  mapPaymentMethod,
  mapRevisionStatuses,
  mapSettings,
  orderStatusFor,
  parseIncoterm,
  paymentKind,
  type LegacyVersion,
  type OrderStageFacts,
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

describe("order stage", () => {
  const base: OrderStageFacts = { status: "open", orderedOn: "2026-06-01", closedOn: null, depositPercent: 30, totalMinor: 100_000_00, payments: [], shipments: [] };
  const pay = (on: string, amountMinor: number) => ({ ref: "TT", on, by: "acc", amountMinor });

  it("Confirmed while nothing was paid or shipped", () => {
    expect(inferStage(base)).toEqual({ stage: "confirmed", since: "2026-06-01", shippedOn: null, history: [expect.objectContaining({ to: "confirmed", on: "2026-06-01" })] });
  });

  it("In production from the day payments reach the deposit", () => {
    expect(inferStage({ ...base, payments: [pay("2026-06-05", 20_000_00)] }).stage).toBe("confirmed");
    const s = inferStage({ ...base, payments: [pay("2026-06-09", 10_000_00), pay("2026-06-05", 20_000_00)] });
    expect(s).toMatchObject({ stage: "in_production", since: "2026-06-09" });
    expect(s.history.map((h) => h.to)).toEqual(["confirmed", "in_production"]);
  });

  it("Shipped from the first packing list, even when the deposit was never recorded (money stays owed)", () => {
    const s = inferStage({ ...base, shipments: [{ ref: "PL-2", on: "2026-07-09", by: "log" }, { ref: "PL-1", on: "2026-07-01", by: "log" }] });
    expect(s).toMatchObject({ stage: "shipped", since: "2026-07-01", shippedOn: "2026-07-01" });
    expect(s.history.map((h) => [h.to, h.on])).toEqual([["confirmed", "2026-06-01"], ["in_production", "2026-07-01"], ["shipped", "2026-07-01"]]);
    expect(s.history[1]!.note).toMatch(/no deposit was recorded/);
  });

  it("Done when the old deal was completed (and the order closed)", () => {
    const s = inferStage({ ...base, status: "closed", closedOn: "2026-08-01", payments: [pay("2026-06-05", 100_000_00)], shipments: [{ ref: "PL-1", on: "2026-07-01", by: "log" }] });
    expect(s).toMatchObject({ stage: "done", since: "2026-08-01", shippedOn: "2026-07-01" });
    expect(s.history.map((h) => h.to)).toEqual(["confirmed", "in_production", "shipped", "done"]);
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

  it("maps the single old JSON into the four groups", () => {
    const { values, dropped, problems } = mapSettings(old);
    expect(problems).toEqual([]);
    expect(values.company).toMatchObject({ name: "Kebo", nameLocal: "科波", address: "Jining", taxNo: "TAX1", bankDetails: "Bank", invoiceFooter: "Thanks", website: "www.keboint.com" });
    expect(values.sales).toMatchObject({
      currency: "USD",
      exchangeRates: { CNY: 7.2 },
      defaultMarginPercent: 18,
      quotationValidityDays: 20,
      defaultPaymentTerms: "1. Payment: 40% advance by T/T",
      defaultDepositPercent: 40,
      categories: ["Pharmaceutical Machinery"],
    });
    expect(values.reminders).toMatchObject({ newDays: 2, sourcingDays: 9, dueSoonDays: 4 });
    expect(values.notifications).toEqual({ emails: ["boss@keboint.com"], newInquiry: false, dealWonOrLost: true, paymentReceived: false, dailySummary: true });
    expect(values.reminders.depositDays).toBe(7);
    // VAT now comes from the customer's country and the factory, not from Settings.
    expect(dropped.sort()).toEqual(["invoicePaymentDays", "notifyQuotation", "pricesIncludeVat", "vatRate"]);
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

describe("price basis from the old text", () => {
  it("reads the Incoterm and keeps the rest as the place", async () => {
    const { basisFromText } = await import("../scripts/import-legacy/map");
    expect(basisFromText("EXW factory")).toEqual({ basis: "EXW", place: "factory" });
    expect(basisFromText("fob Qingdao")).toEqual({ basis: "FOB", place: "Qingdao" });
    expect(basisFromText("CFR")).toEqual({ basis: "CFR", place: null });
    expect(basisFromText("C&F Mombasa")).toEqual({ basis: "CFR", place: "Mombasa" });
    expect(basisFromText("Delivered to our warehouse")).toEqual({ basis: null, place: "Delivered to our warehouse" });
    expect(basisFromText(null)).toEqual({ basis: null, place: null });
  });
});
