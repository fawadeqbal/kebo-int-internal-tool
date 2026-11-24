import { describe, expect, it } from "vitest";
import { parseList } from "../src/components/deals/paste-list";

describe("Paste items", () => {
  it("reads a target price, by its header or as the second number (review 24 Nov: it was dropped)", () => {
    const withHeader = parseList("Item\tQty\tUnit\tTarget price\nGate valve DN100\t200\tpcs\t1,250.50");
    expect(withHeader).toEqual([{ description: "Gate valve DN100", model: "", quantity: "200", unit: "pcs", price: "1250.50", part: false }]);
    const noHeader = parseList("Gate valve DN100\t200\tpcs\t1250");
    expect(noHeader[0]).toMatchObject({ quantity: "200", unit: "pcs", price: "1250" });
  });

  it("a size times a length stays in the description; a plain quantity is read", () => {
    expect(parseList("Steel cable 8mm x 30 m")[0]).toMatchObject({ description: "Steel cable 8mm x 30 m", quantity: "" });
    expect(parseList("Gate valve DN100 x 200 pcs")[0]).toMatchObject({ description: "Gate valve DN100", quantity: "200", unit: "pcs" });
  });
});
