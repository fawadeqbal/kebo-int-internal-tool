import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import known from "./size.known.json";
import { SRC, tsFiles } from "./source-files";

/**
 * Long files (review 27 Nov 2026: one class that reads the database, applies the rules and shapes a screen).
 * Today's files of more than 1,000 lines are listed in size.known.json; the list may only shrink, as with the
 * module boundaries. A new long file means a service took on another job: give that job its own file (a read
 * for one screen, a change of state, a rule) instead.
 */
const LONG = 1000;

describe("long files", () => {
  const long = tsFiles(SRC)
    .filter((f) => readFileSync(f, "utf8").split("\n").length > LONG)
    .map((f) => relative(SRC, f))
    .sort();

  it(`adds no file of more than ${LONG} lines`, () => {
    expect(long.filter((f) => !known.includes(f))).toEqual([]);
  });

  it("keeps the known list true: a file that got shorter is taken off the list", () => {
    expect(known.filter((f) => !long.includes(f))).toEqual([]);
  });
});
