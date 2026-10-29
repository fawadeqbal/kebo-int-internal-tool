import { describe, expect, it } from "vitest";
import { migrationProblems } from "../scripts/migration-order";

const main = ["20261026065214_init", "20261110090100_utc_timestamps", "20261112090000_marketing_site"];

describe("migration order", () => {
  it("a new migration after the last one on main is fine", () => {
    expect(migrationProblems(main, [...main, "20261113000000_database_markers"])).toEqual([]);
    expect(migrationProblems(main, main)).toEqual([]);
  });

  it("refuses a new migration that sorts before one already on main", () => {
    expect(migrationProblems(main, [...main, "20261111000000_late_branch"])).toEqual([
      "20261111000000_late_branch sorts before 20261112090000_marketing_site, which is already on main: give it a later timestamp.",
    ]);
  });

  it("refuses names that are not Prisma's", () => {
    const bad = [
      "2026111300000_short",
      "20261113000000-dash",
      "20261113000000_Upper",
      "20261340000000_bad_month",
      "20261113246000_bad_hour",
      "add_things",
    ];
    expect(migrationProblems(main, [...main, ...bad])).toHaveLength(bad.length);
  });

  it("refuses removing or renaming one that is on main", () => {
    expect(migrationProblems(main, [main[0], main[2], "20261113000000_utc_timestamps"])).toEqual([
      "20261110090100_utc_timestamps is on main but was removed or renamed: never change a migration production has applied.",
    ]);
  });
});
