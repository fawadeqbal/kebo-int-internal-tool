import { describe, expect, it } from "vitest";
import { change, lastMonths, periodOf, sectionOfTab, spanLabel } from "@/lib/insights-period";

/** Insights' one period for every figure, and the one before it to compare with. */
describe("Insights period", () => {
  const today = "2026-11-03";

  it("is the 3 months ending this month by default, against the 3 before", () => {
    const p = periodOf({}, today);
    expect([p.kind, p.from, p.to, p.prevFrom, p.prevTo]).toEqual(["quarter", "2026-09-01", "2026-11-30", "2026-06-01", "2026-08-31"]);
    expect(p.label).toBe("1 Sep – 30 Nov 2026");
    expect(p.vsLabel).toBe("Jun – Aug");
  });

  it("knows a month and a year, across the turn of the year", () => {
    const m = periodOf({ period: "month" }, "2026-01-15");
    expect([m.from, m.to, m.prevFrom, m.prevTo, m.vsLabel]).toEqual(["2026-01-01", "2026-01-31", "2025-12-01", "2025-12-31", "Dec"]);
    expect(m.label).toBe("1–31 Jan 2026");
    const y = periodOf({ period: "year" }, today);
    expect([y.from, y.to, y.prevFrom, y.prevTo]).toEqual(["2025-12-01", "2026-11-30", "2024-12-01", "2025-11-30"]);
    expect(y.vsLabel).toBe("Dec 2024 – Nov 2025");
  });

  it("takes your own dates and compares them with as many days just before", () => {
    const p = periodOf({ period: "custom", from: "2026-10-10", to: "2026-10-19" }, today);
    expect([p.from, p.to, p.prevFrom, p.prevTo]).toEqual(["2026-10-10", "2026-10-19", "2026-09-30", "2026-10-09"]);
    // Bad or backwards dates fall back to the quarter.
    expect(periodOf({ period: "custom", from: "2026-10-19", to: "2026-10-10" }, today).kind).toBe("quarter");
    expect(periodOf({ period: "custom", from: "nonsense" }, today).kind).toBe("quarter");
  });

  it("says the change in percent, and nothing from zero", () => {
    expect(change(118, 100)).toBe(18);
    expect(change(94, 100)).toBe(-6);
    expect(change(5, 0)).toBeNull();
    expect(change(-50, -100)).toBe(50);
  });

  it("lists the 12 months of the chart and labels spans", () => {
    expect(lastMonths("2026-11-30")).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(spanLabel("2025-12-01", "2026-11-30")).toBe("1 Dec 2025 – 30 Nov 2026");
  });

  it("sends old tabs to the section that has them now", () => {
    expect(sectionOfTab("sales")).toEqual({ section: "funnel" });
    expect(sectionOfTab("profit")).toEqual({ section: "money" });
    expect(sectionOfTab("targets")).toEqual({ section: "people", view: "targets" });
    expect(sectionOfTab(undefined)).toBeNull();
  });
});
