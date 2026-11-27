import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SRC, tsFiles } from "./source-files";

/**
 * Dates are worked out by the rules in @kebo/utils (addDays, addMonths, monthStart, monthEnd, monthOf, lastMonths,
 * monthsBetween, isMonth), each written once and tested for month ends and leap years. The web has had this guard
 * since #431; the API had none, and has no date worked out by hand today: so none may come in.
 */
const HAND = /\.set(?:UTC)?Month\(|\bDate\.UTC\(/g;

describe("dates in the API", () => {
  it("works out no date by hand (.setUTCMonth, .setMonth, Date.UTC): the rules in @kebo/utils do it", () => {
    const found = tsFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => ((line.match(HAND) ?? []).length ? [`${relative(SRC, file)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(found, "use addDays, addMonths, monthStart, monthEnd, monthOf, lastMonths or monthsBetween from @kebo/utils").toEqual([]);
  });
});
