import { describe, expect, it } from "vitest";
import { HS_CODE, hsFor, hsMismatch, zhCountry, zhPlace, zhTerm, zhUnit } from "../src";

// Papers in Chinese (25 Nov 2026): the words that have one Chinese, and an item's two HS codes.
describe("words with one Chinese", () => {
  it("units, packing, countries and places part by part", () => {
    expect(zhUnit("Sets")).toBe("套");
    expect(zhUnit("pcs.")).toBe("件");
    expect(zhUnit("bundle of joy")).toBeNull();
    expect(zhTerm("Wooden case")).toBe("木箱");
    expect(zhCountry("PK")).toBe("巴基斯坦");
    expect(zhCountry("Pakistan")).toBe("巴基斯坦");
    expect(zhPlace("Qingdao, China")).toBe("青岛，中国");
    expect(zhPlace("Karachi Port, Pakistan")).toBe("卡拉奇港，巴基斯坦");
    expect(zhPlace("Port Qasim")).toBe("卡西姆港");
    // Unless every part is known, nothing: it prints in English only.
    expect(zhPlace("Warehouse 7, Karachi")).toBeNull();
    expect(zhPlace("")).toBeNull();
  });
});

describe("an item's two HS codes", () => {
  it("digits only; the first six digits are the same in every country", () => {
    expect(HS_CODE.test("8422.40")).toBe(true);
    expect(HS_CODE.test("8481 80 90")).toBe(true);
    expect(HS_CODE.test("eight")).toBe(false);
    expect(hsMismatch("8422.30", "8422.4000")).toBe(true);
    expect(hsMismatch("8422.30.10", "8422.30.90")).toBe(false);
    // One of them missing or too short: nothing to compare.
    expect(hsMismatch("8422", "8481.80")).toBe(false);
    expect(hsMismatch(null, "8481.80")).toBe(false);
  });

  it("the China customs copy prints China's, else the customer's; the other copies the customer's", () => {
    expect(hsFor("customs", "8422.30", "8422.3090")).toBe("8422.3090");
    expect(hsFor("customs", "8422.30", null)).toBe("8422.30");
    expect(hsFor("customer", "8422.30", "8422.3090")).toBe("8422.30");
    expect(hsFor("customer", null, "8422.3090")).toBeNull();
  });
});
