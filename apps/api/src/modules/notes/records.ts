import { can, type NoteTarget } from "@kebo/shared";
import { isCustomer, isSupplier } from "@kebo/database";
import { ForbiddenError, NotFoundError } from "@kebo/utils";
import type { PrismaService } from "../../database/prisma.service";
import type { SessionUser } from "../../common/auth/session-user";
import { inquiryAccess } from "../inquiries/inquiries.service";
import { orderAccess } from "../orders/orders.service";
import { customerAccess } from "../parties/customers.service";

/** A record notes and follow-ups are on: an inquiry, an order, a customer or a factory. */
export type RecordType = NoteTarget;

/** The record as notes and follow-ups show it: "SO-2026-0447 · Lahore Pharma", and where it opens. */
export interface RecordRef {
  type: RecordType;
  id: string;
  label: string;
  /** Its page in the web app (the phone maps the same paths). */
  link: string;
  /** The customer whose contacts a note can name (none for a factory). */
  customerId: string | null;
}

export const recordLink = (type: RecordType, id: string) =>
  ({ inquiry: `/inquiries/${id}`, order: `/orders/${id}`, customer: `/customers/${id}`, factory: `/factories/${id}` })[type];

const NAMES: Record<RecordType, string> = { inquiry: "Inquiry", order: "Order", customer: "Customer", factory: "Factory" };

type Db = PrismaService["db"];

/**
 * The record when this person may see it, with its label; otherwise 404 (as every page of a record they
 * do not see answers), or 403 for factories without sourcing.manage (as GET /factories/:id answers).
 */
export async function seeRecord(db: Db, user: SessionUser, type: RecordType, id: string): Promise<RecordRef> {
  const ref = (label: string, customerId: string | null): RecordRef => ({ type, id, label, link: recordLink(type, id), customerId });
  if (type === "inquiry") {
    const i = await db.inquiry.findFirst({
      where: { id, deletedAt: null, ...inquiryAccess(user) },
      select: { refNo: true, customerId: true, customer: { select: { name: true } } },
    });
    if (!i) throw new NotFoundError(NAMES[type]);
    return ref(`${i.refNo} · ${i.customer.name}`, i.customerId);
  }
  if (type === "order") {
    const o = await db.order.findFirst({
      where: { id, ...orderAccess(user) },
      select: { refNo: true, customerId: true, customer: { select: { name: true } } },
    });
    if (!o) throw new NotFoundError(NAMES[type]);
    return ref(`${o.refNo} · ${o.customer.name}`, o.customerId);
  }
  if (type === "customer") {
    const c = await db.party.findFirst({ where: { ...isCustomer, id, deletedAt: null, ...customerAccess(user) }, select: { name: true } });
    if (!c) throw new NotFoundError(NAMES[type]);
    return ref(c.name, id);
  }
  if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factories.");
  const f = await db.party.findFirst({ where: { ...isSupplier, id, deletedAt: null }, select: { name: true } });
  if (!f) throw new NotFoundError(NAMES[type]);
  return ref(f.name, null);
}

/** Whether a person who sees the record may add notes to it: who may change it. */
export function canAddTo(user: SessionUser, type: RecordType): boolean {
  if (type === "order") return can(user, "orders.update");
  if (type === "customer") return can(user, "customers.manage");
  if (type === "factory") return can(user, "sourcing.manage");
  return true;
}

/**
 * Whether a person may remove anyone's note on the record: the managers of that kind of record (the
 * permission that already removes or overrides it: cancelling orders, deleting customers, removing
 * factories, changing anyone's inquiries).
 */
export function managesNotesOf(user: SessionUser, type: RecordType): boolean {
  if (type === "order") return can(user, "orders.manage");
  if (type === "customer") return can(user, "customers.delete");
  if (type === "factory") return can(user, "sourcing.manage") && can(user, "inquiries.updateAny");
  return can(user, "inquiries.updateAny");
}

/** Labels for many records at once (a list's rows), whoever looks: the rows were already checked. */
export async function recordLabels(db: Db, refs: { type: RecordType; id: string }[]): Promise<Map<string, RecordRef>> {
  const ids = (t: RecordType) => [...new Set(refs.filter((r) => r.type === t).map((r) => r.id))];
  const out = new Map<string, RecordRef>();
  const put = (type: RecordType, id: string, label: string, customerId: string | null) =>
    out.set(`${type}:${id}`, { type, id, label, link: recordLink(type, id), customerId });
  const [inquiries, orders, customers, factories] = await Promise.all([
    ids("inquiry").length
      ? db.inquiry.findMany({
          where: { id: { in: ids("inquiry") } },
          select: { id: true, refNo: true, customerId: true, customer: { select: { name: true } } },
        })
      : [],
    ids("order").length
      ? db.order.findMany({
          where: { id: { in: ids("order") } },
          select: { id: true, refNo: true, customerId: true, customer: { select: { name: true } } },
        })
      : [],
    ids("customer").length ? db.party.findMany({ where: { ...isCustomer, id: { in: ids("customer") } }, select: { id: true, name: true } }) : [],
    ids("factory").length ? db.party.findMany({ where: { ...isSupplier, id: { in: ids("factory") } }, select: { id: true, name: true } }) : [],
  ]);
  for (const i of inquiries) put("inquiry", i.id, `${i.refNo} · ${i.customer.name}`, i.customerId);
  for (const o of orders) put("order", o.id, `${o.refNo} · ${o.customer.name}`, o.customerId);
  for (const c of customers) put("customer", c.id, c.name, c.id);
  for (const f of factories) put("factory", f.id, f.name, null);
  return out;
}
