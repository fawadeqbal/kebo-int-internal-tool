import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, tsFiles } from "./source-files";

/**
 * Dates are worked out by the rules in @kebo/utils (addDays, addMonths, monthStart, monthEnd, monthOf, lastMonths,
 * monthsBetween, isMonth), each written once and tested for month ends and leap years. The web has had this guard
 * since #431 (months set by hand); the API had none. The API's three days counted in milliseconds are now
 * addDays, addMonths and daysBetween, so none may come in.
 */
const HAND = [
  // Months and days set by hand, and dates made from numbers (the server's own time zone).
  /\.set(?:UTC)?(?:Month|Date|FullYear)\(/,
  /\bDate\.UTC\(/,
  /\bnew Date\(\s*\d/,
  // Days counted in milliseconds from a day's text (a year is not 365 days; daysBetween and addDays are tested).
  /Date\.parse\(.*\b86_?400_?000\b/,
];
/** Moments, not days: a certificate's end time against now (`file`: why it may). */
const MOMENTS: Record<string, string> = { "platform/server-health.ts": "a certificate ends at a moment, not on a day" };

describe("dates in the API", () => {
  it("works out no date by hand (.setUTCMonth, .setDate, Date.UTC, new Date(2026, …), days in milliseconds)", () => {
    const found = tsFiles(SRC)
      .filter((file) => !MOMENTS[relative(SRC, file)])
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, i) => (HAND.some((re) => re.test(line)) ? [`${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [])),
      );
    expect(found, "use addDays, addMonths, monthStart, monthEnd, monthOf, lastMonths or monthsBetween from @kebo/utils").toEqual([]);
  });
});
