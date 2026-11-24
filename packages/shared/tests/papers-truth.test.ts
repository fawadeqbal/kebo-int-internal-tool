import { describe, expect, it } from "vitest";
import {
  appMakesDocument,
  APP_DOCUMENT_KINDS,
  buyerChanges,
  packingListNo,
  paperNumber,
  ORDER_DOCUMENT_KINDS,
  paymentSentenceOf,
  routeAsAccepted,
  routePaymentSentence,
  routeWords,
  type RouteTerms,
} from "../src";

const none: RouteTerms = { route: null, balanceWhen: null, lcTerms: null, lcDays: null };
const before: RouteTerms = { route: "informal", balanceWhen: "before_shipment", lcTerms: null, lcDays: null };
const againstBl: RouteTerms = { route: "informal", balanceWhen: "against_bl_copy", lcTerms: null, lcDays: null };
const lcSight: RouteTerms = { route: "letter_of_credit", balanceWhen: null, lcTerms: "at_sight", lcDays: null };
const lc90: RouteTerms = { route: "letter_of_credit", balanceWhen: null, lcTerms: "deferred", lcDays: 90 };
const bank: RouteTerms = { route: "bank_contract", balanceWhen: null, lcTerms: null, lcDays: null };

describe("documents that never move: the terms follow the route", () => {
  it("words the sentence from the route, the deposit from the plan", () => {
    // No route yet: as the quotation said (the same sentence as before).
    expect(routePaymentSentence(30, none, "against_bl_copy")).toBe(paymentSentenceOf(30, "against_bl_copy"));
    expect(routePaymentSentence(30, before, "letter_of_credit")).toBe("Our usual payment is made by 30% deposit and 70% before shipment.");
    expect(routePaymentSentence(30, againstBl, "before_shipment")).toBe("Our usual payment is made by 30% deposit and 70% against B/L copy.");
    expect(routePaymentSentence(30, lcSight, "before_shipment")).toBe(
      "Our usual payment is made by 30% deposit and 70% by irrevocable letter of credit at sight.",
    );
    expect(routePaymentSentence(50, lc90, "letter_of_credit")).toBe(
      "Our usual payment is made by 50% deposit and 50% by irrevocable letter of credit, payable 90 days after the documents reach the buyer's bank.",
    );
    expect(routePaymentSentence(0, bank, "before_shipment")).toBe("Payment: 100% through the banks against the shipping documents.");
    expect(routePaymentSentence(100, lcSight, "letter_of_credit")).toBe("Our usual payment is made by 100% Advance payment.");
  });

  it("knows when the route is still the accepted one", () => {
    expect(routeAsAccepted(none, "before_shipment")).toBe(true);
    expect(routeAsAccepted(before, "before_shipment")).toBe(true);
    expect(routeAsAccepted(againstBl, "before_shipment")).toBe(false);
    expect(routeAsAccepted(lcSight, "letter_of_credit")).toBe(true);
    expect(routeAsAccepted(lc90, "letter_of_credit")).toBe(true);
    expect(routeAsAccepted(lcSight, "before_shipment")).toBe(false);
    expect(routeAsAccepted(bank, "against_bl_copy")).toBe(false);
    expect(routeAsAccepted(before, "after_arrival")).toBe(false);
    expect(routeWords(lc90, "before_shipment")).toBe("LC, deferred 90 days");
    expect(routeWords(none, "against_bl_copy")).toBe("balance against B/L copy");
  });
});

describe("documents that never move: kinds the app makes", () => {
  it("are never recorded by hand", () => {
    expect(APP_DOCUMENT_KINDS).toEqual(["proforma_invoice", "packing_list", "sales_contract", "commercial_invoice"]);
    expect(appMakesDocument("sales_contract")).toBe(true);
    expect(appMakesDocument("bill_of_lading")).toBe(false);
    // An outside inspector's certificate may still be recorded.
    expect(appMakesDocument("inspection")).toBe(false);
    expect(ORDER_DOCUMENT_KINDS.filter((k) => !appMakesDocument(k))).toContain("other");
  });
});

describe("documents that never move: the buyer", () => {
  it("says what differs from the customer now", () => {
    const onOrder = { name: "Karachi Builders", country: "PK", address: "Old road", taxNo: null, regNo: "" };
    expect(buyerChanges(onOrder, { ...onOrder })).toEqual([]);
    expect(buyerChanges(onOrder, { ...onOrder, address: "New road", taxNo: "NTN-1", regNo: null })).toEqual(["address", "tax no."]);
    expect(buyerChanges(null, { name: "X" })).toEqual(["name"]);
  });
});

describe("the packing list's number", () => {
  it("is the order's, with PL in front: one formula for the list, the Papers list and the cover letter", () => {
    expect(packingListNo("SO-2026-0005")).toBe("PL-2026-0005");
    expect(packingListNo("SO-2026-0031")).toBe(paperNumber("SO-2026-0031", "commercial-invoice").replace(/^CI-/, "PL-"));
  });
});

describe("papers write counts and payments as they are (review 24 Nov)", () => {
  it("a count's word agrees with it; trade short forms stay", async () => {
    const { countText } = await import("../src");
    expect(countText(1, "sets")).toBe("1 set");
    expect(countText(2000, "Carton")).toBe("2,000 Cartons");
    expect(countText(3, "Box")).toBe("3 Boxes");
    expect(countText(1, "Boxes")).toBe("1 Box");
    expect(countText(12, "pcs")).toBe("12 pcs");
    expect(countText(1.5, "m3")).toBe("1.5 m3");
    expect(countText(4)).toBe("4");
  });

  it("a plan of more than a deposit and one balance prints each part, whatever the quotation said", async () => {
    const { orderPaymentSentence } = await import("../src");
    const quote = { paymentParts: null, depositPercent: 30, balanceTerms: "before_shipment" as const };
    const terms: RouteTerms = { route: "bank_contract", balanceWhen: null, lcTerms: null, lcDays: null };
    const part = (amountMinor: number, p: string, dueRule: string | null) => ({ amountMinor, part: p, dueRule, dueDays: null, dueOn: null });
    const two = [part(30_00, "deposit", "fixed"), part(70_00, "balance", "after_papers")];
    expect(orderPaymentSentence({ depositPercent: 30, terms, accepted: "before_shipment", quote, plan: two, totalMinor: 100_00 })).toBe(
      "Our usual payment is made by 30% deposit and 70% through the banks against the shipping documents.",
    );
    const three = [part(30_00, "deposit", "fixed"), part(40_00, "balance", "on_ready"), part(30_00, "balance", "after_papers")];
    const s = orderPaymentSentence({ depositPercent: 30, terms, accepted: "before_shipment", quote, plan: three, totalMinor: 100_00 });
    expect(s).toMatch(/^Our usual payment is made by 30% .*, 40% .* and 30% /);
  });
});
