import { describe, expect, it } from "vitest";
import { addressOf, slugProblem } from "../src";

const base = "rfq.example.com";

describe("addresses", () => {
  it("tells the platform's addresses from companies'", () => {
    expect(addressOf("rfq.example.com", base)).toEqual({ kind: "root" });
    expect(addressOf("www.rfq.example.com", base)).toEqual({ kind: "root" });
    expect(addressOf("admin.rfq.example.com", base)).toEqual({ kind: "admin" });
    expect(addressOf("get.rfq.example.com", base)).toEqual({ kind: "marketing" });
    expect(addressOf("Kebo.RFQ.example.com:443", base)).toEqual({ kind: "company", slug: "kebo" });
    expect(addressOf("a.b.rfq.example.com", base)).toEqual({ kind: "other" });
    expect(addressOf("example.com", base)).toEqual({ kind: "other" });
    expect(addressOf(null, base)).toEqual({ kind: "other" });
  });

  it("keeps the platform's names from companies", () => {
    for (const s of ["admin", "www", "get", "api", "pricing"]) expect(slugProblem(s)).toContain("kept for the platform");
    expect(slugProblem("acme-trading")).toBeNull();
    expect(slugProblem("ab")).not.toBeNull();
    expect(slugProblem("-acme")).not.toBeNull();
    expect(slugProblem("acme--co")).not.toBeNull();
  });
});
