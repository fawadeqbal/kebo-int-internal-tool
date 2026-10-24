import { eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { customers } from "@/lib/db/schema";
import { assertCan, type SessionUser } from "@/lib/auth/session";
import { DomainError, NotFoundError } from "@/lib/utils/result";
import { diff, recordAudit } from "@/modules/audit/service";
import { customerQueryCount, findCustomerFor, findDuplicates } from "./repository";
import { normalizePhone, type CustomerInput } from "./schema";

export class DuplicateCustomerError extends DomainError {
  constructor(public readonly matches: { id: string; companyName: string | null; contactPerson: string; phone: string }[]) {
    super("A customer with the same phone number or email already exists.");
  }
}

function toRow(input: CustomerInput) {
  return {
    companyName: input.companyName ?? null,
    contactPerson: input.contactPerson,
    phone: input.phone,
    email: input.email ?? null,
    address: input.address ?? null,
    taxNo: input.taxNo ?? null,
    notes: input.notes ?? null,
  };
}

/** Creates a customer. Can run inside a larger transaction (e.g. new query + new customer). */
export async function createCustomer(actor: SessionUser, input: CustomerInput, tx?: DbOrTx) {
  assertCan(actor, "customers.manage");
  if (!input.allowDuplicate) {
    const matches = await findDuplicates(normalizePhone(input.phone), input.email);
    if (matches.length) throw new DuplicateCustomerError(matches);
  }
  const run = async (t: DbOrTx) => {
    const [created] = await t
      .insert(customers)
      .values({ ...toRow(input), createdBy: actor.id })
      .returning({ id: customers.id });
    await recordAudit(t, {
      userId: actor.id,
      action: "create",
      entityType: "customer",
      entityId: created.id,
      summary: `Added customer ${input.companyName || input.contactPerson}`,
      newValues: toRow(input),
    });
    return created;
  };
  return tx ? run(tx) : db.transaction(run);
}

export async function updateCustomer(actor: SessionUser, id: string, input: CustomerInput) {
  assertCan(actor, "customers.manage");
  const existing = await findCustomerFor(actor, id);
  if (!existing) throw new NotFoundError("Customer");
  if (!input.allowDuplicate) {
    const matches = await findDuplicates(normalizePhone(input.phone), input.email, id);
    if (matches.length) throw new DuplicateCustomerError(matches);
  }
  const row = toRow(input);
  const changes = diff(existing, row);
  await db.transaction(async (tx) => {
    await tx.update(customers).set(row).where(eq(customers.id, id));
    if (changes.changed)
      await recordAudit(tx, { userId: actor.id, action: "update", entityType: "customer", entityId: id, summary: `Updated customer ${input.companyName || input.contactPerson}`, ...changes });
  });
}

export async function deleteCustomer(actor: SessionUser, id: string) {
  assertCan(actor, "customers.delete");
  const existing = await findCustomerFor(actor, id);
  if (!existing) throw new NotFoundError("Customer");
  if ((await customerQueryCount(id)) > 0)
    throw new DomainError("This customer has inquiries, so it cannot be removed. Their history must be kept.");
  await db.transaction(async (tx) => {
    await tx.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, id));
    await recordAudit(tx, { userId: actor.id, action: "delete", entityType: "customer", entityId: id, summary: `Removed customer ${existing.companyName || existing.contactPerson}` });
  });
}
