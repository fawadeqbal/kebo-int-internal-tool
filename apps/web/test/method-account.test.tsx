import { describe, expect, it } from "vitest";
import { methodAccountClash } from "@/components/money/accounts";

describe("a payment's method and its account", () => {
  it("questions a bank transfer into a cash account, and cash into a bank account", () => {
    expect(methodAccountClash("bank_transfer", { name: "Cash", kind: "cash" })).toBe("Bank transfer (T/T) into Cash, a cash account: is that the right account?");
    expect(methodAccountClash("cash", { name: "HBL USD", kind: "bank" })).toContain("a bank account");
  });

  it("says nothing when they go together, or when either is not chosen", () => {
    expect(methodAccountClash("bank_transfer", { name: "HBL USD", kind: "bank" })).toBeNull();
    expect(methodAccountClash("cash", { name: "Cash", kind: "cash" })).toBeNull();
    expect(methodAccountClash("other", { name: "Cash", kind: "cash" })).toBeNull();
    expect(methodAccountClash(null, { name: "Cash", kind: "cash" })).toBeNull();
    expect(methodAccountClash("cash", undefined)).toBeNull();
  });
});
