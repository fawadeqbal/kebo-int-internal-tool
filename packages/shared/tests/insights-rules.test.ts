import { describe, expect, it } from "vitest";
import { factoryReadyActual, readyDelay, shippedOnTime } from "../src";

/** Insights data (PR B): the few rules the calculated tables add, each in one place. */
describe("a factory's goods actually ready", () => {
  const line = (quantity: number, receivedQty: number, receivedOn: string | null) => ({ quantity, receivedQty, receivedOn });

  it("is the day its last line came in full", () => {
    expect(factoryReadyActual([line(2, 2, "2026-10-03"), line(1, 1, "2026-10-05")], null)).toBe("2026-10-05");
  });

  it("is not known while a line is short", () => {
    expect(factoryReadyActual([line(2, 1, "2026-10-03"), line(1, 1, "2026-10-05")], null)).toBeNull();
    expect(factoryReadyActual([], null)).toBeNull();
  });

  it("is at the latest the day the order shipped (the goods had left)", () => {
    expect(factoryReadyActual([line(2, 0, null)], "2026-10-09")).toBe("2026-10-09");
    expect(factoryReadyActual([line(2, 2, "2026-10-12")], "2026-10-09")).toBe("2026-10-09");
    expect(factoryReadyActual([line(2, 2, "2026-10-02")], "2026-10-09")).toBe("2026-10-02");
  });
});

describe("ready against the promise", () => {
  it("counts the days late, 0 when on time, nothing when a date is missing", () => {
    expect(readyDelay("2026-10-01", "2026-10-10")).toEqual({ onTime: false, daysLate: 9 });
    expect(readyDelay("2026-10-10", "2026-10-01")).toEqual({ onTime: true, daysLate: 0 });
    expect(readyDelay("2026-10-10", "2026-10-10")).toEqual({ onTime: true, daysLate: 0 });
    expect(readyDelay(null, "2026-10-10")).toEqual({ onTime: null, daysLate: null });
    expect(readyDelay("2026-10-10", null)).toEqual({ onTime: null, daysLate: null });
  });
});

describe("shipped on time", () => {
  it("is shipped by the ship-by date; unknown before shipping or without one", () => {
    expect(shippedOnTime("2026-10-10", "2026-10-10")).toBe(true);
    expect(shippedOnTime("2026-10-10", "2026-10-11")).toBe(false);
    expect(shippedOnTime(null, "2026-10-11")).toBeNull();
    expect(shippedOnTime("2026-10-10", null)).toBeNull();
  });
});
