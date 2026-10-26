import { Injectable } from "@nestjs/common";
import type { Prisma } from "@kebo/database";
import { can, type FactoryInput, type ListQuery } from "@kebo/shared";
import { ConflictError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import type { SessionUser } from "../../common/auth/session-user";

/** Factories are shared by the whole team (staff source from them); only managers remove one. */
@Injectable()
export class FactoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: ListQuery) {
    const where: Prisma.FactoryWhereInput = {
      deletedAt: null,
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { contactPerson: { contains: q.q, mode: "insensitive" } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.factory.findMany({
        where,
        include: { _count: { select: { quotes: { where: { deletedAt: null } } } } },
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

  async create(user: SessionUser, input: FactoryInput) {
    await this.assertUniqueName(input.name);
    return this.prisma.tx(async (tx) => {
      const f = await tx.factory.create({ data: { ...input, createdById: user.id } });
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "factory", entityId: f.id, summary: `Added factory ${f.name}` });
      return f;
    });
  }

  async update(user: SessionUser, id: string, input: FactoryInput) {
    const before = await this.get(id);
    await this.assertUniqueName(input.name, id);
    return this.prisma.tx(async (tx) => {
      const f = await tx.factory.update({ where: { id }, data: input });
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "factory", entityId: id, summary: `Edited factory ${f.name}`, oldValues: { name: before.name, defaultVatRate: before.defaultVatRate.toString() }, newValues: { name: input.name, defaultVatRate: input.defaultVatRate } });
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
