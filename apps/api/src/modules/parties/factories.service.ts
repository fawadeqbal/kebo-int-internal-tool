import { Injectable } from "@nestjs/common";
import type { Prisma } from "@kebo/database";
import { can, type FactoryInput, type ListQuery } from "@kebo/shared";
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
    const where: Prisma.FactoryWhereInput = {
      deletedAt: null,
      ...(q.mine ? { ownerId: user.id } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { contactPerson: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.factory.findMany({
        where,
        include: { owner: ownerSelect, _count: { select: { quotes: { where: { deletedAt: null } } } } },
        orderBy: { name: "asc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.db.factory.count({ where }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, rows };
  }

  async get(id: string) {
    const f = await this.prisma.db.factory.findFirst({
      where: { id, deletedAt: null },
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
    return f;
  }

  private async assertUniqueName(name: string, exceptId?: string) {
    const clash = await this.prisma.db.factory.findFirst({ where: { deletedAt: null, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
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
      const f = await tx.factory.create({ data: { ...this.fields(input), createdById: user.id } });
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "factory", entityId: f.id, summary: `Added factory ${f.name}` });
      return f;
    });
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
      const f = await tx.factory.update({ where: { id }, data: this.fields(input), include: { owner: ownerSelect } });
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
    if (!can(user.role, "inquiries.updateAny")) throw new ForbiddenError("Only a manager can remove a factory.");
    const f = await this.get(id);
    await this.prisma.tx(async (tx) => {
      await tx.factory.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "factory", entityId: id, summary: `Removed factory ${f.name}` });
    });
  }
}
