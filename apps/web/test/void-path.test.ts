import { describe, expect, it } from "vitest";
import { isVoidPath } from "@/lib/void-path";

const id = "3f2b6a1e-9c4d-4e8f-a1b2-c3d4e5f60718";

/** Remove this payment: the web takes only the addresses the API gives out (lib/void-path.ts). */
describe("the addresses that remove a payment", () => {
  it("takes every one the API names (treasury's voidPath), supplier payments' new address included", () => {
    for (const base of ["/payments", "/customer-credits", "/supplier-payments", "/expenses", "/money/transfers"])
      expect(isVoidPath(`${base}/${id}/void`), base).toBe(true);
  });

  it("still takes supplier payments' old address, from a page opened before the change", () => {
    expect(isVoidPath(`/factory-payments/${id}/void`)).toBe(true);
  });

  it("takes nothing else", () => {
    for (const p of [
      `/suppliers/${id}/void`,
      `/supplier-payments/${id}`,
      `/supplier-payments/x/void`,
      `/../payments/${id}/void`,
      `https://x/payments/${id}/void`,
    ])
      expect(isVoidPath(p), p).toBe(false);
  });
});
