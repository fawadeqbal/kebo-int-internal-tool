import { describe, expect, it } from "vitest";
import { customerSchema, normalizePhone } from "@/modules/customers/schema";
import { createQuerySchema, statusChangeSchema, titleFrom } from "@/modules/queries/schema";
import { normalizeFields, websiteInquirySchema } from "@/modules/inquiries/schema";
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
      category: "Pharmaceutical Machinery",
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

  it("needs only customer, category and requirements for a query", () => {
    const r = createQuerySchema.safeParse({ customerMode: "existing", customerId: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90", category: "Textile Machinery", specifications: "24 air-jet looms" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.quantity).toBe(1);
      expect(r.data.priority).toBe("normal");
    }
  });

  it("makes a short title from the requirements", () => {
    expect(titleFrom("Water bottling line, 6,000 bph\nwith labeller", "Beverage Machinery")).toBe("Water bottling line, 6,000 bph");
    expect(titleFrom("x".repeat(200)).length).toBeLessThanOrEqual(91);
  });
});

describe("website inquiries", () => {
  it("understands the website form's field names", () => {
    const fields = normalizeFields({
      "Full Name": "Chinedu Okafor",
      business_email: "Chinedu@LagosHealth.example",
      "Phone / WhatsApp": "+234 803 555 0142",
      company_name: "",
      sourcing_category: "Medical Devices & Equipment",
      message: "50 ICU beds, CE certified",
      website: "",
    });
    const parsed = websiteInquirySchema.parse(fields);
    expect(parsed.fullName).toBe("Chinedu Okafor");
    expect(parsed.email).toBe("chinedu@lagoshealth.example");
    expect(parsed.company).toBeNull();
    expect(parsed.category).toBe("Medical Devices & Equipment");
    expect(fields.honeypot).toBe("");
  });

  it("rejects an inquiry without contact details", () => {
    expect(websiteInquirySchema.safeParse(normalizeFields({ name: "A", requirements: "hello there" })).success).toBe(false);
  });
});
