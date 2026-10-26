import { describe, expect, it } from "vitest";
import { amountInWords, numberToWords } from "@/lib/utils/words";

describe("amount in words", () => {
  it("spells whole numbers", () => {
    expect(numberToWords(0)).toBe("Zero");
    expect(numberToWords(15)).toBe("Fifteen");
    expect(numberToWords(40)).toBe("Forty");
    expect(numberToWords(101)).toBe("One Hundred One");
    expect(numberToWords(9950)).toBe("Nine Thousand Nine Hundred Fifty");
    expect(numberToWords(1_000_000)).toBe("One Million");
    expect(numberToWords(12_508_000)).toBe("Twelve Million Five Hundred Eight Thousand");
    expect(numberToWords(1_234_567)).toBe("One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven");
  });

  it("adds the currency and the cents", () => {
    expect(amountInWords(995000, "USD")).toBe("US Dollars Nine Thousand Nine Hundred Fifty Only");
    expect(amountInWords(995020, "usd")).toBe("US Dollars Nine Thousand Nine Hundred Fifty and Cents Twenty Only");
    expect(amountInWords(100, "CNY")).toBe("Chinese Yuan One Only");
    expect(amountInWords(250, "XYZ")).toBe("XYZ Two and Cents Fifty Only");
  });
});
