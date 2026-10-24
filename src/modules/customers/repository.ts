import { and, asc, count, desc, eq, ilike, isNull, max, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { customers, invoices, queries } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Staff see only customers they added, or that are on an inquiry they work on
 * (assigned to or created by them). Managers and the Super Admin see all.
 * Outer column written in full (single-table count queries render a bare "id").
 */
export function customerAccessCondition(user: SessionUser): SQL | undefined {
  if (can(user.role, "queries.viewAll")) return undefined;
  return or(
    eq(customers.createdBy, user.id),
    sql`exists (select 1 from ${queries} q where q.customer_id = "customers"."id" and q.deleted_at is null and (q.assigned_to = ${user.id} or q.created_by = ${user.id}))`,
  );
}

/** Company name, or the contact person's name when there is no company. */
export const customerDisplayName = sql<string>`coalesce(${customers.companyName}, ${customers.contactPerson})`;

export interface CustomerListFilters {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: "company" | "recent";
  /** open = has an open inquiry · unpaid = owes money · none = never sent an inquiry */
  has?: "open" | "unpaid" | "none";
}

/** Outer column written in full: the count query selects from one table, where Drizzle would render a bare "id". */
function hasCondition(has: CustomerListFilters["has"]): SQL | undefined {
  if (has === "open")
    return sql`exists (select 1 from ${queries} q where q.customer_id = "customers"."id" and q.deleted_at is null and q.status in ('pending','processing'))`;
  if (has === "unpaid") return sql`exists (select 1 from ${invoices} i where i.customer_id = "customers"."id" and i.status in ('unpaid','partially_paid'))`;
  if (has === "none") return sql`not exists (select 1 from ${queries} q where q.customer_id = "customers"."id" and q.deleted_at is null)`;
  return undefined;
}

function searchCondition(q?: string): SQL | undefined {
  if (!q) return undefined;
  const term = `%${q.trim()}%`;
  const digits = q.replace(/\D/g, "");
  return or(
    ilike(customers.companyName, term),
    ilike(customers.contactPerson, term),
    ilike(customers.email, term),
    digits.length >= 3 ? sql`regexp_replace(${customers.phone}, '\\D', '', 'g') like ${"%" + digits + "%"}` : undefined,
  );
}

export async function listCustomers(user: SessionUser, { q, page = 1, pageSize = 25, sort = "company", has }: CustomerListFilters) {
  const where = and(isNull(customers.deletedAt), customerAccessCondition(user), searchCondition(q), hasCondition(has));
  const stats = db
    .select({
      customerId: queries.customerId,
      queryCount: count(queries.id).as("query_count"),
      lastQueryAt: max(queries.createdAt).as("last_query_at"),
    })
    .from(queries)
    .where(isNull(queries.deletedAt))
    .groupBy(queries.customerId)
    .as("stats");

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: customers.id,
        companyName: customers.companyName,
        contactPerson: customers.contactPerson,
        phone: customers.phone,
        email: customers.email,
        queryCount: sql<number>`coalesce(${stats.queryCount}, 0)`.mapWith(Number),
        lastQueryAt: stats.lastQueryAt,
      })
      .from(customers)
      .leftJoin(stats, eq(stats.customerId, customers.id))
      .where(where)
      .orderBy(sort === "recent" ? sql`${stats.lastQueryAt} desc nulls last` : asc(sql`lower(${customers.contactPerson})`))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(customers).where(where),
  ]);
  return { rows, total, page, pageSize };
}

export async function searchCustomers(user: SessionUser, q: string, limit = 8) {
  return db
    .select({
      id: customers.id,
      companyName: customers.companyName,
      contactPerson: customers.contactPerson,
      phone: customers.phone,
      email: customers.email,
    })
    .from(customers)
    .where(and(isNull(customers.deletedAt), customerAccessCondition(user), searchCondition(q)))
    .orderBy(asc(sql`lower(coalesce(${customers.companyName}, ${customers.contactPerson}))`))
    .limit(limit);
}

export async function findCustomer(id: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** A customer this person may open (see customerAccessCondition). */
export async function findCustomerFor(user: SessionUser, id: string) {
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), isNull(customers.deletedAt), customerAccessCondition(user)))
    .limit(1);
  return row ?? null;
}

/** Possible duplicates by phone (digits only) or email. */
export async function findDuplicates(phoneDigits: string, email: string | null | undefined, exceptId?: string) {
  const conditions = [sql`regexp_replace(regexp_replace(${customers.phone}, '\\D', '', 'g'), '^92', '0') = ${phoneDigits}`];
  if (email) conditions.push(eq(customers.email, email));
  return db
    .select({ id: customers.id, companyName: customers.companyName, contactPerson: customers.contactPerson, phone: customers.phone })
    .from(customers)
    .where(and(isNull(customers.deletedAt), or(...conditions), exceptId ? sql`${customers.id} <> ${exceptId}` : undefined))
    .limit(3);
}

export async function customerQueryCount(id: string) {
  const [row] = await db
    .select({ n: count() })
    .from(queries)
    .where(and(eq(queries.customerId, id), isNull(queries.deletedAt)));
  return row?.n ?? 0;
}

export async function customerFinancials(id: string) {
  const [row] = await db
    .select({
      invoiced: sql<string>`coalesce(sum(${invoices.total}) filter (where ${invoices.status} <> 'cancelled'), 0)`,
      paid: sql<string>`coalesce(sum(${invoices.amountPaid}) filter (where ${invoices.status} <> 'cancelled'), 0)`,
    })
    .from(invoices)
    .where(eq(invoices.customerId, id));
  return row ?? { invoiced: "0", paid: "0" };
}

export const recentCustomersOrder = desc(customers.createdAt);
