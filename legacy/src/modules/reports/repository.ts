import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, invoices, payments, queries, quotations, users } from "@/lib/db/schema";
import { customerDisplayName } from "@/modules/customers/repository";
import type { SessionUser } from "@/lib/auth/session";
import { accessCondition } from "@/modules/queries/repository";
import { OPEN_STATUSES } from "@/modules/queries/workflow";
import { addDaysISO, todayISO } from "@/lib/utils/dates";

export interface Range {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

const tzName = process.env.APP_TIME_ZONE ?? "Asia/Shanghai";
if (!/^[A-Za-z0-9_\/+-]+$/.test(tzName)) throw new Error("APP_TIME_ZONE is not a valid time zone name");
/** Inlined (validated) so identical expressions in SELECT and GROUP BY match exactly. */
const tz = sql.raw(`'${tzName}'`);
/** A timestamp column as a local calendar date, so ranges match what people see. */
const localDate = (col: SQL | typeof queries.createdAt) => sql`(${col} at time zone ${tz})::date`;
const inRange = (col: typeof queries.createdAt, r: Range) => and(gte(localDate(col), r.from), lte(localDate(col), r.to));

function scope(user: SessionUser, staffId?: string): SQL | undefined {
  return and(isNull(queries.deletedAt), accessCondition(user), staffId ? eq(queries.assignedTo, staffId) : undefined);
}

/** Current state of all work (not limited to a date range). */
export async function statusCounts(user: SessionUser, staffId?: string) {
  const rows = await db.select({ status: queries.status, n: count() }).from(queries).where(scope(user, staffId)).groupBy(queries.status);
  const [{ overdue }] = await db
    .select({ overdue: count() })
    .from(queries)
    .where(and(scope(user, staffId), inArray(queries.status, OPEN_STATUSES), lt(queries.requiredBy, todayISO())));
  const [{ unassigned }] = await db
    .select({ unassigned: count() })
    .from(queries)
    .where(and(scope(user, staffId), eq(queries.status, "pending"), isNull(queries.assignedTo)));
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  return {
    pending: byStatus.pending ?? 0,
    processing: byStatus.processing ?? 0,
    completed: byStatus.completed ?? 0,
    not_completed: byStatus.not_completed ?? 0,
    overdue,
    unassigned,
  };
}

/** Activity in a date range: received, closed, average turnaround. */
export async function rangeSummary(user: SessionUser, r: Range, staffId?: string) {
  const [received] = await db.select({ n: count() }).from(queries).where(and(scope(user, staffId), inRange(queries.createdAt, r)));
  const [closed] = await db
    .select({
      completed: sql<number>`count(*) filter (where ${queries.status} = 'completed')`.mapWith(Number),
      notCompleted: sql<number>`count(*) filter (where ${queries.status} = 'not_completed')`.mapWith(Number),
      avgMs: sql<number | null>`avg(extract(epoch from (${queries.completedAt} - ${queries.createdAt})) * 1000) filter (where ${queries.status} = 'completed')`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
    })
    .from(queries)
    .where(and(scope(user, staffId), sql`${queries.completedAt} is not null`, inRange(queries.completedAt as never, r)));
  return { received: received.n, completed: closed.completed, notCompleted: closed.notCompleted, avgTurnaroundMs: closed.avgMs };
}

/** Per-person workload and performance. */
export async function workload(r: Range) {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      open: sql<number>`count(${queries.id}) filter (where ${queries.status} in ('pending','processing'))`.mapWith(Number),
      overdue: sql<number>`count(${queries.id}) filter (where ${queries.status} in ('pending','processing') and ${queries.requiredBy} < ${todayISO()})`.mapWith(Number),
      completed: sql<number>`count(${queries.id}) filter (where ${queries.status} = 'completed' and (${queries.completedAt} at time zone ${tz})::date between ${r.from} and ${r.to})`.mapWith(Number),
      notCompleted: sql<number>`count(${queries.id}) filter (where ${queries.status} = 'not_completed' and (${queries.completedAt} at time zone ${tz})::date between ${r.from} and ${r.to})`.mapWith(Number),
      avgMs: sql<number | null>`avg(extract(epoch from (${queries.completedAt} - ${queries.createdAt})) * 1000) filter (where ${queries.status} = 'completed' and (${queries.completedAt} at time zone ${tz})::date between ${r.from} and ${r.to})`.mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
    })
    .from(users)
    .leftJoin(queries, and(eq(queries.assignedTo, users.id), isNull(queries.deletedAt)))
    .where(eq(users.isActive, true))
    .groupBy(users.id, users.name, users.role)
    .orderBy(desc(sql`count(${queries.id}) filter (where ${queries.status} in ('pending','processing'))`), asc(users.name));
  return rows;
}

/** Conversion: queries → quoted → accepted → invoiced (for queries received in the range). */
export async function pipeline(user: SessionUser, r: Range, staffId?: string) {
  // The outer column is written out in full: in a one-table query Drizzle renders ${queries.id} as a bare "id",
  // which inside the sub-query would mean the quotation's own id (the counts were always 0).
  const base = and(scope(user, staffId), inRange(queries.createdAt, r));
  const [row] = await db
    .select({
      received: sql<number>`count(distinct ${queries.id})`.mapWith(Number),
      quoted: sql<number>`count(distinct ${queries.id}) filter (where exists (select 1 from quotations q where q.query_id = "queries"."id" and q.deleted_at is null and q.status <> 'draft'))`.mapWith(Number),
      accepted: sql<number>`count(distinct ${queries.id}) filter (where exists (select 1 from quotations q where q.query_id = "queries"."id" and q.deleted_at is null and q.status = 'accepted'))`.mapWith(Number),
      invoiced: sql<number>`count(distinct ${queries.id}) filter (where exists (select 1 from invoices i where i.query_id = "queries"."id" and i.status <> 'cancelled'))`.mapWith(Number),
    })
    .from(queries)
    .where(base);
  return row;
}

/** Money in a range, plus what is outstanding right now. */
export async function finance(r: Range) {
  const [quoted] = await db
    .select({
      sent: sql<string>`coalesce(sum(${quotations.total}) filter (where ${quotations.status} in ('sent','accepted','rejected','expired')), 0)`,
      accepted: sql<string>`coalesce(sum(${quotations.total}) filter (where ${quotations.status} = 'accepted'), 0)`,
    })
    .from(quotations)
    .innerJoin(queries, eq(queries.id, quotations.queryId))
    .where(and(isNull(quotations.deletedAt), isNull(queries.deletedAt), gte(quotations.submittedAt, r.from), lte(quotations.submittedAt, r.to)));
  const [invoiced] = await db
    .select({ total: sql<string>`coalesce(sum(${invoices.total}), 0)` })
    .from(invoices)
    .where(and(ne(invoices.status, "cancelled"), gte(invoices.issueDate, r.from), lte(invoices.issueDate, r.to)));
  const [received] = await db
    .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
    .from(payments)
    .where(and(gte(payments.paidAt, r.from), lte(payments.paidAt, r.to)));
  const [outstanding] = await db
    .select({
      total: sql<string>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}), 0)`,
      overdue: sql<string>`coalesce(sum(${invoices.total} - ${invoices.amountPaid}) filter (where ${invoices.dueDate} < ${todayISO()}), 0)`,
    })
    .from(invoices)
    .where(inArray(invoices.status, ["unpaid", "partially_paid"]));
  return { quotedSent: quoted.sent, quotedAccepted: quoted.accepted, invoiced: invoiced.total, received: received.total, outstanding: outstanding.total, overdue: outstanding.overdue };
}

/** Last N months: queries received vs completed. */
export async function monthlyTrend(user: SessionUser, months = 12, staffId?: string) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));
  const startISO = start.toISOString().slice(0, 10);
  const month = (col: SQL | typeof queries.createdAt) => sql<string>`to_char(date_trunc('month', ${col} at time zone ${tz}), 'YYYY-MM')`;
  const [received, completed] = await Promise.all([
    db
      .select({ m: month(queries.createdAt), n: count() })
      .from(queries)
      .where(and(scope(user, staffId), gte(localDate(queries.createdAt), startISO)))
      .groupBy(month(queries.createdAt)),
    db
      .select({ m: month(queries.completedAt as never), n: count() })
      .from(queries)
      .where(and(scope(user, staffId), eq(queries.status, "completed"), gte(localDate(queries.completedAt as never), startISO)))
      .groupBy(month(queries.completedAt as never)),
  ]);
  const out: { month: string; label: string; received: number; completed: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + i);
    const key = d.toISOString().slice(0, 7);
    out.push({
      month: key,
      label: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }) + (d.getUTCMonth() === 0 || i === 0 ? ` ${String(d.getUTCFullYear()).slice(2)}` : ""),
      received: received.find((r) => r.m === key)?.n ?? 0,
      completed: completed.find((r) => r.m === key)?.n ?? 0,
    });
  }
  return out;
}

export async function breakdown(user: SessionUser, r: Range, by: "source" | "category", staffId?: string) {
  const col = by === "source" ? sql<string>`${queries.source}::text` : sql<string>`coalesce(nullif(${queries.category}, ''), 'Uncategorised')`;
  return db
    .select({ key: col, n: count() })
    .from(queries)
    .where(and(scope(user, staffId), inRange(queries.createdAt, r)))
    .groupBy(col)
    .orderBy(desc(count()))
    .limit(8);
}

/* ---------------------------------------------------------------- Action lists */

export async function overdueQueries(user: SessionUser, limit = 6) {
  return db
    .select({
      id: queries.id,
      refNo: queries.refNo,
      title: queries.title,
      requiredBy: queries.requiredBy,
      status: queries.status,
      companyName: customerDisplayName,
      assigneeName: users.name,
    })
    .from(queries)
    .innerJoin(customers, eq(customers.id, queries.customerId))
    .leftJoin(users, eq(users.id, queries.assignedTo))
    .where(and(scope(user), inArray(queries.status, OPEN_STATUSES), lt(queries.requiredBy, todayISO())))
    .orderBy(asc(queries.requiredBy))
    .limit(limit);
}

export async function staleQueries(user: SessionUser, pendingDays: number, limit = 6) {
  const cutoff = new Date(Date.now() - pendingDays * 86400000);
  return db
    .select({ id: queries.id, refNo: queries.refNo, title: queries.title, createdAt: queries.createdAt, companyName: customerDisplayName, assigneeName: users.name })
    .from(queries)
    .innerJoin(customers, eq(customers.id, queries.customerId))
    .leftJoin(users, eq(users.id, queries.assignedTo))
    .where(and(scope(user), eq(queries.status, "pending"), lt(queries.createdAt, cutoff)))
    .orderBy(asc(queries.createdAt))
    .limit(limit);
}

export async function expiringQuotations(user: SessionUser, withinDays: number, limit = 6) {
  return db
    .select({ id: quotations.id, refNo: quotations.refNo, dueDate: quotations.dueDate, total: quotations.total, companyName: customerDisplayName })
    .from(quotations)
    .innerJoin(queries, eq(queries.id, quotations.queryId))
    .innerJoin(customers, eq(customers.id, queries.customerId))
    .where(and(scope(user), isNull(quotations.deletedAt), eq(quotations.status, "sent"), lte(quotations.dueDate, addDaysISO(todayISO(), withinDays))))
    .orderBy(asc(quotations.dueDate))
    .limit(limit);
}

export async function unpaidInvoices(limit = 6) {
  return db
    .select({
      id: invoices.id,
      invoiceNo: invoices.invoiceNo,
      dueDate: invoices.dueDate,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      status: invoices.status,
      companyName: customerDisplayName,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .where(inArray(invoices.status, ["unpaid", "partially_paid"]))
    .orderBy(asc(invoices.dueDate))
    .limit(limit);
}
