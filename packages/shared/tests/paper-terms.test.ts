import { describe, expect, it } from "vitest";
import { PAPER } from "../src";

const offer = {
  basis: "FOB" as const,
  basisPlace: "Qingdao",
  leadTime: "35 days after the deposit",
  paymentParts: [
    { label: "Deposit", percent: 30, rule: "on_order", days: null },
    { label: "Balance", percent: 70, rule: "on_ready", days: null },
  ],
  paymentTerms: "Bank charges outside China for us.",
  warranty: null,
  warrantyMonths: 12,
  warrantyFrom: "shipment",
  moq: null,
  notes: "",
};

describe("papers", () => {
  it("read a supplier offer: each row in its words, nothing said is null", () => {
    const p = PAPER.ofOffer(offer);
    expect(p.side).toBe("factory");
    const rows = Object.fromEntries([...PAPER.kinds.offer.terms, ...PAPER.kinds.offer.conditions].map((r) => [r, PAPER.text(p, r)]));
    expect(rows).toEqual({
      incoterm: "FOB Qingdao",
      leadTime: "35 days after the deposit",
      payment: "30% when we order · 70% when ready",
      paymentNote: "Bank charges outside China for us.",
      warranty: "12 months from shipment",
      moq: null,
      notes: null,
    });
  });

  it("say no Incoterm when the offer has none, even with a place", () => {
    expect(PAPER.text(PAPER.ofOffer({ ...offer, basis: null }), "incoterm")).toBeNull();
  });

  it("label every row each paper shows; the Incoterm row is called Incoterm", () => {
    for (const k of ["offer", "quotation"] as const) {
      for (const r of PAPER.kinds[k].terms) expect(PAPER.rows.terms[r]).toBeTruthy();
      for (const r of PAPER.kinds[k].conditions) expect(PAPER.rows.conditions[r]).toBeTruthy();
    }
    expect(PAPER.rows.terms.incoterm).toBe("Incoterm");
  });

  it("read a quotation: what we promise, in the customer's words", () => {
    const p = PAPER.ofRevision({
      incoterm: "CIF",
      incotermPlace: "Karachi",
      portOfDischarge: null,
      leadTime: "45 days after the deposit",
      deliveryTerms: "",
      paymentRoute: "letter_of_credit",
      paymentParts: offer.paymentParts,
      paymentTerms: null,
      warranty: null,
      warrantyMonths: 12,
      warrantyFrom: "sat",
      notes: "Prices in USD.",
    });
    expect(p.side).toBe("customer");
    const rows = Object.fromEntries([...PAPER.kinds.quotation.terms, ...PAPER.kinds.quotation.conditions].map((r) => [r, PAPER.text(p, r)]));
    expect(rows.incoterm).toBe("CIF Karachi");
    expect(rows.port).toBeNull();
    expect(rows.deliveryNote).toBeNull();
    expect(rows.route).toBe("LC");
    expect(rows.payment).toContain("30%");
    expect(rows.notes).toBe("Prices in USD.");
    expect(PAPER.optional).toContain("port");
  });
});
