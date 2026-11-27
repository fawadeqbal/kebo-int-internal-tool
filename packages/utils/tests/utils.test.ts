import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  amountInWords,
  daysBetween,
  lastMonths,
  monthEnd,
  monthOf,
  monthStart,
  startOfDayIn,
  formatReference,
  isISODate,
  parseReference,
  todayIn,
  ForbiddenError,
  DomainError,
} from "../src";

describe("dates", () => {
  it("gives today in the business time zone", () => {
    const lateUtc = new Date("2026-10-26T20:30:00Z"); // already the 27th in Shanghai
    expect(todayIn("Asia/Shanghai", lateUtc)).toBe("2026-10-27");
    expect(todayIn("UTC", lateUtc)).toBe("2026-10-26");
  });
  it("finds when a day starts in a time zone", () => {
    expect(startOfDayIn("2026-11-01", "Asia/Shanghai").toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(startOfDayIn("2026-11-01", "UTC").toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(startOfDayIn("2026-03-29", "Europe/London").toISOString()).toBe("2026-03-29T00:00:00.000Z"); // clocks go forward at 01:00
    expect(startOfDayIn("2026-07-01", "Europe/London").toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(startOfDayIn("2026-01-01", "America/New_York").toISOString()).toBe("2026-01-01T05:00:00.000Z");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", "2026-10-26")).toBe(25);
  });
  it("adds months, staying inside the month it lands in", () => {
    expect(addMonths("2026-11-04", 12)).toBe("2027-11-04");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29"); // a leap year
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-05-15", 0)).toBe("2026-05-15");
  });
  it("finds the first and the last day of a month, this one or some months away", () => {
    expect(monthStart("2026-11-27")).toBe("2026-11-01");
    expect(monthStart("2026-11-27", 2)).toBe("2027-01-01");
    expect(monthStart("2026-01-31", -1)).toBe("2025-12-01");
    expect(monthStart("2026-01-31", 1)).toBe("2026-02-01"); // February, not March: the 31st is not carried over
    expect(monthStart("2026-11", -11)).toBe("2025-12-01"); // a month is read as any day in it
    expect(monthEnd("2026-11-03")).toBe("2026-11-30");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29"); // a leap year
    expect(monthEnd("2100-02-01")).toBe("2100-02-28"); // a century year that is not one
    expect(monthEnd("2026-12-31")).toBe("2026-12-31");
  });
  it("names a month, and lists the months up to one", () => {
    expect(monthOf("2026-11-27")).toBe("2026-11");
    expect(monthOf("2026-01-31", -1)).toBe("2025-12");
    expect(monthOf("2026-12", 1)).toBe("2027-01");
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
    expect(lastMonths("2026-03-31", 3)).toEqual(["2026-01", "2026-02", "2026-03"]); // the 31st does not skip February
    expect(lastMonths("2026-01", 1)).toEqual(["2026-01"]);
  });
  it("validates dates", () => {
    expect(isISODate("2026-02-28")).toBe(true);
    expect(isISODate("2026-02-30")).toBe(false);
    expect(isISODate("26-10-2026")).toBe(false);
  });
});

describe("references", () => {
  it("formats and parses document numbers", () => {
    expect(formatReference("order", 2026, 7)).toBe("SO-2026-0007");
    expect(parseReference("RFQ-2026-0123")).toEqual({ prefix: "RFQ", year: 2026, sequence: 123 });
    expect(parseReference("nope")).toBeNull();
  });
});

describe("words", () => {
  it("writes amounts the way export documents print them", () => {
    expect(amountInWords(995_020, "usd")).toBe("US Dollars Nine Thousand Nine Hundred Fifty and Cents Twenty Only");
    expect(amountInWords(100, "XYZ")).toBe("XYZ One Only");
  });
});

describe("errors", () => {
  it("keeps the class chain for instanceof checks", () => {
    const e = new ForbiddenError();
    expect(e).toBeInstanceOf(DomainError);
    expect(e.message).toMatch(/permission/);
  });
});
