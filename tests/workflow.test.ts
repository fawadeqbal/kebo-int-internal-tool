import { describe, expect, it } from "vitest";
import { canTransition, isReopen, timeInStatus, turnaroundMs } from "@/modules/queries/workflow";
import { canMoveQuotation, isEditable } from "@/modules/quotations/workflow";
import { invoiceDisplayStatus, paymentStatus } from "@/modules/invoices/status";

describe("query status lifecycle", () => {
  it("allows the normal path and blocks skipping steps", () => {
    expect(canTransition("pending", "processing")).toBe(true);
    expect(canTransition("processing", "completed")).toBe(true);
    expect(canTransition("pending", "completed")).toBe(false);
    expect(canTransition("on_hold", "completed")).toBe(false);
  });

  it("treats moving out of a closed status as a reopen", () => {
    expect(isReopen("completed", "processing")).toBe(true);
    expect(isReopen("pending", "processing")).toBe(false);
  });

  it("adds up time spent in each status", () => {
    const t0 = new Date("2026-10-01T09:00:00Z");
    const h = (n: number) => new Date(t0.getTime() + n * 3600000);
    const totals = timeInStatus(
      [
        { toStatus: "pending", changedAt: t0 },
        { toStatus: "processing", changedAt: h(5) },
        { toStatus: "on_hold", changedAt: h(10) },
        { toStatus: "processing", changedAt: h(12) },
        { toStatus: "completed", changedAt: h(20) },
      ],
      h(30),
    );
    expect(totals.pending).toBe(5 * 3600000);
    expect(totals.processing).toBe(13 * 3600000);
    expect(totals.on_hold).toBe(2 * 3600000);
    expect(turnaroundMs(t0, h(20))).toBe(20 * 3600000);
  });
});

describe("quotations", () => {
  it("only drafts are editable; accepted is final", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("sent")).toBe(false);
    expect(canMoveQuotation("draft", "accepted")).toBe(false);
    expect(canMoveQuotation("sent", "accepted")).toBe(true);
    expect(canMoveQuotation("accepted", "rejected")).toBe(false);
  });
});

describe("invoices", () => {
  it("derives payment status from the amount paid", () => {
    expect(paymentStatus("100.00", "0")).toBe("unpaid");
    expect(paymentStatus("100.00", "40.00")).toBe("partially_paid");
    expect(paymentStatus("100.00", "100.00")).toBe("paid");
  });

  it("shows overdue only for open invoices past their due date", () => {
    expect(invoiceDisplayStatus({ status: "unpaid", dueDate: "2026-10-01" }, "2026-10-23")).toBe("overdue");
    expect(invoiceDisplayStatus({ status: "paid", dueDate: "2026-10-01" }, "2026-10-23")).toBe("paid");
    expect(invoiceDisplayStatus({ status: "unpaid", dueDate: "2026-10-23" }, "2026-10-23")).toBe("unpaid");
  });
});
