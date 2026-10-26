import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { fromDbDateOrNull, nextReference, toDbDateOrNull, type Prisma } from "@kebo/database";
import { canHold, can, isOpen, OPEN_STAGES, type InquiryInput, type InquiryListQuery, type StageMoveInput } from "@kebo/shared";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import { StorageService, safeFileName } from "../../common/storage/storage.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { StagesService } from "./stages.service";

/** Staff see the deals they handle or created; managers see all. */
export function inquiryAccess(user: SessionUser): Prisma.InquiryWhereInput {
  if (can(user.role, "inquiries.viewAll")) return {};
  return { OR: [{ assigneeId: user.id }, { createdById: user.id }] };
}

/** The handler, its creator while nobody handles it, or a manager may change a deal. */
export function canWorkOn(user: SessionUser, i: { assigneeId: string | null; createdById: string }) {
  return can(user.role, "inquiries.updateAny") || i.assigneeId === user.id || (i.assigneeId === null && i.createdById === user.id);
}

/** "Tablet press + 2 more" when no title is typed. */
export function titleFromItems(items: { description: string }[], category: string) {
  const first = items[0]?.description.split("\n")[0].trim();
  if (!first) return `${category} inquiry`;
  const head = first.length > 120 ? `${first.slice(0, 117)}…` : first;
  return items.length > 1 ? `${head} + ${items.length - 1} more` : head;
}

const PRIORITY_ORDER = { urgent: 0, high: 1, normal: 2, low: 3 } as const;

@Injectable()
export class InquiriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly stages: StagesService,
  ) {}

  /* ---------------------------------------------------------------- reading */

  private where(user: SessionUser, q: Partial<InquiryListQuery>): Prisma.InquiryWhereInput {
    const today = new Date(`${this.clock.today()}T00:00:00Z`);
    const and: Prisma.InquiryWhereInput[] = [{ deletedAt: null }, inquiryAccess(user)];
    if (q.stage === "open") and.push({ stage: { in: [...OPEN_STAGES] } });
    else if (q.stage === "overdue") and.push({ stage: { in: [...OPEN_STAGES] }, requiredBy: { lt: today } });
    else if (q.stage === "on_hold") and.push({ onHold: true, stage: { in: [...OPEN_STAGES] } });
    else if (q.stage) and.push({ stage: q.stage });
    if (q.assignee === "me") and.push({ assigneeId: user.id });
    else if (q.assignee === "unassigned") and.push({ assigneeId: null });
    else if (q.assignee) and.push({ assigneeId: q.assignee });
    if (q.customerId) and.push({ customerId: q.customerId });
    if (q.priority) and.push({ priority: q.priority });
    if (q.channel) and.push({ channel: q.channel });
    if (q.q) {
      const term = q.q.trim();
      and.push({
        OR: [
          { refNo: { contains: term, mode: "insensitive" } },
          { title: { contains: term, mode: "insensitive" } },
          { category: { contains: term, mode: "insensitive" } },
          { customer: { name: { contains: term, mode: "insensitive" } } },
          { items: { some: { OR: [{ description: { contains: term, mode: "insensitive" } }, { model: { contains: term, mode: "insensitive" } }] } } },
        ],
      });
    }
    return { AND: and };
  }

  async list(user: SessionUser, q: InquiryListQuery) {
    const where = this.where(user, q);
    const orderBy: Prisma.InquiryOrderByWithRelationInput[] =
      q.sort === "oldest"
        ? [{ createdAt: "asc" }]
        : q.sort === "required"
          ? [{ requiredBy: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }]
          : q.sort === "updated"
            ? [{ updatedAt: "desc" }]
            : [{ createdAt: "desc" }];
    const [rows, total, byStage] = await Promise.all([
      this.prisma.db.inquiry.findMany({
        where,
        orderBy,
        skip: q.sort === "priority" ? 0 : (q.page - 1) * q.pageSize,
        take: q.sort === "priority" ? 500 : q.pageSize,
        include: {
          customer: { select: { id: true, name: true, country: true } },
          assignee: { select: { id: true, name: true } },
          _count: { select: { items: true } },
          quotation: { select: { refNo: true, revisions: { where: { deletedAt: null }, orderBy: { number: "desc" }, take: 1, select: { number: true, status: true, total: true, currency: true } } } },
          orders: { where: { status: { not: "cancelled" } }, select: { id: true, refNo: true, status: true } },
        },
      }),
      this.prisma.db.inquiry.count({ where }),
      this.prisma.db.inquiry.groupBy({ by: ["stage"], where: this.where(user, { ...q, stage: undefined }), _count: true }),
    ]);
    const sorted = q.sort === "priority" ? rows.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]).slice((q.page - 1) * q.pageSize, q.page * q.pageSize) : rows;
    const today = this.clock.today();
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(byStage.map((g) => [g.stage, g._count])),
      rows: sorted.map((i) => ({
        id: i.id,
        refNo: i.refNo,
        title: i.title,
        category: i.category,
        channel: i.channel,
        priority: i.priority,
        stage: i.stage,
        onHold: i.onHold,
        requiredBy: fromDbDateOrNull(i.requiredBy),
        overdue: isOpen(i.stage) && !!i.requiredBy && fromDbDateOrNull(i.requiredBy)! < today,
        customer: i.customer,
        assignee: i.assignee,
        items: i._count.items,
        quotation: i.quotation ? { refNo: i.quotation.refNo, latest: i.quotation.revisions[0] ?? null } : null,
        order: i.orders[0] ?? null,
        createdAt: i.createdAt,
        updatedAt: i.updatedAt,
      })),
    };
  }

  /** A deal the person may see, or 404. */
  async find(user: SessionUser, id: string, db: Tx | PrismaService["db"] = this.prisma.db) {
    const i = await db.inquiry.findFirst({ where: { id, deletedAt: null, ...inquiryAccess(user) } });
    if (!i) throw new NotFoundError("Inquiry");
    return i;
  }

  /** A deal the person may change, or 403/404. */
  async findWorkable(user: SessionUser, id: string, db: Tx | PrismaService["db"] = this.prisma.db) {
    const i = await this.find(user, id, db);
    if (!canWorkOn(user, i)) throw new ForbiddenError("Only the person handling this deal or a manager can change it.");
    return i;
  }

  async get(user: SessionUser, id: string) {
    await this.find(user, id);
    const seeCosts = can(user.role, "sourcing.manage");
    const i = await this.prisma.db.inquiry.findUniqueOrThrow({
      where: { id },
      include: {
        customer: { include: { contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] } } },
        contact: true,
        assignee: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
        items: { orderBy: { sortOrder: "asc" } },
        notes: { orderBy: { createdAt: "desc" } },
        attachments: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        stageChanges: { orderBy: { changedAt: "asc" } },
        assignments: { orderBy: { assignedAt: "asc" } },
        quotation: { include: { revisions: { where: { deletedAt: null }, orderBy: { number: "desc" }, select: { id: true, number: true, status: true, total: true, currency: true, validUntil: true, sentOn: true, answeredOn: true, createdAt: true } } } },
        orders: { orderBy: { createdAt: "desc" }, select: { id: true, refNo: true, status: true, orderedOn: true, total: true, currency: true } },
        ...(seeCosts
          ? { factoryQuotes: { where: { deletedAt: null }, include: { factory: { select: { id: true, name: true } }, lines: { orderBy: { sortOrder: "asc" } } }, orderBy: { receivedOn: "desc" } } }
          : {}),
      },
    });
    // Names for the people mentioned in notes, files and history, in one query.
    const ids = new Set<string>([...i.notes.map((n) => n.authorId), ...i.attachments.map((a) => a.uploadedById), ...i.stageChanges.map((s) => s.changedById), ...i.assignments.flatMap((a) => [a.assignedById, a.assigneeId])].filter((v): v is string => !!v));
    const people = Object.fromEntries((await this.prisma.db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return {
      ...i,
      requiredBy: fromDbDateOrNull(i.requiredBy),
      people,
      canWork: canWorkOn(user, i),
      allowed: {
        edit: canWorkOn(user, i) && isOpen(i.stage),
        quote: canWorkOn(user, i) && isOpen(i.stage) && can(user.role, "quotations.manage"),
        source: canWorkOn(user, i) && can(user.role, "sourcing.manage"),
        assign: can(user.role, "inquiries.assign") || (i.assigneeId === null && can(user.role, "inquiries.create")),
        hold: canWorkOn(user, i) && canHold(i.stage),
        reopen: i.stage === "lost" && can(user.role, "inquiries.reopen"),
      },
    };
  }

  /* ---------------------------------------------------------------- creating and editing */

  private async canonicalCategory(category: string) {
    const known = (await this.settings.get()).sales.categories;
    return known.find((c) => c.toLowerCase() === category.toLowerCase()) ?? category;
  }

  private async assertAssignable(user: SessionUser, assigneeId: string | null | undefined) {
    if (!assigneeId) return;
    if (!can(user.role, "inquiries.assign") && assigneeId !== user.id) throw new ForbiddenError("You can only assign work to yourself.");
    const a = await this.prisma.db.user.findFirst({ where: { id: assigneeId, isActive: true, isSystem: false } });
    if (!a) throw new DomainError("The selected person is not an active user.");
  }

  private async assertContact(customerId: string, contactId: string | null | undefined) {
    if (!contactId) return;
    const c = await this.prisma.db.contact.findFirst({ where: { id: contactId, customerId, deletedAt: null } });
    if (!c) throw new DomainError("That contact does not belong to this customer.");
  }

  /** Requested items keep their ids (quotation lines and factory prices point at them). */
  private async writeItems(tx: Tx, inquiryId: string, items: InquiryInput["items"]) {
    const existing = new Set((await tx.requestedItem.findMany({ where: { inquiryId }, select: { id: true } })).map((r) => r.id));
    const keep = items.map((i) => i.id).filter((id): id is string => !!id && existing.has(id));
    await tx.requestedItem.deleteMany({ where: { inquiryId, id: { notIn: keep } } });
    for (const [n, item] of items.entries()) {
      const row = { description: item.description, model: item.model, quantity: item.quantity, unit: item.unit, targetPrice: item.targetPrice ?? null, sortOrder: n };
      if (item.id && existing.has(item.id)) await tx.requestedItem.update({ where: { id: item.id }, data: row });
      else await tx.requestedItem.create({ data: { ...row, inquiryId } });
    }
  }

  /**
   * The one place a deal is created (staff form and website form): reference
   * number, stage history, assignment record, audit, and events.
   */
  async createRecord(tx: Tx, actorId: string, input: InquiryInput, opts: { channelNote?: string } = {}) {
    const category = await this.canonicalCategory(input.category);
    const refNo = await nextReference(tx, "inquiry", Number(this.clock.today().slice(0, 4)));
    const inquiry = await tx.inquiry.create({
      data: {
        refNo,
        customerId: input.customerId,
        contactId: input.contactId,
        channel: input.channel,
        category,
        title: input.title || titleFromItems(input.items, category),
        requirements: [input.requirements, opts.channelNote].filter(Boolean).join("\n\n") || null,
        priority: input.priority,
        requiredBy: toDbDateOrNull(input.requiredBy),
        assigneeId: input.assigneeId,
        createdById: actorId,
        stageChanges: { create: { toStage: "new", cause: "created", changedById: actorId } },
        ...(input.assigneeId ? { assignments: { create: { assigneeId: input.assigneeId, assignedById: actorId } } } : {}),
      },
    });
    await this.writeItems(tx, inquiry.id, input.items);
    await this.audit.record(tx, { userId: actorId, action: "create", entityType: "inquiry", entityId: inquiry.id, summary: `Created inquiry ${refNo}: ${inquiry.title}` });
    const events: DomainEvent[] = [{ type: "inquiry.created", inquiryId: inquiry.id, refNo, title: inquiry.title, channel: inquiry.channel, actorId }];
    if (input.assigneeId) {
      events.push({ type: "inquiry.assigned", inquiryId: inquiry.id, refNo, title: inquiry.title, assigneeId: input.assigneeId, actorId });
      const moved = await this.stages.after(tx, inquiry, "assigned", actorId);
      if (moved) events.push(moved);
    }
    return { inquiry, events };
  }

  async create(user: SessionUser, input: InquiryInput) {
    if (!can(user.role, "inquiries.create")) throw new ForbiddenError();
    await this.assertAssignable(user, input.assigneeId);
    const customer = await this.prisma.db.customer.findFirst({ where: { id: input.customerId, deletedAt: null } });
    if (!customer) throw new DomainError("The selected customer no longer exists.");
    await this.assertContact(input.customerId, input.contactId);
    const { inquiry, events } = await this.prisma.tx((tx) => this.createRecord(tx, user.id, input));
    await this.events.publish(...events);
    return inquiry;
  }

  async update(user: SessionUser, id: string, input: InquiryInput) {
    const existing = await this.findWorkable(user, id);
    if (!isOpen(existing.stage)) throw new DomainError("This deal is closed. Reopen it to change the details.");
    if (input.customerId !== existing.customerId) {
      const sent = await this.prisma.db.quotationRevision.count({ where: { quotation: { inquiryId: id }, status: { not: "draft" }, deletedAt: null } });
      if (sent) throw new DomainError("A quotation was already sent to this customer, so the deal cannot move to another customer.");
    }
    await this.assertContact(input.customerId, input.contactId);
    const category = await this.canonicalCategory(input.category);
    return this.prisma.tx(async (tx) => {
      const updated = await tx.inquiry.update({
        where: { id },
        data: {
          customerId: input.customerId,
          contactId: input.contactId,
          channel: input.channel,
          category,
          title: input.title || titleFromItems(input.items, category),
          requirements: input.requirements,
          priority: input.priority,
          requiredBy: toDbDateOrNull(input.requiredBy),
        },
      });
      await this.writeItems(tx, id, input.items);
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "inquiry",
        entityId: id,
        summary: `Edited inquiry ${existing.refNo}`,
        oldValues: { title: existing.title, category: existing.category, priority: existing.priority, requiredBy: fromDbDateOrNull(existing.requiredBy) },
        newValues: { title: updated.title, category, priority: input.priority, requiredBy: input.requiredBy },
      });
      return updated;
    });
  }

  /* ---------------------------------------------------------------- stage, hold, assignment, notes */

  async move(user: SessionUser, id: string, input: StageMoveInput) {
    const event = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from inquiries where id = ${id}::uuid for update`;
      const i = await this.findWorkable(user, id, tx);
      return this.stages.manual(tx, i, input.to, { lostReason: input.lostReason, note: input.note }, { id: user.id, canReopen: can(user.role, "inquiries.reopen") });
    });
    await this.events.publish(event);
    return this.get(user, id);
  }

  async hold(user: SessionUser, id: string, input: { onHold: boolean; note: string | null }) {
    await this.prisma.tx(async (tx) => {
      const i = await this.findWorkable(user, id, tx);
      if (input.onHold && !canHold(i.stage)) throw new DomainError("Only an open deal can be put on hold.");
      if (i.onHold === input.onHold) return;
      await tx.inquiry.update({ where: { id }, data: { onHold: input.onHold } });
      if (input.note) await tx.inquiryNote.create({ data: { inquiryId: id, authorId: user.id, body: `${input.onHold ? "On hold" : "Resumed"}: ${input.note}` } });
      await this.audit.record(tx, { userId: user.id, action: input.onHold ? "hold" : "resume", entityType: "inquiry", entityId: id, summary: `${i.refNo}: ${input.onHold ? "put on hold" : "resumed"}${input.note ? ` — ${input.note}` : ""}` });
    });
    return this.get(user, id);
  }

  /** Managers assign anyone; staff may only pick up unassigned work for themselves. Assigning starts sourcing. */
  async assign(user: SessionUser, id: string, assigneeId: string | null) {
    const events = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from inquiries where id = ${id}::uuid for update`;
      const i = await this.find(user, id, tx);
      if (!can(user.role, "inquiries.assign") && !(i.assigneeId === null && assigneeId === user.id)) throw new ForbiddenError("Only a manager can assign or reassign work.");
      await this.assertAssignable(user, assigneeId);
      if (i.assigneeId === assigneeId) return [];
      await tx.inquiry.update({ where: { id }, data: { assigneeId } });
      await tx.inquiryAssignment.create({ data: { inquiryId: id, assigneeId, assignedById: user.id } });
      await this.audit.record(tx, { userId: user.id, action: "assign", entityType: "inquiry", entityId: id, summary: `${i.refNo}: ${assigneeId ? "assigned" : "unassigned"}`, oldValues: { assigneeId: i.assigneeId }, newValues: { assigneeId } });
      const out: DomainEvent[] = [{ type: "inquiry.assigned", inquiryId: id, refNo: i.refNo, title: i.title, assigneeId, actorId: user.id }];
      if (assigneeId) {
        const moved = await this.stages.after(tx, { ...i, assigneeId }, "assigned", user.id);
        if (moved) out.push(moved);
      }
      return out;
    });
    await this.events.publish(...events);
    return this.get(user, id);
  }

  async addNote(user: SessionUser, id: string, body: string) {
    await this.find(user, id);
    const note = await this.prisma.db.inquiryNote.create({ data: { inquiryId: id, authorId: user.id, body } });
    await this.prisma.db.inquiry.update({ where: { id }, data: { updatedAt: new Date() } });
    return note;
  }

  /** Soft delete; never for a deal that has an order. */
  async remove(user: SessionUser, id: string) {
    if (!can(user.role, "inquiries.delete")) throw new ForbiddenError();
    const i = await this.find(user, id);
    if (await this.prisma.db.order.count({ where: { inquiryId: id } })) throw new ConflictError("This deal has an order, so it cannot be removed.");
    await this.prisma.tx(async (tx) => {
      await tx.inquiry.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "inquiry", entityId: id, summary: `Removed inquiry ${i.refNo}` });
    });
  }

  /* ---------------------------------------------------------------- files */

  async upload(user: SessionUser, id: string, file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, links: { milestoneId?: string | null; factoryQuoteId?: string | null; paymentId?: string | null } = {}) {
    await this.find(user, id);
    if (!this.storage.isAllowed(file.originalname)) throw new DomainError("This kind of file is not allowed. Use PDF, Office, images, CAD drawings or zip files.");
    if (file.size > this.storage.maxBytes) throw new DomainError(`Files can be up to ${Math.round(this.storage.maxBytes / 1024 / 1024)} MB.`);
    const name = safeFileName(file.originalname);
    const key = `inquiries/${id}/${randomUUID()}-${name}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    try {
      return await this.prisma.tx(async (tx) => {
        const row = await tx.attachment.create({
          data: { inquiryId: id, fileName: name, mimeType: file.mimetype || "application/octet-stream", size: file.size, storageKey: key, uploadedById: user.id, ...links },
        });
        await this.audit.record(tx, { userId: user.id, action: "upload", entityType: "attachment", entityId: row.id, summary: `Uploaded ${name}` });
        return row;
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined); // no orphan file when the record could not be saved
      throw error;
    }
  }

  /** Streams a file after checking the person may see its deal. */
  async download(user: SessionUser, attachmentId: string): Promise<{ stream: Readable; fileName: string; mimeType: string; size: number }> {
    const a = await this.prisma.db.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
    if (!a) throw new NotFoundError("File");
    await this.find(user, a.inquiryId);
    return { stream: await this.storage.get(a.storageKey), fileName: a.fileName, mimeType: a.mimeType, size: a.size };
  }

  async removeFile(user: SessionUser, attachmentId: string) {
    const a = await this.prisma.db.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
    if (!a) throw new NotFoundError("File");
    const i = await this.find(user, a.inquiryId);
    if (!(can(user.role, "inquiries.updateAny") || a.uploadedById === user.id)) throw new ForbiddenError("Only the uploader or a manager can remove this file.");
    await this.prisma.tx(async (tx) => {
      await tx.attachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "attachment", entityId: attachmentId, summary: `Removed ${a.fileName} from ${i.refNo}` });
    });
  }
}
