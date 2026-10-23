import { describe, expect, it } from "vitest";
import { customerSchema, normalizePhone } from "@/modules/customers/schema";
import { createQuerySchema, statusChangeSchema } from "@/modules/queries/schema";
import { quotationSchema } from "@/modules/quotations/schema";
import { toCsv } from "@/lib/utils/csv";

describe("validation", () => {
  it("requires company, contact person and phone for a customer", () => {
    const r = customerSchema.safeParse({ companyName: "", contactPerson: "", phone: "abc" });
    expect(r.success).toBe(false);
    const ok = customerSchema.parse({ companyName: "Medipak", contactPerson: "Imran", phone: "0300 1234567", email: "" });
    expect(ok.email).toBeNull();
  });

  it("matches phone numbers regardless of formatting", () => {
    expect(normalizePhone("0300-123 4567")).toBe(normalizePhone("+92 300 1234567"));
  });

  it("accepts a query with a new customer in the same form", () => {
    const r = createQuerySchema.safeParse({
      customerMode: "new",
      companyName: "Al-Shifa",
      contactPerson: "Zubair",
      phone: "0333 4567890",
      email: "",
      source: "phone",
      title: "Capsule filler",
      specifications: "30,000 capsules/hour",
      quantity: "2",
      priority: "high",
      requiredBy: "",
      assignedTo: "",
    });
    expect(r.success).toBe(true);
  });

  it("requires a reason when closing a query as not completed", () => {
    expect(statusChangeSchema.safeParse({ status: "not_completed", reason: "" }).success).toBe(false);
    expect(statusChangeSchema.safeParse({ status: "completed", reason: "" }).success).toBe(true);
  });

  it("requires at least one priced line on a quotation", () => {
    expect(quotationSchema.safeParse({ items: "[]", taxRate: "18", dueDate: "2026-11-01" }).success).toBe(false);
    expect(
      quotationSchema.safeParse({ items: JSON.stringify([{ description: "Machine", quantity: 1, unitPrice: 100 }]), taxRate: "18", dueDate: "2026-11-01" }).success,
    ).toBe(true);
  });

  it("protects CSV exports against spreadsheet formula injection", () => {
    expect(toCsv(["a"], [["=HYPERLINK(1)"]])).toContain(`"'=HYPERLINK(1)"`);
  });
});
