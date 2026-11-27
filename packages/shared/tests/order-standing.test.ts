import { describe, expect, it } from "vitest";
import { orderStanding, type OrderStandingFacts } from "../src";

const today = "2026-11-27";
/** An open order, just confirmed: no dates yet, the money not shown. */
const base: OrderStandingFacts = { status: "open", word: "Confirmed", readyOn: null, shipBy: null, goodsIn: false, due: null };

describe("where an order stands (the header's line)", () => {
  it("says nothing more when there are no dates yet", () => {
    expect(orderStanding(base, today)).toEqual({ notes: [], late: false, tone: "warn" });
  });

  it("until the goods leave: when they are ready, then when we ship by", () => {
    expect(orderStanding({ ...base, word: "In production", readyOn: "2026-12-04", shipBy: "2026-12-12" }, today)).toEqual({
      notes: ["ready 4 Dec", "ship by 12 Dec"],
      late: false,
      tone: "info",
    });
    expect(orderStanding({ ...base, shipBy: "2026-12-12" }, today).notes).toEqual(["ship by 12 Dec"]);
  });

  it("says the goods are in, not the day they were to be ready", () => {
    expect(
      orderStanding({ ...base, word: "In production", readyOn: "2026-11-20", shipBy: "2026-12-12", goodsIn: true }, today).notes,
    ).toEqual(["goods in", "ship by 12 Dec"]);
  });

  it("is late, and red, the day after ship-by when nothing has left", () => {
    const f = { ...base, word: "In production", shipBy: "2026-11-26" } as const;
    expect(orderStanding(f, today)).toMatchObject({ late: true, tone: "bad", notes: ["ship by 26 Nov"] });
    expect(orderStanding({ ...f, shipBy: today }, today)).toMatchObject({ late: false, tone: "info" }); // the day itself is not late
    expect(orderStanding({ ...f, word: "Confirmed" }, today)).toMatchObject({ late: true, tone: "bad" });
  });

  it("once the goods have left: only whether it is paid, and never late", () => {
    const gone = { ...base, word: "Shipped", readyOn: "2026-11-01", shipBy: "2026-11-10" } as const;
    expect(orderStanding({ ...gone, due: 1200 }, today)).toEqual({ notes: [], late: false, tone: "info" });
    expect(orderStanding({ ...gone, due: 0 }, today).notes).toEqual(["paid in full"]);
    expect(orderStanding({ ...gone, due: -5 }, today).notes).toEqual(["paid in full"]); // paid over
    expect(orderStanding({ ...gone, due: null }, today).notes).toEqual([]); // this person does not see the money
    expect(orderStanding({ ...gone, word: "Delivered", due: 0 }, today)).toEqual({ notes: ["paid in full"], late: false, tone: "ok" });
  });

  it("a closed or cancelled order says its word only: quiet when closed, red when cancelled", () => {
    const dates = { readyOn: "2026-11-01", shipBy: "2026-11-10", due: 0 } as const;
    expect(orderStanding({ ...base, ...dates, status: "closed", word: "Done" }, today)).toEqual({
      notes: [],
      late: false,
      tone: "neutral",
    });
    expect(orderStanding({ ...base, ...dates, status: "cancelled", word: "Cancelled" }, today)).toEqual({
      notes: [],
      late: false,
      tone: "bad",
    });
  });
});
