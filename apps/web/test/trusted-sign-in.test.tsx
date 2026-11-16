import { describe, expect, it } from "vitest";
import { COLOUR_SETS } from "@kebo/shared";
import { savedColours } from "@/lib/colours";
import { initialsOf } from "@/lib/initials";

describe("sign-in in the company's colours", () => {
  it("takes the set remembered on this device", () => {
    for (const set of COLOUR_SETS) expect(savedColours(set)).toBe(set);
  });
  it("is Green with nothing remembered or a value that is not a set", () => {
    expect(savedColours(undefined)).toBe("green");
    expect(savedColours("")).toBe("green");
    expect(savedColours("purple")).toBe("green");
    expect(savedColours('graphite"><script>')).toBe("green");
  });
});

describe("the company's initials on the sign-in card", () => {
  it("is the first letters of the first two words, or the first two letters of one", () => {
    expect(initialsOf("Kebo International")).toBe("KI");
    expect(initialsOf("  acme  ")).toBe("AC");
    expect(initialsOf("RFQ Desk")).toBe("RD");
    expect(initialsOf("")).toBe("K");
  });
});
