import { describe, expect, it } from "vitest";
import { amount, decimals, MAX_AMOUNT, optionalAmount, optionalRate, quantity } from "../src";

/** Amounts, quantities and rates: the number of decimals is checked exactly, whatever the size. */
describe("decimal places", () => {
  it("accepts large amounts with 2 decimals and refuses 3", () => {
    const ok = (v: unknown) => amount().safeParse(v).success;
    expect(ok(154002876.02)).toBe(true); // refused before: 15400287602.000002 in floating point
    expect(ok("154002876.02")).toBe(true);
    expect(ok(MAX_AMOUNT)).toBe(true);
    expect(ok("9999999999.99")).toBe(true);
    expect(ok(9_999_999_999.98)).toBe(true);
    expect(ok(0.01)).toBe(true);
    expect(ok(0.1 + 0.2)).toBe(false); // 0.30000000000000004 is not what anyone typed
    expect(ok("154002876.025")).toBe(false);
    expect(ok("9999999999.999")).toBe(false);
    expect(ok(0.001)).toBe(false);
    expect(ok("10000000000.00")).toBe(false); // over the maximum
    expect(optionalAmount.safeParse("8888888888.88").success).toBe(true);
    expect(optionalAmount.safeParse("8888888888.888").success).toBe(false);
    expect(quantity.safeParse("1234567.89").success).toBe(true);
    expect(quantity.safeParse("1.234").success).toBe(false);
  });

  it("keeps 6 places for rates", () => {
    const ok = (v: unknown) => optionalRate.safeParse(v).success;
    expect(ok(0.003571)).toBe(true);
    expect(ok("280.123456")).toBe(true);
    expect(ok(999999.999999)).toBe(true);
    expect(ok("0.0035714")).toBe(false);
    expect(ok(1e-7)).toBe(false); // written 1e-7: 7 decimals
  });

  it("reads exponent forms by their real decimals", () => {
    expect(decimals(2)(1.5e3)).toBe(true);
    expect(decimals(2)(1.25e-1)).toBe(false); // 0.125
    expect(decimals(6)(1e-6)).toBe(true);
    expect(decimals(2)(Number.NaN)).toBe(false);
    expect(decimals(2)(Infinity)).toBe(false);
  });
});
