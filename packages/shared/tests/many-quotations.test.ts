import { describe, expect, it } from "vitest";
import {
  byLetter,
  canMoveRevision,
  dealQuotation,
  dealRevision,
  letterIndex,
  nextQuotationLetter,
  quotationBase,
  quotationLetter,
  quotationNumber,
  type RevisionStatus,
} from "../src";

const rev = (number: number, status: RevisionStatus, total = 0) => ({ number, status, total });
const worth = (r: { total: number }) => r.total;

describe("any number of quotations per inquiry", () => {
  it("letters them A … Z, then AA, AB, as spreadsheet columns, and back", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(quotationLetter)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
    for (const i of [0, 3, 25, 26, 51, 702]) expect(letterIndex(quotationLetter(i))).toBe(i);
  });

  it("gives a new quotation the first free letter (a deleted draft's letter comes back)", () => {
    expect(nextQuotationLetter([])).toBe("A");
    expect(nextQuotationLetter(["A", "B"])).toBe("C");
    expect(nextQuotationLetter(["A", "C"])).toBe("B");
    expect(nextQuotationLetter(Array.from({ length: 26 }, (_, i) => quotationLetter(i)))).toBe("AA");
  });

  it("keeps one QUO number per inquiry: an older quotation without a letter is A, its number the inquiry's", () => {
    expect(quotationBase({ refNo: "QUO-2026-0531-B", letter: "B" })).toBe("QUO-2026-0531");
    expect(quotationBase({ refNo: "QUO-2026-0007", letter: "A" })).toBe("QUO-2026-0007");
    expect(quotationNumber(quotationBase({ refNo: "QUO-2026-0007", letter: "A" }), "B")).toBe("QUO-2026-0007-B");
    expect(byLetter([{ letter: "AA" }, { letter: "C" }, { letter: "A" }]).map((q) => q.letter)).toEqual(["A", "C", "AA"]);
  });

  it("not chosen is final, like the other answers", () => {
    expect(canMoveRevision("not_chosen", "sent")).toBe(false);
    expect(canMoveRevision("not_chosen", "accepted")).toBe(false);
  });
});

describe("a deal counts once", () => {
  it("speaks with the accepted quotation", () => {
    const a = { letter: "A", revisions: [rev(1, "not_chosen", 100)] };
    const b = { letter: "B", revisions: [rev(1, "superseded", 300), rev(2, "accepted", 250)] };
    expect(dealRevision([a, b], worth)).toMatchObject({ number: 2, status: "accepted" });
    expect(dealQuotation([a, b], worth)).toBe(b);
  });

  it("else with the lowest of those waiting for an answer, before answered ones", () => {
    const a = { letter: "A", revisions: [rev(1, "sent", 300)] };
    const b = { letter: "B", revisions: [rev(1, "sent", 200), rev(2, "draft", 50)] };
    const c = { letter: "C", revisions: [rev(1, "expired", 100)] };
    expect(dealRevision([a, b, c], worth)).toMatchObject({ number: 1, total: 200 });
    expect(dealQuotation([a, b, c], worth)).toBe(b);
    // Nothing waiting: the lowest answered one.
    const d = { letter: "D", revisions: [rev(1, "rejected", 400)] };
    expect(dealRevision([c, d], worth)).toMatchObject({ total: 100 });
  });

  it("with one quotation, is its newest revision the customer has seen (as before)", () => {
    const only = { letter: "A", revisions: [rev(1, "superseded", 100), rev(2, "sent", 120), rev(3, "draft", 90)] };
    expect(dealRevision([only])).toMatchObject({ number: 2 });
    const reopened = { letter: "A", revisions: [rev(1, "void", 100), rev(2, "sent", 90)] };
    expect(dealRevision([reopened])).toMatchObject({ number: 2 });
  });

  it("is nothing while every quotation is a draft; the list then shows the first by letter", () => {
    const b = { letter: "B", revisions: [rev(1, "draft", 100)] };
    const a = { letter: "A", revisions: [rev(1, "draft", 200)] };
    expect(dealRevision([b, a])).toBeNull();
    expect(dealQuotation([b, a])).toBe(a);
    expect(dealQuotation([])).toBeNull();
  });
});
