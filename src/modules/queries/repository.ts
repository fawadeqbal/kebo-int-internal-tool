import { aliasedTable, and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import {
  attachments,
  comments,
  customers,
  invoices,
  queries,
  queryAssignments,
  queryStatusHistory,
  quotations,
  users,
  type Priority,
  type QuerySource,
  type QueryStatus,
} from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import { customerDisplayName } from "@/modules/customers/repository";
import type { SessionUser } from "@/lib/auth/session";
import { todayISO } from "@/lib/utils/dates";
import { OPEN_STATUSES } from "./workflow";

/** Staff only see work assigned to them or created by them; managers see everything. */
export function accessCondition(user: SessionUser): SQL | undefined {
  if (can(user.role, "queries.viewAll")) return undefined;
  return or(eq(queries.assignedTo, user.id), eq(queries.createdBy, user.id));
}

export interface QueryFilters {
  q?: string;
  status?: QueryStatus | "open" | "overdue";
  assignee?: string; // user id | "me" | "unassigned"
  customerId?: string;
  priority?: Priority;
  source?: QuerySource;
  from?: string;
  to?: string;
  sort?: "newest" | "oldest" | "required" | "priority" | "updated";
  page?: number;
  pageSize?: number;
}

export function filterConditions(user: SessionUser, f: QueryFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [isNull(queries.deletedAt), accessCondition(user)];
  if (f.q) {
    const term = `%${f.q.trim()}%`;
    conditions.push(
      or(ilike(queries.refNo, term), ilike(queries.title, term), ilike(customers.companyName, term), ilike(customers.contactPerson, term), ilike(queries.category, term)),
    );
  }
  if (f.status === "open") conditions.push(inArray(queries.status, OPEN_STATUSES));
  else if (f.status === "overdue") conditions.push(inArray(queries.status, OPEN_STATUSES), lt(queries.requiredBy, todayISO()));
  else if (f.status) conditions.push(eq(queries.status, f.status));
  if (f.assignee === "me") conditions.push(eq(queries.assignedTo, user.id));
  else if (f.assignee === "unassigned") conditions.push(isNull(queries.assignedTo));
  else if (f.assignee) conditions.push(eq(queries.assignedTo, f.assignee));
  if (f.customerId) conditions.push(eq(queries.customerId, f.customerId));
  if (f.priority) conditions.push(eq(queries.priority, f.priority));
  if (f.source) conditions.push(eq(queries.source, f.source));
  if (f.from) conditions.push(gte(queries.createdAt, new Date(`${f.from}T00:00:00`)));
  if (f.to) conditions.push(lte(queries.createdAt, new Date(`${f.to}T23:59:59.999`)));
  return and(...conditions);
}

const assignee = aliasedTable(users, "assignee");

const PRIORITY_ORDER = sql`case ${queries.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;

function orderBy(sort: QueryFilters["sort"]) {
  switch (sort) {
    case "oldest":
      return [asc(queries.createdAt)];
    case "required":
      return [sql`${queries.requiredBy} asc nulls last`, desc(queries.createdAt)];
    case "priority":
      return [PRIORITY_ORDER, desc(queries.createdAt)];
    case "updated":
      return [desc(queries.updatedAt)];
    default:
      return [desc(queries.createdAt)];
  }
}

const listColumns = {
  id: queries.id,
  refNo: queries.refNo,
  title: queries.title,
  category: queries.category,
  status: queries.status,
  priority: queries.priority,
  source: queries.source,
  quantity: queries.quantity,
  requiredBy: queries.requiredBy,
  createdAt: queries.createdAt,
  updatedAt: queries.updatedAt,
  completedAt: queries.completedAt,
  customerId: customers.id,
  companyName: customerDisplayName,
  contactPerson: customers.contactPerson,
  customerPhone: customers.phone,
  assigneeId: assignee.id,
  assigneeName: assignee.name,
};

export async function listQueries(user: SessionUser, f: QueryFilters) {
  const page = f.page ?? 1;
  const pageSize = f.pageSize ?? 25;
  const where = filterConditions(user, f);
  const base = () =>
    db.select(listColumns).from(queries).innerJoin(customers, eq(customers.id, queries.customerId)).leftJoin(assignee, eq(assignee.id, queries.assignedTo));
  const [rows, [{ total }]] = await Promise.all([
    base()
      .where(where)
      .orderBy(...orderBy(f.sort))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(queries).innerJoin(customers, eq(customers.id, queries.customerId)).where(where),
  ]);
  return { rows, total, page, pageSize };
}

/** Used for CSV export (no paging, capped). */
export async function listQueriesForExport(user: SessionUser, f: QueryFilters) {
  return db
    .select(listColumns)
    .from(queries)
    .innerJoin(customers, eq(customers.id, queries.customerId))
    .leftJoin(assignee, eq(assignee.id, queries.assignedTo))
    .where(filterConditions(user, f))
    .orderBy(...orderBy(f.sort))
    .limit(10000);
}

export async function findQuery(id: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select()
    .from(queries)
    .where(and(eq(queries.id, id), isNull(queries.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getQueryDetail(user: SessionUser, id: string) {
  const [row] = await db
    .select({
      query: queries,
      customer: customers,
      assigneeName: assignee.name,
      creatorName: sql<string>`(select u.name from users u where u.id = ${queries.createdBy})`,
    })
    .from(queries)
    .innerJoin(customers, eq(customers.id, queries.customerId))
    .leftJoin(assignee, eq(assignee.id, queries.assignedTo))
    .where(and(eq(queries.id, id), isNull(queries.deletedAt), accessCondition(user)))
    .limit(1);
  if (!row) return null;

  const [files, notes, history, assignments, quotes, invs] = await Promise.all([
    db
      .select({
        id: attachments.id,
        fileName: attachments.fileName,
        mimeType: attachments.mimeType,
        size: attachments.size,
        createdAt: attachments.createdAt,
        uploadedBy: users.name,
        uploaderId: attachments.uploadedBy,
      })
      .from(attachments)
      .innerJoin(users, eq(users.id, attachments.uploadedBy))
      .where(and(eq(attachments.queryId, id), isNull(attachments.deletedAt)))
      .orderBy(desc(attachments.createdAt)),
    db
      .select({ id: comments.id, body: comments.body, createdAt: comments.createdAt, authorName: users.name, authorId: users.id })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.queryId, id))
      .orderBy(desc(comments.createdAt)),
    db
      .select({
        id: queryStatusHistory.id,
        fromStatus: queryStatusHistory.fromStatus,
        toStatus: queryStatusHistory.toStatus,
        reason: queryStatusHistory.reason,
        changedAt: queryStatusHistory.changedAt,
        userName: users.name,
      })
      .from(queryStatusHistory)
      .innerJoin(users, eq(users.id, queryStatusHistory.changedBy))
      .where(eq(queryStatusHistory.queryId, id))
      .orderBy(asc(queryStatusHistory.changedAt)),
    db
      .select({
        id: queryAssignments.id,
        assignedAt: queryAssignments.assignedAt,
        byName: users.name,
        toName: sql<string | null>`(select u.name from users u where u.id = ${queryAssignments.assignedTo})`,
      })
      .from(queryAssignments)
      .innerJoin(users, eq(users.id, queryAssignments.assignedBy))
      .where(eq(queryAssignments.queryId, id))
      .orderBy(asc(queryAssignments.assignedAt)),
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
      })
      .from(quotations)
      .where(and(eq(quotations.queryId, id), isNull(quotations.deletedAt)))
      .orderBy(desc(quotations.version)),
    db
      .select({
        id: invoices.id,
        invoiceNo: invoices.invoiceNo,
        status: invoices.status,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
        dueDate: invoices.dueDate,
        issueDate: invoices.issueDate,
      })
      .from(invoices)
      .where(eq(invoices.queryId, id))
      .orderBy(desc(invoices.createdAt)),
  ]);

  return { ...row, files, notes, history, assignments, quotations: quotes, invoices: invs };
}

export async function listQueriesForCustomer(user: SessionUser, customerId: string) {
  return db
    .select({
      id: queries.id,
      refNo: queries.refNo,
      title: queries.title,
      status: queries.status,
      createdAt: queries.createdAt,
      assigneeName: assignee.name,
    })
    .from(queries)
    .leftJoin(assignee, eq(assignee.id, queries.assignedTo))
    .where(and(eq(queries.customerId, customerId), isNull(queries.deletedAt), accessCondition(user)))
    .orderBy(desc(queries.createdAt));
}
