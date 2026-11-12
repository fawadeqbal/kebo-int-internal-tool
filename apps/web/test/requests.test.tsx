import { describe, expect, it } from "vitest";
import { requestHref, requestPdfHref, requestPrintHref, requestWords } from "@/lib/requests";

describe("payment requests in words", () => {
  const base = { with: null, sentOn: null, revision: null } as const;

  it("says where a request stands", () => {
    expect(requestWords({ ...base, state: "not_sent" })).toBe("Not sent");
    expect(requestWords({ ...base, state: "part_paid" })).toBe("Part paid");
    expect(requestWords({ ...base, state: "paid" })).toBe("Paid");
    expect(requestWords({ ...base, state: "cancelled" })).toBe("Cancelled");
  });

  it("says how and when it was sent", () => {
    expect(requestWords({ state: "sent", with: "request", sentOn: "2026-11-12", revision: 1 })).toBe("Sent 12 Nov");
    expect(requestWords({ state: "sent", with: "request", sentOn: "2026-11-12", revision: 2 })).toBe("Sent 12 Nov · R2");
    expect(requestWords({ state: "sent", with: "proforma", sentOn: "2026-11-01", revision: null })).toBe("Sent with the proforma");
    expect(requestWords({ state: "sent", with: "bank", sentOn: "2026-11-03", revision: null })).toBe("At the bank since 3 Nov");
  });

  it("a bank route's balance waits for the papers, not for a request", () => {
    expect(requestWords({ ...base, state: "not_sent", through: "bank" })).toBe("Papers not at the bank yet");
    expect(requestWords({ ...base, state: "not_sent", through: "customer" })).toBe("Not sent");
  });

  it("links to the request's page, its print page and its PDF", () => {
    expect(requestHref("o1", "r1")).toBe("/payments/requests/o1/r1");
    expect(requestPrintHref("o1", "r1")).toBe("/print/orders/o1/payment-request?ref=r1");
    expect(requestPrintHref("o1", "r1", { now: true })).toBe("/print/orders/o1/payment-request?ref=r1&now=1");
    expect(requestPrintHref("o1", "r1", { v: 2 })).toBe("/print/orders/o1/payment-request?ref=r1&v=2");
    expect(requestPdfHref("o1", "r1")).toBe("/pdf/payment-request/o1?ref=r1");
  });
});
