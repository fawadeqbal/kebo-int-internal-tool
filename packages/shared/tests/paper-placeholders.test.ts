import { describe, expect, it } from "vitest";
import { placeholdersIn } from "../src/workflows/papers";

const doc = {
  company: { name: "Shandong Kebo", address: "Jinan", taxNo: "xxx", stamp: null },
  party: { name: "Techtribe", address: "Kabul", regNo: null, label: "Received from" },
  meta: [
    { label: "Forwarder", value: "Xxxx" },
    { label: "Vessel", value: "MSC Aurora" },
  ],
  bullets: ["Payment: 30% deposit", { label: "Packing", value: "TBD" }],
};

describe("placeholder text on a paper", () => {
  it("finds each with where it sits", () => {
    expect(placeholdersIn(doc)).toEqual(["Our tax no.: xxx", "Forwarder: Xxxx", "Packing: TBD"]);
  });

  it("leaves real words alone, x's inside a word too", () => {
    expect(placeholdersIn({ ...doc, company: { ...doc.company, taxNo: "91370100MA3XXX" }, meta: [{ label: "Box", value: "Boxx 2" }], bullets: [] })).toEqual([]);
  });
});
