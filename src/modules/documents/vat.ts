import { eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { getSettings } from "@/modules/settings/service";

export interface Vat {
  /** VAT % on this customer's documents (0 when they are VAT exempt). */
  rate: number;
  /** Our prices already include it. */
  included: boolean;
  exempt: boolean;
}

/** The one VAT, as it applies to a customer: the super admin's setting, or none for a VAT-exempt customer. */
export async function vatForCustomer(customerId: string, tx: DbOrTx = db): Promise<Vat> {
  const settings = await getSettings();
  const [c] = await tx.select({ vatExempt: customers.vatExempt }).from(customers).where(eq(customers.id, customerId)).limit(1);
  const exempt = c?.vatExempt ?? false;
  return { rate: exempt ? 0 : settings.vatRate, included: settings.pricesIncludeVat, exempt };
}
