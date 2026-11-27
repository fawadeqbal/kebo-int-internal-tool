import { describe, expect, it } from "vitest";
import { periodOf } from "@/components/common/period";

/** ?p= on Payments and the cash book: a month or a year, never after today; anything else is this month. */
describe("the period in the address", () => {
  const today = "2026-11-27";
  it("takes a month or a year up to today", () => {
    expect(periodOf("2026-10", today)).toMatchObject({ period: "2026-10", isYear: false, from: "2026-10-01", to: "2026-10-31" });
    expect(periodOf("2025", today)).toMatchObject({ period: "2025", isYear: true, from: "2025-01-01", to: "2025-12-31" });
    // This year stops at today.
    expect(periodOf("2026", today)).toMatchObject({ period: "2026", to: today, hasNext: false });
  });
  it("opens this month for a month that does not exist, one after today, or anything else", () => {
    for (const asked of ["2025-13", "2025-00", "2026-12", "2027", "26-11", "", undefined])
      expect(periodOf(asked, today)).toMatchObject({ period: "2026-11", from: "2026-11-01", to: today });
  });
});
