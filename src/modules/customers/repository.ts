import { and, asc, count, desc, eq, getTableColumns, ilike, isNull, max, or, sql, type SQL } from "drizzle-orm";
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
  /** active / inactive: see customerActive */
  status?: "active" | "inactive";
}

/** A customer counts as active for this long after their latest inquiry. */
export const ACTIVE_MONTHS = 12;

/**
 * Active customer: sent an inquiry in the last ACTIVE_MONTHS months, or still
 * has an inquiry open, or still owes money on an invoice. Everyone else
 * (including customers who never sent an inquiry) is not active.
 * Outer column written in full, as in hasCondition.
 */
export const customerActive = sql<boolean>`(
  exists (select 1 from ${queries} q where q.customer_id = "customers"."id" and q.deleted_at is null
           and (q.status in ('pending','processing') or q.created_at >= now() - make_interval(months => ${ACTIVE_MONTHS})))
  or exists (select 1 from ${invoices} i where i.customer_id = "customers"."id" and i.status in ('unpaid','partially_paid'))
)`;

function statusCondition(status: CustomerListFilters["status"]): SQL | undefined {
  if (status === "active") return customerActive;
  if (status === "inactive") return sql`not ${customerActive}`;
  return undefined;
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

export async function listCustomers(user: SessionUser, { q, page = 1, pageSize = 25, sort = "company", has, status }: CustomerListFilters) {
  const where = and(isNull(customers.deletedAt), customerAccessCondition(user), searchCondition(q), hasCondition(has), statusCondition(status));
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
        active: sql<boolean>`${customerActive}`.mapWith(Boolean),
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

/** How many customers (with the same search and Show filter) are active and not active: the counts on the Status tabs. */
export async function countCustomersByStatus(user: SessionUser, { q, has }: Pick<CustomerListFilters, "q" | "has">) {
  const [row] = await db
    .select({
      all: count(),
      active: sql<number>`count(*) filter (where ${customerActive})`.mapWith(Number),
    })
    .from(customers)
    .where(and(isNull(customers.deletedAt), customerAccessCondition(user), searchCondition(q), hasCondition(has)));
  const all = Number(row?.all ?? 0);
  const active = Number(row?.active ?? 0);
  return { all, active, inactive: all - active };
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

/** A customer this person may open (see customerAccessCondition), with whether they are active. */
export async function findCustomerFor(user: SessionUser, id: string) {
  const [row] = await db
    .select({ ...getTableColumns(customers), active: sql<boolean>`${customerActive}`.mapWith(Boolean) })
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
