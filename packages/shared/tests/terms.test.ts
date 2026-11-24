import { describe, expect, it } from "vitest";
import {
  balanceTermsOfParts,
  partAmounts,
  depositOfParts,
  leadCheck,
  leadWords,
  offerPartsInput,
  offerPartsOf,
  parseLead,
  parseWarranty,
  partsWords,
  paymentCheck,
  offerPlan,
  plainOfferParts,
  plainQuoteParts,
  planParts,
  quotePartsInput,
  quotePartsOf,
  quotePaymentSentence,
  revisionInput,
  termsChecks,
  warrantyCheck,
  warrantyLine,
  type OurTerms,
  type TermPart,
  type TheirTerms,
} from "../src";

// Design "RFQ Desk — terms that travel" (16 Nov 2026): the offer's and the quotation's terms as facts, in the
// same four groups, with their words worked out from them; old offers and quotations read as they did.
const part = (label: string, percent: number, rule: string, days: number | null = null): TermPart => ({ label, percent, rule, days });
const THREE = [part("Deposit 30%", 30, "on_order"), part("Before shipment 60%", 60, "before_shipment"), part("After the site test 10%", 10, "after_sat")];
const JINAN = [part("Deposit 30%", 30, "on_order"), part("Balance 70%", 70, "on_ready")];

describe("lead times are days from a moment", () => {
  it("words for each side", () => {
    expect(leadWords(45, "after_payment", "customer")).toBe("45 days after the deposit");
    expect(leadWords(30, "after_payment", "factory")).toBe("30 days after the deposit");
    expect(leadWords(1, "after_order", "customer")).toBe("1 day after the order");
    expect(leadWords(60, "after_drawings", "factory")).toBe("60 days after the drawings are approved");
  });

  it("old words that say them plainly give the days and the moment", () => {
    expect(parseLead("45 days after deposit")).toEqual({ days: 45, from: "after_payment" });
    expect(parseLead("25 days after the advance")).toEqual({ days: 25, from: "after_payment" });
    expect(parseLead("6 weeks after order")).toEqual({ days: 42, from: "after_order" });
    expect(parseLead("30-40 days after drawing approval")).toEqual({ days: 40, from: "after_drawings" });
    expect(parseLead("30 days")).toEqual({ days: 30, from: "after_payment" });
    expect(parseLead("2 months after PO")).toEqual({ days: 60, from: "after_order" });
    // What they do not say plainly stays words.
    expect(parseLead("30 working days")).toBeNull();
    expect(parseLead("ex stock")).toBeNull();
    expect(parseLead("")).toBeNull();
    expect(parseLead(null)).toBeNull();
  });
});

describe("warranties are months from a moment", () => {
  it("the printed line: months, from when, and what it covers; an old one's words as they are", () => {
    expect(warrantyLine({ warrantyMonths: 12, warrantyFrom: "sat", warranty: "parts and service" })).toBe("12 months from the site acceptance test (SAT), parts and service.");
    expect(warrantyLine({ warrantyMonths: 12, warrantyFrom: "shipment", warranty: null })).toBe("12 months from shipment.");
    // The company's usual warranty, read as months and printed again, says what it said.
    const usual = "Warranty: 12 months from the site acceptance test (SAT), parts and service.";
    const read = parseWarranty(usual)!;
    expect(`Warranty: ${warrantyLine({ warrantyMonths: read.months, warrantyFrom: read.from, warranty: read.rest })}`).toBe(usual);
    expect(warrantyLine({ warrantyMonths: null, warrantyFrom: null, warranty: "12 months from commissioning" })).toBe("12 months from commissioning");
    expect(warrantyLine({ warrantyMonths: null, warrantyFrom: null, warranty: "  " })).toBeNull();
  });

  it("old words that say them plainly give the months, the moment and the rest", () => {
    expect(parseWarranty("Warranty: 12 months from the site acceptance test (SAT), parts and service.")).toEqual({ months: 12, from: "sat", rest: "parts and service" });
    expect(parseWarranty("12 months from commissioning")).toEqual({ months: 12, from: "sat", rest: null });
    expect(parseWarranty("18 months after shipment")).toEqual({ months: 18, from: "shipment", rest: null });
    expect(parseWarranty("1 year from delivery, parts only")).toEqual({ months: 12, from: "delivery", rest: "parts only" });
    expect(parseWarranty("Lifetime support")).toBeNull();
  });
});

describe("the payment is parts", () => {
  it("an old quotation's deposit and balance, and an old offer's deposit, read as parts", () => {
    expect(quotePartsOf({ paymentParts: null, depositPercent: 30, balanceTerms: "before_shipment" })).toEqual([
      part("Deposit 30%", 30, "on_order"),
      part("Balance 70%", 70, "before_shipment"),
    ]);
    expect(quotePartsOf({ paymentParts: null, depositPercent: 0, balanceTerms: "letter_of_credit" })).toEqual([part("Payment", 100, "lc", 0)]);
    expect(offerPartsOf({ paymentParts: null, advancePercent: 50 }, 30)).toEqual([part("Deposit 50%", 50, "on_order"), part("Balance 50%", 50, "on_ready")]);
    // No advance said: the company's usual one.
    expect(offerPartsOf({ paymentParts: null, advancePercent: null }, 30)).toEqual(JINAN);
    // Kept parts are read as kept.
    expect(quotePartsOf({ paymentParts: THREE, depositPercent: 30, balanceTerms: "before_shipment" })).toEqual(THREE);
  });

  it("the deposit and the one balance rule an older reader needs come from the parts", () => {
    expect(depositOfParts(THREE)).toBe(30);
    expect(balanceTermsOfParts(THREE)).toBe("before_shipment");
    expect(balanceTermsOfParts([part("Deposit", 30, "on_order"), part("LC", 70, "lc", 90)])).toBe("letter_of_credit");
    expect(balanceTermsOfParts([part("Deposit", 20, "on_order"), part("B/L", 80, "after_shipping", 14)])).toBe("against_bl_copy");
    expect(balanceTermsOfParts([part("All", 100, "on_order")])).toBe("before_shipment");
  });

  it("a deposit and one balance print Kebo's sentence as before; more parts print each share", () => {
    const plain = quotePartsOf({ paymentParts: null, depositPercent: 30, balanceTerms: "before_shipment" });
    expect(plainQuoteParts(plain)).toBe(true);
    expect(quotePaymentSentence(plain)).toBe("Our usual payment is made by 30% deposit and 70% before shipment.");
    expect(plainQuoteParts(THREE)).toBe(false);
    expect(quotePaymentSentence(THREE)).toBe("Our usual payment is made by 30% deposit, 60% before shipment and 10% after the site acceptance test (SAT).");
    expect(quotePaymentSentence([part("Deposit", 30, "on_order"), part("LC", 70, "lc", 90)])).toBe(
      "Our usual payment is made by 30% deposit and 70% by letter of credit, 90 days after the documents.",
    );
    expect(partsWords(JINAN, "factory")).toBe("30% when we order · 70% when ready");
  });

  it("parts must add up to 100%, and only the rules that take days keep them", () => {
    expect(quotePartsInput.safeParse([{ label: "Deposit", percent: "30", rule: "on_order" }, { label: "Balance", percent: "60", rule: "before_shipment" }]).success).toBe(false);
    const ok = quotePartsInput.parse([
      { label: "Deposit", percent: "30", rule: "on_order", days: "5" },
      { label: "B/L", percent: "70", rule: "after_shipping", days: "" },
    ]);
    expect(ok).toEqual([
      { label: "Deposit", percent: 30, rule: "on_order", days: null },
      { label: "B/L", percent: 70, rule: "after_shipping", days: 14 },
    ]);
    // A factory's parts have the factory's rules only.
    expect(offerPartsInput.safeParse([{ label: "All", percent: 100, rule: "before_shipment" }]).success).toBe(false);
    expect(offerPartsInput.safeParse([{ label: "All", percent: 100, rule: "on_ready" }]).success).toBe(true);
  });

  it("a revision sent without parts (an older client) keeps its deposit and balance; left-out new terms stay undefined", () => {
    const r = revisionInput.parse({ validUntil: "2026-12-01", depositPercent: 40, balanceTerms: "against_bl_copy", options: [{ prices: [] }] });
    expect(r.paymentParts).toBeUndefined();
    expect(r.paymentRoute).toBeUndefined();
    expect(r.warrantyMonths).toBeUndefined();
    expect(r.options[0]!.leadDays).toBeUndefined();
    const cleared = revisionInput.parse({ validUntil: "2026-12-01", paymentRoute: "", warrantyMonths: "", options: [{ prices: [], leadDays: "45", leadFrom: "after_payment" }] });
    expect(cleared.paymentRoute).toBeNull();
    expect(cleared.warrantyMonths).toBeNull();
    expect(cleared.options[0]!.leadDays).toBe(45);
  });
});

describe("what we promise, beside what the supplier gives", () => {
  const ours = (o: Partial<OurTerms> = {}): OurTerms => ({
    leadDays: 45,
    leadFrom: "after_payment",
    parts: THREE,
    warrantyMonths: 12,
    warrantyFrom: "sat",
    totalMinor: 3_012_500,
    currency: "USD",
    ...o,
  });
  const theirs = (t: Partial<TheirTerms> = {}): TheirTerms => ({
    factory: "Jinan",
    leadDays: 30,
    leadFrom: "after_payment",
    parts: JINAN,
    warrantyMonths: 12,
    warrantyFrom: "shipment",
    costMinor: 2_619_718,
    ...t,
  });

  it("lead time: the days to spare, or the days the supplier needs more", () => {
    expect(leadCheck(ours(), theirs())).toEqual({ key: "lead", ok: true, word: "15 days to spare", text: "Jinan gives 30 days after the deposit · 15 days to spare" });
    expect(leadCheck(ours({ leadDays: 30 }), theirs())?.word).toBe("Nothing to spare");
    expect(leadCheck(ours({ leadDays: 25 }), theirs())).toEqual({ key: "lead", ok: false, word: "5 days short", text: "Jinan needs 30 days after the deposit: 5 days more than we promise." });
    expect(leadCheck(ours(), theirs({ leadFrom: "after_drawings" }))).toMatchObject({ ok: false, word: "Allow for the drawings" });
    expect(leadCheck(ours({ leadDays: null }), theirs())).toBeNull();
  });

  it("payment: covered when the customer's money comes before the factory's; else what we pay first", () => {
    expect(paymentCheck(ours(), theirs())).toEqual({
      key: "payment",
      ok: true,
      word: "Covered",
      text: "Covered: the customer pays USD 9,037.50 with the order and USD 27,112.50 before shipping; Jinan wants USD 7,859.15 and USD 26,197.18.",
    });
    // The balance after shipping: we pay the factory before the customer pays us.
    const late = ours({ parts: [part("Deposit 30%", 30, "on_order"), part("Against B/L 70%", 70, "against_bl_copy")] });
    expect(paymentCheck(late, theirs())).toEqual({
      key: "payment",
      ok: false,
      word: "We may pay first",
      text: "Before the goods leave, Jinan wants 100% (≈ USD 26,197.18); the customer has paid 30% (USD 9,037.50) by then: we pay about USD 17,159.68 first, until the rest comes in.",
    });
    // A bigger advance than the deposit.
    const big = theirs({ parts: [part("Advance 50%", 50, "on_order"), part("Balance 50%", 50, "on_ready")] });
    expect(paymentCheck(ours({ parts: [part("Deposit 20%", 20, "on_order"), part("Balance 80%", 80, "before_shipment")] }), big)?.text).toBe(
      "Jinan wants 50% when we order (≈ USD 13,098.59); the customer's deposit is 20% (USD 6,025.00): we pay about USD 7,073.59 of it first.",
    );
    expect(paymentCheck(ours(), theirs({ costMinor: null }))).toBeNull();
  });

  it("warranty: the months the supplier does not cover, counted from shipment", () => {
    expect(warrantyCheck(ours(), theirs())).toEqual({
      key: "warranty",
      ok: false,
      word: "2 months not covered",
      text: "Jinan gives 12 months from shipment (the site test is about 2 months after shipment), so the last 2 months of ours are not covered by the supplier: ask Jinan for 14 months, or keep it in mind.",
    });
    expect(warrantyCheck(ours({ warrantyFrom: "shipment" }), theirs())).toEqual({ key: "warranty", ok: true, word: "Covered", text: "Covered: Jinan gives 12 months from shipment." });
    expect(warrantyCheck(ours(), theirs({ warrantyMonths: null }))).toBeNull();
  });

  it("every check both sides say enough for", () => {
    expect(termsChecks(ours(), theirs()).map((c) => [c.key, c.ok])).toEqual([
      ["lead", true],
      ["payment", true],
      ["warranty", false],
    ]);
    expect(termsChecks(ours({ leadDays: null, warrantyMonths: null }), theirs({ parts: null }))).toEqual([]);
  });

  it("an order's plan reads as parts of its total, for the same checks", () => {
    const row = (label: string, amountMinor: number, part: string | null, dueRule: string | null, dueDays: number | null = null, dueOn: string | null = null) => ({ label, amountMinor, part, dueRule, dueDays, dueOn });
    const plan = [
      row("Deposit 30%", 903_750, "deposit", "fixed", null, "2026-11-20"),
      row("Before shipment 60%", 1_807_500, null, "on_ready"),
      row("After the site test 10%", 301_250, null, "after_sat", 15),
    ];
    expect(planParts(plan, 3_012_500, null)).toEqual([part("Deposit 30%", 30, "on_order"), part("Before shipment 60%", 60, "before_shipment"), part("After the site test 10%", 10, "after_sat", 15)]);
    expect(paymentCheck(ours({ parts: planParts(plan, 3_012_500, null) }), theirs())?.ok).toBe(true);
    // A dated part counts before shipment when it falls by ship by; a part due after the goods leave, after.
    const dated = [row("Deposit", 1_000_000, "deposit", "fixed", null, "2026-11-20"), row("On 1 Dec", 1_000_000, null, "fixed", null, "2026-12-01"), row("Balance", 1_012_500, "balance", "on_ship_plus_days", 14)];
    expect(planParts(dated, 3_012_500, "2026-12-31").map((p) => [p.rule, p.days])).toEqual([
      ["on_order", null],
      ["before_shipment", null],
      ["after_shipping", 14],
    ]);
    expect(planParts(dated, 3_012_500, "2026-11-25")[1]!.rule).toBe("after_shipping");
    expect(planParts(dated, 0, null)).toEqual([]);
  });
});

describe("the supplier's plan on an order, from its offer's parts", () => {
  it("a deposit and the rest when ready is the usual plan (left to it, as before)", () => {
    expect(plainOfferParts(JINAN)).toBe(true);
    expect(plainOfferParts([part("All when ready", 100, "on_ready")])).toBe(true);
    expect(plainOfferParts([part("All with the order", 100, "on_order")])).toBe(true);
    expect(offerPlan(JINAN, 18_600_000)).toBeNull();
    expect(plainOfferParts([part("Advance 30%", 30, "on_order"), part("Ready 60%", 60, "on_ready"), part("After shipping 10%", 10, "after_shipping", 30)])).toBe(false);
  });

  it("other parts: each its share of what we owe, the last the rest, dated by its rule", () => {
    const parts = [part("Advance 30%", 30, "on_order"), part("Ready 60%", 60, "on_ready"), part("", 10, "after_shipping", 30)];
    expect(offerPlan(parts, 18_600_001)).toEqual([
      { label: "Advance 30%", percent: 30, amountMinor: 5_580_000, dueRule: "on_order", dueOn: null },
      { label: "Ready 60%", percent: 60, amountMinor: 11_160_001, dueRule: "on_ready", dueOn: null },
      { label: "10% 30 days after shipment", percent: 10, amountMinor: 1_860_000, dueRule: "on_ship_plus_days", dueOn: null, dueDays: 30 },
    ].map((r, i, all) => (i === all.length - 1 ? { ...r, amountMinor: 18_600_001 - 5_580_000 - 11_160_001 } : r)));
    // Parts that do not add up are not a plan.
    expect(offerPlan([part("Advance 30%", 30, "on_order"), part("Later", 60, "after_shipping", 30)], 1000)).toBeNull();
  });
});

describe("each part's amount adds up to the total", () => {
  it("the last part takes what is left, so the plan never ends a cent over or under", () => {
    // The review's quotation: 30% / 70% of 71,064.65 rounded each way made 71,064.66.
    expect(partAmounts([30, 70], 7_106_465)).toEqual([2_131_940, 4_974_525]);
    expect(partAmounts([30, 40, 30], 100_001).reduce((t, a) => t + a, 0)).toBe(100_001);
    // Parts that are not the whole are each rounded on their own.
    expect(partAmounts([30], 7_106_465)).toEqual([2_131_940]);
  });
});
