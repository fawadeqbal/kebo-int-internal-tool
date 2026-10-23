import { and, count, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/lib/db";
import { attachments, comments, invoices, queries, queryAssignments, queryStatusHistory, users, type Query, type QueryStatus } from "@/lib/db/schema";
import { can } from "@/lib/auth/permissions";
import { assertCan, type SessionUser } from "@/lib/auth/session";
import { nextReference } from "@/lib/counters";
import { DomainError, ForbiddenError, NotFoundError } from "@/lib/utils/result";
import { diff, recordAudit } from "@/modules/audit/service";
import { createCustomer } from "@/modules/customers/service";
import { findCustomer } from "@/modules/customers/repository";
import { publish } from "@/modules/events";
import { QUERY_STATUS_LABEL } from "@/lib/labels";
import { accessCondition, findQuery } from "./repository";
import { titleFrom, type CreateQueryInput, type UpdateQueryInput } from "./schema";
import { canTransition, isReopen } from "./workflow";

/** Load a query the user is allowed to see, or fail. */
export async function getAccessibleQuery(user: SessionUser, id: string): Promise<Query> {
  const [row] = await db
    .select()
    .from(queries)
    .where(and(eq(queries.id, id), isNull(queries.deletedAt), accessCondition(user)))
    .limit(1);
  if (!row) throw new NotFoundError("Query");
  return row;
}

/** Assignee or anyone with "update any" can work on a query. */
export function canWorkOn(user: SessionUser, query: Pick<Query, "assignedTo" | "createdBy">): boolean {
  return can(user.role, "queries.updateAny") || query.assignedTo === user.id || (query.assignedTo === null && query.createdBy === user.id);
}

async function assertAssignable(actor: SessionUser, assignedTo: string | null | undefined) {
  if (!assignedTo) return;
  if (!can(actor.role, "queries.assign") && assignedTo !== actor.id) throw new ForbiddenError("You can only assign work to yourself.");
  const [user] = await db.select({ isActive: users.isActive }).from(users).where(eq(users.id, assignedTo)).limit(1);
  if (!user?.isActive) throw new DomainError("The selected person is not an active user.");
}

type NewQueryRecord = Pick<
  typeof queries.$inferInsert,
  "customerId" | "source" | "title" | "category" | "specifications" | "quantity" | "priority" | "requiredBy" | "assignedTo"
>;

/**
 * The one place a query row is created: reference number, Pending status,
 * first history entry, assignment record and audit entry. Used by the staff form
 * and by the website inquiry intake.
 */
export async function insertQueryRecord(tx: DbOrTx, actorId: string, values: NewQueryRecord) {
  const refNo = await nextReference(tx, "QRY");
  const [query] = await tx
    .insert(queries)
    .values({ ...values, refNo, createdBy: actorId, status: "pending" })
    .returning();
  await tx.insert(queryStatusHistory).values({ queryId: query.id, fromStatus: null, toStatus: "pending", changedBy: actorId });
  if (query.assignedTo) await tx.insert(queryAssignments).values({ queryId: query.id, assignedTo: query.assignedTo, assignedBy: actorId });
  await recordAudit(tx, {
    userId: actorId,
    action: "create",
    entityType: "query",
    entityId: query.id,
    summary: `Created query ${refNo}: ${query.title}`,
  });
  return query;
}

export async function createQuery(actor: SessionUser, input: CreateQueryInput) {
  assertCan(actor, "queries.create");
  await assertAssignable(actor, input.assignedTo);
  if (input.customerMode === "existing" && !(await findCustomer(input.customerId))) throw new DomainError("The selected customer no longer exists.");

  const created = await db.transaction(async (tx) => {
    const customerId =
      input.customerMode === "existing"
        ? input.customerId
        : (
            await createCustomer(
              actor,
              {
                companyName: input.companyName,
                contactPerson: input.contactPerson,
                phone: input.phone,
                email: input.email,
                address: input.address,
                taxNo: input.taxNo,
                notes: null,
                allowDuplicate: input.allowDuplicate,
              },
              tx,
            )
          ).id;

    const query = await insertQueryRecord(tx, actor.id, {
      customerId,
      source: input.source,
      title: input.title || titleFrom(input.specifications, input.category),
      category: input.category,
      specifications: input.specifications,
      quantity: input.quantity,
      priority: input.priority,
      requiredBy: input.requiredBy ?? null,
      assignedTo: input.assignedTo ?? null,
    });
    return query;
  });

  await publish({ type: "query.created", queryId: created.id, refNo: created.refNo, title: created.title, actorId: actor.id, source: created.source });
  if (created.assignedTo)
    await publish({ type: "query.assigned", queryId: created.id, refNo: created.refNo, title: created.title, assignedTo: created.assignedTo, actorId: actor.id });
  return created;
}

export async function updateQuery(actor: SessionUser, id: string, input: UpdateQueryInput) {
  const existing = await getAccessibleQuery(actor, id);
  if (!canWorkOn(actor, existing)) throw new ForbiddenError("Only the assigned person or a manager can edit this query.");
  if (!(await findCustomer(input.customerId))) throw new DomainError("The selected customer no longer exists.");
  const row = {
    customerId: input.customerId,
    source: input.source,
    title: input.title || titleFrom(input.specifications, input.category),
    category: input.category,
    specifications: input.specifications,
    quantity: input.quantity,
    priority: input.priority,
    requiredBy: input.requiredBy ?? null,
  };
  const changes = diff(existing, row);
  if (!changes.changed) return;
  await db.transaction(async (tx) => {
    await tx.update(queries).set(row).where(eq(queries.id, id));
    await recordAudit(tx, { userId: actor.id, action: "update", entityType: "query", entityId: id, summary: `Edited query ${existing.refNo}`, ...changes });
  });
}

export async function changeStatus(actor: SessionUser, id: string, to: QueryStatus, reason?: string | null) {
  const existing = await getAccessibleQuery(actor, id);
  if (!canWorkOn(actor, existing)) throw new ForbiddenError("Only the assigned person or a manager can change the status.");
  if (!canTransition(existing.status, to))
    throw new DomainError(`A query cannot move from ${QUERY_STATUS_LABEL[existing.status]} to ${QUERY_STATUS_LABEL[to]}.`);
  if (isReopen(existing.status, to) && !can(actor.role, "queries.updateAny")) throw new ForbiddenError("Only a manager can reopen a closed query.");
  if (to === "not_completed" && !reason) throw new DomainError("Please give a reason.");

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(queries)
      .set({
        status: to,
        statusReason: reason ?? null,
        completedAt: to === "completed" ? now : to === "not_completed" ? now : null,
      })
      .where(eq(queries.id, id));
    await tx.insert(queryStatusHistory).values({ queryId: id, fromStatus: existing.status, toStatus: to, reason: reason ?? null, changedBy: actor.id, changedAt: now });
    await recordAudit(tx, {
      userId: actor.id,
      action: "status_change",
      entityType: "query",
      entityId: id,
      summary: `${existing.refNo}: ${QUERY_STATUS_LABEL[existing.status]} → ${QUERY_STATUS_LABEL[to]}${reason ? ` (${reason})` : ""}`,
      oldValues: { status: existing.status },
      newValues: { status: to },
    });
  });
  await publish({
    type: "query.statusChanged",
    queryId: id,
    refNo: existing.refNo,
    title: existing.title,
    from: existing.status,
    to,
    actorId: actor.id,
    notify: [existing.assignedTo, existing.createdBy].filter((v): v is string => !!v),
  });
}

export async function assignQuery(actor: SessionUser, id: string, assignedTo: string | null) {
  const existing = await getAccessibleQuery(actor, id);
  if (!can(actor.role, "queries.assign")) {
    // Staff may pick up unassigned work for themselves, nothing more.
    if (!(existing.assignedTo === null && assignedTo === actor.id)) throw new ForbiddenError("Only a manager can assign or reassign work.");
  }
  await assertAssignable(actor, assignedTo);
  if (existing.assignedTo === assignedTo) return;
  await db.transaction(async (tx) => {
    await tx.update(queries).set({ assignedTo }).where(eq(queries.id, id));
    await tx.insert(queryAssignments).values({ queryId: id, assignedTo, assignedBy: actor.id });
    await recordAudit(tx, {
      userId: actor.id,
      action: "assign",
      entityType: "query",
      entityId: id,
      summary: `${existing.refNo}: ${assignedTo ? "assigned" : "unassigned"}`,
      oldValues: { assignedTo: existing.assignedTo },
      newValues: { assignedTo },
    });
  });
  await publish({ type: "query.assigned", queryId: id, refNo: existing.refNo, title: existing.title, assignedTo, actorId: actor.id });
}

export async function addComment(actor: SessionUser, id: string, body: string) {
  await getAccessibleQuery(actor, id);
  await db.insert(comments).values({ queryId: id, body, authorId: actor.id });
  await db.update(queries).set({ updatedAt: new Date() }).where(eq(queries.id, id));
}

export async function recordAttachment(
  actor: SessionUser,
  queryId: string,
  file: { fileName: string; mimeType: string; size: number; storageKey: string },
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(attachments)
      .values({ queryId, ...file, uploadedBy: actor.id })
      .returning({ id: attachments.id });
    await recordAudit(tx, { userId: actor.id, action: "upload", entityType: "attachment", entityId: row.id, summary: `Uploaded ${file.fileName}` });
    return row;
  });
}

export async function removeAttachment(actor: SessionUser, attachmentId: string) {
  const [file] = await db.select().from(attachments).where(and(eq(attachments.id, attachmentId), isNull(attachments.deletedAt))).limit(1);
  if (!file) throw new NotFoundError("File");
  const query = await getAccessibleQuery(actor, file.queryId);
  if (!(can(actor.role, "queries.updateAny") || file.uploadedBy === actor.id)) throw new ForbiddenError("Only the uploader or a manager can remove this file.");
  await db.transaction(async (tx) => {
    await tx.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, attachmentId));
    await recordAudit(tx, { userId: actor.id, action: "delete", entityType: "attachment", entityId: attachmentId, summary: `Removed ${file.fileName} from ${query.refNo}` });
  });
  return file.queryId;
}

export async function deleteQuery(actor: SessionUser, id: string) {
  assertCan(actor, "queries.delete");
  const existing = await findQuery(id);
  if (!existing) throw new NotFoundError("Query");
  const [{ n }] = await db.select({ n: count() }).from(invoices).where(eq(invoices.queryId, id));
  if (n > 0) throw new DomainError("This query has invoices, so it cannot be removed.");
  await db.transaction(async (tx) => {
    await tx.update(queries).set({ deletedAt: new Date() }).where(eq(queries.id, id));
    await recordAudit(tx, { userId: actor.id, action: "delete", entityType: "query", entityId: id, summary: `Removed query ${existing.refNo}` });
  });
}
