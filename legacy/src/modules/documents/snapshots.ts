import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/lib/db";
import { customers, type CompanySnapshot, type Customer, type CustomerSnapshot } from "@/lib/db/schema";
import type { AppSettings } from "@/modules/settings/service";

/**
 * A sent quotation, an issued invoice and a packing list are records of what
 * was sent: they keep the customer's and our own details as they were then,
 * so editing a customer or the company settings never rewrites an old PDF.
 * Drafts show the live details.
 */
export function customerSnapshot(c: Pick<Customer, "companyName" | "contactPerson" | "phone" | "email" | "address" | "taxNo">): CustomerSnapshot {
  return { companyName: c.companyName, contactPerson: c.contactPerson, phone: c.phone, email: c.email, address: c.address, taxNo: c.taxNo };
}

export async function customerSnapshotFor(tx: DbOrTx, customerId: string): Promise<CustomerSnapshot> {
  const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!c) throw new Error("Customer not found");
  return customerSnapshot(c);
}

export function companySnapshot(s: AppSettings): CompanySnapshot {
  return {
    companyName: s.companyName,
    companyNameLocal: s.companyNameLocal,
    companyEmail2: s.companyEmail2,
    companyAddress: s.companyAddress,
    companyPhone: s.companyPhone,
    companyEmail: s.companyEmail,
    companyWebsite: s.companyWebsite,
    companyTaxNo: s.companyTaxNo,
    bankDetails: s.bankDetails,
    invoiceFooter: s.invoiceFooter,
  };
}

/** The details to print: the frozen ones when the document has them, today's otherwise. */
export function partiesFor<C extends CustomerSnapshot>(
  doc: { customerSnapshot: CustomerSnapshot | null; companySnapshot: CompanySnapshot | null },
  liveCustomer: C,
  settings: AppSettings,
): { customer: C; company: AppSettings } {
  return {
    customer: doc.customerSnapshot ? { ...liveCustomer, ...doc.customerSnapshot } : liveCustomer,
    company: doc.companySnapshot ? { ...settings, ...doc.companySnapshot } : settings,
  };
}
