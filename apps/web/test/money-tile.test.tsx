import { describe, expect, it } from "vitest";
import { moneyTile } from "@/lib/money-tile";

// A money tile with several currencies: the largest is the value; the others are named under it, never "+2".
describe("money tiles", () => {
  it("one currency: just the value", () => {
    expect(moneyTile([{ currency: "USD", amount: "1200.40" }])).toEqual({ value: "USD 1,200" });
  });
  it("several: the others named, the largest first, two at most then how many more", () => {
    const m = new Map([["PKR", 7_515_000], ["USD", 678_791], ["CNY", 449_660], ["EUR", 1_000]]);
    expect(moneyTile(m)).toEqual({ value: "PKR 7,515,000", also: "and USD 678,791 · CNY 449,660 and 1 more" });
  });
  it("nothing, or amounts that round to nothing: no 'and CNY 0'", () => {
    expect(moneyTile([])).toEqual({ value: "—" });
    expect(moneyTile(new Map([["USD", 67_083], ["CNY", 0.4]]))).toEqual({ value: "USD 67,083" });
  });
});
