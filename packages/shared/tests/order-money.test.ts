import { describe, expect, it } from "vitest";
import { depositOf, dueOf, orderNeeds, stageWarnings } from "../src";

/** The order rules read the one position: what was charged to the customer is due, the deposit is the plan's. */
describe("order money in the stage rules", () => {
  const base = { totalMinor: 10_000_00, receivedMinor: 10_000_00, depositPercent: 30, currency: "USD", balanceTerms: "before_shipment" as const };

  it("is as before without a charge or a plan deposit", () => {
    expect(dueOf(base)).toBe(0);
    expect(depositOf(base)).toBe(3_000_00);
    expect(stageWarnings("done", base)).toEqual([]);
  });

  it("counts what was charged to the customer as due", () => {
    const m = { ...base, chargedMinor: 800_00 };
    expect(dueOf(m)).toBe(800_00);
    expect(stageWarnings("done", m).map((w) => w.message)).toEqual(["USD 800.00 is still due from the customer."]);
    const need = orderNeeds(
      { ...m, stage: "shipped", status: "open", stageSince: "2026-11-01", readyOn: null, shippedOn: "2026-11-01" },
      "2026-11-03",
    );
    expect(need?.title).toBe("Get the balance (USD 800.00)");
  });

  it("asks for the plan's deposit", () => {
    const m = { ...base, receivedMinor: 3_000_00, depositMinor: 5_000_00 };
    expect(stageWarnings("in_production", m).map((w) => w.code)).toEqual(["no_deposit"]);
    expect(stageWarnings("in_production", { ...m, receivedMinor: 5_000_00 })).toEqual([]);
  });
});
