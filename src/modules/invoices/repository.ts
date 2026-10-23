import { and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, invoiceItems, invoices, payments, queries, quotations, users } from "@/lib/db/schema";
import { customerDisplayName } from "@/modules/customers/repository";
import type { SessionUser } from "@/lib/auth/session";
import { todayISO } from "@/lib/utils/dates";

export interface InvoiceFilters {
  q?: string;
  status?: "unpaid" | "partially_paid" | "paid" | "cancelled" | "overdue" | "outstanding";
  from?: string;
  to?: string;
  sort?: "newest" | "due" | "balance";
  page?: number;
  pageSize?: number;
}

export async function listInvoices(_user: SessionUser, f: InvoiceFilters) {
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 25;
  const conditions: (SQL | undefined)[] = [];
  if (f.q) {
    const term = `%${f.q}%`;
    conditions.push(or(ilike(invoices.invoiceNo, term), ilike(customers.companyName, term), ilike(queries.refNo, term), ilike(queries.title, term)));
  }
  if (f.status === "overdue") conditions.push(inArray(invoices.status, ["unpaid", "partially_paid"]), lt(invoices.dueDate, todayISO()));
  else if (f.status === "outstanding") conditions.push(inArray(invoices.status, ["unpaid", "partially_paid"]));
  else if (f.status) conditions.push(eq(invoices.status, f.status));
  if (f.from) conditions.push(gte(invoices.issueDate, f.from));
  if (f.to) conditions.push(lte(invoices.issueDate, f.to));
  const where = and(...conditions);
  const order =
    f.sort === "balance"
      ? [sql`(${invoices.total} - ${invoices.amountPaid}) desc`]
      : f.sort === "due" || (!f.sort && (f.status === "overdue" || f.status === "outstanding"))
        ? [asc(invoices.dueDate)]
        : [desc(invoices.createdAt)];
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoiceNo: invoices.invoiceNo,
        status: invoices.status,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        companyName: customerDisplayName,
        customerId: customers.id,
        queryRef: queries.refNo,
        queryId: queries.id,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .innerJoin(queries, eq(queries.id, invoices.queryId))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .innerJoin(queries, eq(queries.id, invoices.queryId))
      .where(where),
  ]);
  return { rows, total, page, pageSize };
}

export async function getInvoiceDetail(id: string) {
  const [row] = await db
    .select({ invoice: invoices, customer: customers, query: queries, quotation: quotations, creatorName: users.name })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(queries, eq(queries.id, invoices.queryId))
    .innerJoin(quotations, eq(quotations.id, invoices.quotationId))
    .innerJoin(users, eq(users.id, invoices.createdBy))
    .where(eq(invoices.id, id))
    .limit(1);
  if (!row) return null;
  const [items, paymentRows] = await Promise.all([
    db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id)).orderBy(asc(invoiceItems.sortOrder)),
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        paidAt: payments.paidAt,
        method: payments.method,
        reference: payments.reference,
        recordedBy: users.name,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .innerJoin(users, eq(users.id, payments.recordedBy))
      .where(eq(payments.invoiceId, id))
      .orderBy(desc(payments.paidAt)),
  ]);
  return { ...row, items, payments: paymentRows };
}
