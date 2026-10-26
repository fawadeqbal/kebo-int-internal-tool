import { Injectable } from "@nestjs/common";
import type { Prisma } from "@kebo/database";
import { can, type CustomerInput, type ListQuery } from "@kebo/shared";
import { DomainError, DuplicateError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import type { SessionUser } from "../../common/auth/session-user";

/** Staff see the customers on deals they handle or created, and customers they added; managers see all. */
export function customerAccess(user: SessionUser): Prisma.CustomerWhereInput {
  if (can(user.role, "inquiries.viewAll")) return {};
  return {
    OR: [{ createdById: user.id }, { inquiries: { some: { deletedAt: null, OR: [{ assigneeId: user.id }, { createdById: user.id }] } } }],
  };
}

const digits = (v: string | null | undefined) => (v ? v.replace(/\D/g, "") : "");

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: SessionUser, q: ListQuery & { country?: string }) {
    const term = q.q?.trim();
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...customerAccess(user),
      ...(q.country ? { country: q.country } : {}),
      ...(term
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: term, mode: "insensitive" } },
                  { contacts: { some: { deletedAt: null, OR: [{ name: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { phone: { contains: term.replace(/[^\d+]/g, "") || term } }] } } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.customer.findMany({
        where,
        include: {
          contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }], take: 1 },
          _count: { select: { inquiries: { where: { deletedAt: null, stage: { in: ["new", "sourcing", "quoted"] } } }, orders: { where: { status: "open" } } } },
        },
        orderBy: { name: "asc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.db.customer.count({ where }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      rows: rows.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        country: c.country,
        primaryContact: c.contacts[0] ?? null,
        openDeals: c._count.inquiries,
        openOrders: c._count.orders,
      })),
    };
  }

  async get(user: SessionUser, id: string) {
    const mine = can(user.role, "inquiries.viewAll") ? null : { OR: [{ assigneeId: user.id }, { createdById: user.id }] };
    const c = await this.prisma.db.customer.findFirst({
      where: { id, deletedAt: null, ...customerAccess(user) },
      include: {
        contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
        inquiries: {
          where: { deletedAt: null, ...(mine ?? {}) },
          select: { id: true, refNo: true, title: true, stage: true, onHold: true, createdAt: true, assignee: { select: { id: true, name: true } } },
          orderBy: { createdAt: "desc" },
          take: 100,
        },
        // Staff see only the orders of deals they handle or created, like everywhere else.
        orders: { where: mine ? { inquiry: mine } : {}, select: { id: true, refNo: true, status: true, total: true, currency: true, orderedOn: true }, orderBy: { orderedOn: "desc" }, take: 100 },
      },
    });
    if (!c) throw new NotFoundError("Customer");
    return c;
  }

  /**
   * Contacts elsewhere that share an email, phone or WhatsApp number with the
   * ones being saved: probably the same customer entered twice.
   */
  private async duplicates(input: CustomerInput, exceptCustomerId?: string) {
    const emails = input.contacts.map((c) => c.email).filter((v): v is string => !!v);
    const numbers = input.contacts.flatMap((c) => [digits(c.phone), digits(c.whatsapp)]).filter((v) => v.length >= 7);
    if (!emails.length && !numbers.length) return [];
    const rows = await this.prisma.db.$queryRaw<{ id: string; name: string; contact: string }[]>`
      select distinct c.id, c.name, ct.name as contact
        from contacts ct join customers c on c.id = ct.customer_id
       where ct.deleted_at is null and c.deleted_at is null
         and (${exceptCustomerId ?? null}::uuid is null or c.id <> ${exceptCustomerId ?? null}::uuid)
         and (lower(ct.email) = any(${emails.map((e) => e.toLowerCase())})
              or regexp_replace(coalesce(ct.phone, ''), '\\D', '', 'g') = any(${numbers})
              or regexp_replace(coalesce(ct.whatsapp, ''), '\\D', '', 'g') = any(${numbers}))
       limit 5`;
    return rows.map((r) => ({ id: r.id, label: r.name, detail: r.contact }));
  }

  private contactRows(input: CustomerInput) {
    // Exactly one primary contact: the one marked, else the first.
    const primary = Math.max(input.contacts.findIndex((c) => c.isPrimary), 0);
    return input.contacts.map((c, i) => ({
      name: c.name,
      position: c.position,
      email: c.email,
      phone: c.phone,
      whatsapp: c.whatsapp,
      wechat: c.wechat,
      isPrimary: i === primary,
    }));
  }

  private fields(input: CustomerInput) {
    return {
      type: input.type,
      name: input.name,
      country: input.country,
      address: input.address,
      taxNo: input.taxNo,
      defaultCurrency: input.defaultCurrency,
      notes: input.notes,
    };
  }

  async create(user: SessionUser, input: CustomerInput) {
    if (!input.allowDuplicate) {
      const matches = await this.duplicates(input);
      if (matches.length) throw new DuplicateError("A customer with the same email or phone already exists. Use it, or save anyway.", matches);
    }
    return this.prisma.tx(async (tx) => {
      const c = await tx.customer.create({
        data: { ...this.fields(input), createdById: user.id, contacts: { create: this.contactRows(input) } },
        include: { contacts: true },
      });
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "customer", entityId: c.id, summary: `Added customer ${c.name} (${c.country})` });
      return c;
    });
  }

  /** Contacts keep their ids (deals point at them); removed ones are soft-deleted. */
  async update(user: SessionUser, id: string, input: CustomerInput) {
    const existing = await this.get(user, id);
    if (!input.allowDuplicate) {
      const matches = await this.duplicates(input, id);
      if (matches.length) throw new DuplicateError("Another customer has the same email or phone. Save anyway if they are different.", matches);
    }
    const known = new Set(existing.contacts.map((c) => c.id));
    const rows = this.contactRows(input);
    return this.prisma.tx(async (tx) => {
      // Clear the primary flag first so the one-primary index never sees two at once.
      await tx.contact.updateMany({ where: { customerId: id }, data: { isPrimary: false } });
      const keep = input.contacts.map((c) => c.id).filter((cid): cid is string => !!cid && known.has(cid));
      await tx.contact.updateMany({ where: { customerId: id, deletedAt: null, id: { notIn: keep } }, data: { deletedAt: new Date() } });
      for (const [i, c] of input.contacts.entries()) {
        if (c.id && known.has(c.id)) await tx.contact.update({ where: { id: c.id }, data: rows[i] });
        else await tx.contact.create({ data: { ...rows[i], customerId: id } });
      }
      const updated = await tx.customer.update({ where: { id }, data: this.fields(input), include: { contacts: { where: { deletedAt: null } } } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "customer",
        entityId: id,
        summary: `Edited customer ${updated.name}`,
        oldValues: { type: existing.type, name: existing.name, country: existing.country, address: existing.address, taxNo: existing.taxNo, defaultCurrency: existing.defaultCurrency, notes: existing.notes },
        newValues: this.fields(input),
      });
      return updated;
    });
  }

  async remove(user: SessionUser, id: string) {
    const c = await this.get(user, id);
    const open = await this.prisma.db.order.count({ where: { customerId: id, status: "open" } });
    if (open) throw new DomainError("This customer has open orders, so they cannot be removed.");
    await this.prisma.tx(async (tx) => {
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "customer", entityId: id, summary: `Removed customer ${c.name}` });
    });
  }
}
