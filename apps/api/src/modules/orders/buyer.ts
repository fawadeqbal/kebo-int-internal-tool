import type { Prisma } from "@kebo/database";
import type { BuyerSnapshot } from "@kebo/shared";
import type { ISODate } from "@kebo/utils";
import type { PrismaService, Tx } from "../../database/prisma.service";

type Db = Tx | PrismaService["db"];

/** The customer as it is now, with the deal's contact (else the primary one). */
export async function customerSnapshot(tx: Db, customerId: string, contactId: string | null) {
  const c = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { contacts: { where: { deletedAt: null }, orderBy: { isPrimary: "desc" } } },
  });
  const contact = c.contacts.find((x) => x.id === contactId) ?? c.contacts[0] ?? null;
  return {
    name: c.name,
    country: c.country,
    address: c.address,
    taxNo: c.taxNo,
    regNo: c.regNo,
    contact: contact && { name: contact.name, email: contact.email, phone: contact.phone ?? contact.whatsapp },
  };
}

type CustomerNow = Awaited<ReturnType<typeof customerSnapshot>>;

/**
 * The buyer as the order's papers print it (owner decision, 3 Nov 2026: frozen at the order).
 *  - When the order is made: the quotation's customer (frozen when it was sent), with the details missing
 *    there (empty) from the customer as it is then — the rule the papers used to apply every time they were
 *    printed, applied once.
 *  - "Refresh from customer": the customer as it is now, with a reason in the history.
 */
export function buyerFrom(now: CustomerNow, sent: Prisma.JsonValue | null, from: BuyerSnapshot["from"], takenOn: ISODate): BuyerSnapshot {
  const filled =
    sent && typeof sent === "object" && !Array.isArray(sent)
      ? Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== null && v !== undefined && v !== ""))
      : {};
  const b = { ...now, ...filled } as CustomerNow;
  return {
    name: b.name,
    country: b.country ?? null,
    address: b.address ?? null,
    taxNo: b.taxNo ?? null,
    regNo: b.regNo ?? null,
    contact: b.contact
      ? { name: b.contact.name ?? null, email: b.contact.email ?? null, phone: b.contact.phone ?? null }
      : null,
    takenOn,
    from,
  };
}

/** The buyer of an order made now from its accepted revision. */
export async function buyerAtOrder(db: Db, o: { customerId: string; contactId: string | null; sent: Prisma.JsonValue | null }, today: ISODate) {
  return buyerFrom(await customerSnapshot(db, o.customerId, o.contactId), o.sent, "order", today);
}

/** The buyer taken again from the customer as it is now. */
export async function buyerNow(db: Db, customerId: string, contactId: string | null, today: ISODate) {
  return buyerFrom(await customerSnapshot(db, customerId, contactId), null, "customer", today);
}

/** The order's buyer as stored (every order has one; one made outside the API without it: as the papers used to merge it). */
export async function buyerOf(
  db: Db,
  o: { buyerSnapshot: Prisma.JsonValue | null; customerId: string; inquiry: { contactId: string | null }; revision: { customerSnapshot: Prisma.JsonValue | null } },
  today: ISODate,
): Promise<BuyerSnapshot> {
  const s = o.buyerSnapshot as BuyerSnapshot | null;
  if (s && typeof s === "object" && typeof s.name === "string" && s.name) return s;
  return buyerFrom(await customerSnapshot(db, o.customerId, o.inquiry.contactId), o.revision.customerSnapshot, "data", today);
}

/** The buyer's printed details (the party on a paper). */
export const partyOf = (b: BuyerSnapshot) => ({ name: b.name, country: b.country, address: b.address, taxNo: b.taxNo, regNo: b.regNo });
