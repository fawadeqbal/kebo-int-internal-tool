import { describe, expect, it } from "vitest";
import { addDays, amountInWords, daysBetween, formatReference, isISODate, parseReference, todayIn, ForbiddenError, DomainError } from "../src";

describe("dates", () => {
  it("gives today in the business time zone", () => {
    const lateUtc = new Date("2026-10-26T20:30:00Z"); // already the 27th in Shanghai
    expect(todayIn("Asia/Shanghai", lateUtc)).toBe("2026-10-27");
    expect(todayIn("UTC", lateUtc)).toBe("2026-10-26");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", "2026-10-26")).toBe(25);
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
