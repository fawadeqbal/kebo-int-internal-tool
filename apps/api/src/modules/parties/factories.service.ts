import { orderAccess } from "../../common/auth/order-access";
import { customerOnly } from "./fields";
import { Injectable } from "@nestjs/common";
import { fromDbDateOrNull, type Prisma, isSupplier, newSupplier } from "@kebo/database";
import { can, type FactoryImport, type FactoryInput, type ImportResult, type ListQuery } from "@kebo/shared";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import type { SessionUser } from "../../common/auth/session-user";
import { requireReason } from "../../common/audit/reason";

const ownerSelect = { select: { id: true, name: true } } as const;

/**
 * Factories are shared by the whole team (staff source from them); only
 * managers remove one. Each may have one person who looks after it ("My
 * factories"), who is also the default for paying it.
 */
@Injectable()
export class FactoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: SessionUser, q: ListQuery & { mine?: boolean }) {
    const where: Prisma.PartyWhereInput = {
      ...isSupplier,
      deletedAt: null,
      ...(q.mine ? { ownerId: user.id } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { contactPerson: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.party.findMany({
        where,
        omit: customerOnly,
        include: { owner: ownerSelect, _count: { select: { quotes: { where: { deletedAt: null } } } } },
        orderBy: { name: "asc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.db.party.count({ where }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, rows };
  }

  async get(id: string, user?: SessionUser) {
    const f = await this.prisma.db.party.findFirst({
      where: { ...isSupplier, id, deletedAt: null },
      omit: customerOnly,
      include: {
        owner: ownerSelect,
        quotes: {
          where: { deletedAt: null },
          select: { id: true, receivedOn: true, currency: true, inquiry: { select: { id: true, refNo: true, title: true } }, _count: { select: { lines: true } } },
          orderBy: { receivedOn: "desc" },
          take: 50,
        },
      },
    });
    if (!f) throw new NotFoundError("Factory");
    return { ...f, record: await this.record(id, user) };
  }

  /**
   * How the factory works with us: how often it answers when asked for a price
   * (and how fast), and the orders it is making now with any late production step.
   */
  private async record(id: string, user?: SessionUser) {
    const db = this.prisma.db;
    const [requests, quotes, orders, lateSteps] = await Promise.all([
      db.factoryRequest.findMany({ where: { factoryId: id }, select: { inquiryId: true, status: true, sentOn: true } }),
      db.factoryQuote.findMany({ where: { factoryId: id, deletedAt: null }, select: { inquiryId: true, receivedOn: true } }),
      db.order.findMany({ where: { status: "open", lines: { some: { factoryId: id } }, ...(user ? orderAccess(user) : { id: { in: [] } }) }, select: { id: true, refNo: true, factories: { where: { factoryId: id }, select: { readyOn: true } }, customer: { select: { name: true } } }, orderBy: { orderedOn: "desc" }, take: 20 }),
      db.orderChecklistItem.count({ where: { factoryId: id, step: "production", doneAt: null, skippedAt: null, dueOn: { lt: new Date() }, order: { status: "open" } } }),
    ]);
    const answered = requests.filter((r) => r.status === "quoted" || quotes.some((q) => q.inquiryId === r.inquiryId));
    const days = answered
      .map((r) => {
        const q = quotes.find((x) => x.inquiryId === r.inquiryId);
        return q ? Math.max(0, Math.round((q.receivedOn.getTime() - r.sentOn.getTime()) / 86_400_000)) : null;
      })
      .filter((d): d is number => d !== null);
    return {
      asked: requests.length,
      answered: answered.length,
      declined: requests.filter((r) => r.status === "declined").length,
      noReply: requests.filter((r) => r.status === "no_reply").length,
      avgDaysToAnswer: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
      openOrders: orders.map((o) => ({ id: o.id, refNo: o.refNo, customer: o.customer.name, readyOn: fromDbDateOrNull(o.factories[0]?.readyOn ?? null) })), // this factory's own ready date
      lateSteps,
    };
  }

  private async assertUniqueName(name: string, exceptId?: string) {
    const clash = await this.prisma.db.party.findFirst({ where: { ...isSupplier, deletedAt: null, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (clash) throw new ConflictError(`A factory called "${clash.name}" already exists.`);
  }

  /** The person must be an active member of the team. */
  private async assertOwner(ownerId: string | null | undefined) {
    if (!ownerId) return;
    const u = await this.prisma.db.user.findFirst({ where: { id: ownerId, isActive: true } });
    if (!u) throw new DomainError("Choose an active person to look after this factory.");
  }

  private fields(input: FactoryInput) {
    const { reason: _reason, ...fields } = input;
    return { ...fields, ownerId: input.ownerId ?? null };
  }

  async create(user: SessionUser, input: FactoryInput) {
    await this.assertUniqueName(input.name);
    await this.assertOwner(input.ownerId);
    return this.prisma.tx(async (tx) => {
      const f = await tx.party.create({ data: newSupplier({ ...this.fields(input), createdById: user.id }), omit: customerOnly });
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "factory", entityId: f.id, summary: `Added factory ${f.name}` });
      return f;
    });
  }

  /** Factories from an uploaded file: a name already known is left out; the rest are added together, or none are. */
  async importMany(user: SessionUser, input: FactoryImport): Promise<ImportResult> {
    const known = new Set(
      (await this.prisma.db.party.findMany({ where: { ...isSupplier, deletedAt: null }, select: { name: true } })).map((f) => f.name.trim().toLowerCase()),
    );
    const skipped: ImportResult["skipped"] = [];
    const fresh: FactoryInput[] = [];
    for (const f of input.factories) {
      const key = f.name.trim().toLowerCase();
      if (known.has(key)) {
        skipped.push({ name: f.name, reason: "already a factory" });
        continue;
      }
      known.add(key);
      fresh.push({ ...f, ownerId: null });
    }
    const from = input.fileName ? ` from ${input.fileName}` : " from a file";
    await this.prisma.tx(async (tx) => {
      for (const f of fresh) {
        const row = await tx.party.create({ data: newSupplier({ ...this.fields(f), createdById: user.id }) });
        await this.audit.record(tx, { userId: user.id, action: "create", entityType: "factory", entityId: row.id, summary: `Added factory ${row.name}${from}` });
      }
    });
    return { added: fresh.length, skipped };
  }

  async update(user: SessionUser, id: string, input: FactoryInput) {
    const before = await this.get(id);
    await this.assertUniqueName(input.name, id);
    await this.assertOwner(input.ownerId);
    const ownerId = input.ownerId ?? null;
    // Renaming, or handing the factory from one person to another, says why.
    const renamed = before.name !== input.name;
    const handedOver = before.ownerId !== null && before.ownerId !== ownerId;
    const reason = renamed || handedOver ? requireReason(input.reason, "factoryDetails", renamed ? "the factory's name changes" : "another person looks after this factory") : input.reason;
    return this.prisma.tx(async (tx) => {
      const f = await tx.party.update({ where: { ...isSupplier, id }, data: this.fields(input), omit: customerOnly, include: { owner: ownerSelect } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "factory",
        entityId: id,
        summary: `Edited factory ${f.name}`,
        oldValues: { name: before.name, contactPerson: before.contactPerson, phone: before.phone, wechat: before.wechat, email: before.email, address: before.address, bankDetails: before.bankDetails, lookedAfterBy: before.owner?.name ?? null },
        newValues: { name: f.name, contactPerson: f.contactPerson, phone: f.phone, wechat: f.wechat, email: f.email, address: f.address, bankDetails: f.bankDetails, lookedAfterBy: f.owner?.name ?? null },
        reason,
      });
      return f;
    });
  }

  /** Hidden from lists and pickers; its past prices stay on their deals. */
  async remove(user: SessionUser, id: string) {
    if (!can(user, "inquiries.updateAny")) throw new ForbiddenError("Only a manager can remove a factory.");
    const f = await this.get(id);
    await this.prisma.tx(async (tx) => {
      await tx.party.update({ where: { ...isSupplier, id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "factory", entityId: id, summary: `Removed factory ${f.name}` });
    });
  }
}
