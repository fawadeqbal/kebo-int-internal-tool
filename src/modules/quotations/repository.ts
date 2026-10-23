import { and, asc, count, desc, eq, ilike, isNull, lt, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, invoices, queries, quotationItems, quotations, users, type QuotationStatus } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { accessCondition } from "@/modules/queries/repository";
import { todayISO } from "@/lib/utils/dates";

export interface QuotationFilters {
  q?: string;
  status?: QuotationStatus | "expiring";
  page?: number;
  pageSize?: number;
}

export async function listQuotations(user: SessionUser, f: QuotationFilters) {
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 25;
  const conditions: (SQL | undefined)[] = [isNull(quotations.deletedAt), isNull(queries.deletedAt), accessCondition(user)];
  if (f.q) {
    const term = `%${f.q}%`;
    conditions.push(or(ilike(quotations.refNo, term), ilike(queries.refNo, term), ilike(queries.title, term), ilike(customers.companyName, term)));
  }
  if (f.status === "expiring") conditions.push(eq(quotations.status, "sent"));
  else if (f.status) conditions.push(eq(quotations.status, f.status));
  const where = and(...conditions);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: quotations.id,
        refNo: quotations.refNo,
        version: quotations.version,
        status: quotations.status,
        total: quotations.total,
        dueDate: quotations.dueDate,
        submittedAt: quotations.submittedAt,
        createdAt: quotations.createdAt,
        queryId: queries.id,
        queryRef: queries.refNo,
        queryTitle: queries.title,
        companyName: customers.companyName,
      })
      .from(quotations)
      .innerJoin(queries, eq(queries.id, quotations.queryId))
      .innerJoin(customers, eq(customers.id, queries.customerId))
      .where(where)
      .orderBy(f.status === "expiring" ? asc(quotations.dueDate) : desc(quotations.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(quotations)
      .innerJoin(queries, eq(queries.id, quotations.queryId))
      .innerJoin(customers, eq(customers.id, queries.customerId))
      .where(where),
  ]);
  return { rows, total, page, pageSize };
}

export async function getQuotationDetail(user: SessionUser, id: string) {
  const [row] = await db
    .select({ quotation: quotations, query: queries, customer: customers, creatorName: users.name })
    .from(quotations)
    .innerJoin(queries, eq(queries.id, quotations.queryId))
    .innerJoin(customers, eq(customers.id, queries.customerId))
    .innerJoin(users, eq(users.id, quotations.createdBy))
    .where(and(eq(quotations.id, id), isNull(quotations.deletedAt), isNull(queries.deletedAt), accessCondition(user)))
    .limit(1);
  if (!row) return null;
  const [items, invoiceRows, versions] = await Promise.all([
    db.select().from(quotationItems).where(eq(quotationItems.quotationId, id)).orderBy(asc(quotationItems.sortOrder)),
    db
      .select({ id: invoices.id, invoiceNo: invoices.invoiceNo, status: invoices.status, total: invoices.total, dueDate: invoices.dueDate })
      .from(invoices)
      .where(eq(invoices.quotationId, id))
      .orderBy(desc(invoices.createdAt)),
    db
      .select({ id: quotations.id, refNo: quotations.refNo, version: quotations.version, status: quotations.status, total: quotations.total })
      .from(quotations)
      .where(and(eq(quotations.queryId, row.query.id), isNull(quotations.deletedAt)))
      .orderBy(desc(quotations.version)),
  ]);
  return { ...row, items, invoices: invoiceRows, versions };
}

export async function sentPastDue() {
  return db
    .select({ id: quotations.id, refNo: quotations.refNo, createdBy: quotations.createdBy })
    .from(quotations)
    .where(and(eq(quotations.status, "sent"), lt(quotations.dueDate, todayISO()), isNull(quotations.deletedAt)));
}
