import { Injectable } from "@nestjs/common";
import { fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull, isSupplier } from "@kebo/database";
import { can, SUPPLIER_REQUEST_STATUS_LABEL, type SupplierRequestsInput, type SupplierRequestUpdateInput, type RequestChannel } from "@kebo/shared";
import { daysBetween, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { inquiryAccess } from "../inquiries/inquiries.service";

/**
 * Asking suppliers for a price: the inquiry's spec goes to several suppliers,
 * each one a request that is answered (an offer entered on Supplier prices),
 * declined, or left without a reply. Supplier names and prices are internal, so
 * only people who manage sourcing see or change these.
 */
@Injectable()
export class SupplierRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
  ) {}

  private async must(user: SessionUser) {
    await this.limits.require("factory_requests");
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot ask suppliers for prices.");
  }

  private async inquiry(user: SessionUser, id: string) {
    const i = await this.prisma.db.inquiry.findFirst({ where: { id, deletedAt: null, ...inquiryAccess(user) }, select: { id: true, refNo: true, stage: true, category: true } });
    if (!i) throw new NotFoundError("Inquiry");
    return i;
  }

  /** The suppliers asked, with whether each answered; an offer entered for the supplier counts as its answer. */
  async list(user: SessionUser, inquiryId: string) {
    await this.must(user);
    const inquiry = await this.inquiry(user, inquiryId);
    const [rows, offers, suppliers, lastAsked, offerCounts, wins] = await Promise.all([
      this.prisma.db.supplierRequest.findMany({
        where: { inquiryId },
        orderBy: { createdAt: "asc" },
        include: { supplier: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.db.supplierQuote.findMany({ where: { inquiryId, deletedAt: null }, select: { id: true, supplierId: true }, orderBy: { createdAt: "asc" } }),
      this.prisma.db.party.findMany({ where: { ...isSupplier, deletedAt: null }, select: { id: true, name: true, createdAt: true, contacts: { where: { deletedAt: null }, select: { name: true, isPrimary: true, wechat: true, email: true, phone: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } }, orderBy: { name: "asc" }, take: 500 }),
      this.prisma.db.supplierRequest.groupBy({ by: ["supplierId"], _max: { sentOn: true } }),
      this.prisma.db.supplierQuote.groupBy({ by: ["supplierId"], where: { deletedAt: null }, _count: { _all: true } }),
      // Orders each supplier supplied, and how many of them were in this inquiry's category.
      this.prisma.db.$queryRaw<{ supplierId: string; won: number; inCategory: number }[]>`
        select f.factory_id as "supplierId", count(distinct f.order_id)::int as won,
               count(distinct f.order_id) filter (where lower(i.category) = lower(${inquiry.category}))::int as "inCategory"
        from factory_order_facts f join orders o on o.id = f.order_id join inquiries i on i.id = o.inquiry_id
        where f.status <> 'cancelled' group by f.factory_id`,
    ]);
    const today = this.clock.today();
    const items = rows.map((r) => {
      const offer = r.supplierQuoteId ?? offers.find((q) => q.supplierId === r.supplierId)?.id ?? null;
      const status = r.status === "sent" && offer ? "quoted" : r.status;
      const replyBy = fromDbDateOrNull(r.replyBy);
      return {
        id: r.id,
        supplier: r.supplier,
        status,
        statusLabel: SUPPLIER_REQUEST_STATUS_LABEL[status],
        sentOn: fromDbDate(r.sentOn),
        replyBy,
        late: status === "sent" && !!replyBy && replyBy < today,
        channel: r.channel as RequestChannel | null,
        /** Days since asked, while still waiting. */
        waitingDays: status === "sent" ? daysBetween(fromDbDate(r.sentOn), today) : null,
        supplierQuoteId: offer,
        note: r.note,
        by: r.createdBy,
      };
    });
    // The suppliers to choose from: the ones asked most recently first, then the others by name.
    const last = new Map(lastAsked.map((l) => [l.supplierId, l._max.sentOn ? fromDbDate(l._max.sentOn) : null]));
    const offersBy = new Map(offerCounts.map((c) => [c.supplierId, c._count._all]));
    const asked = new Set(rows.map((r) => r.supplierId));
    const won = new Map(wins.map((w) => [w.supplierId, w]));
    const recent = Date.now() - 14 * 86_400_000;
    const suggestions = suppliers
      .map((f) => ({
        id: f.id,
        name: f.name,
        /** Their main person and WeChat id, as the list shows them. */
        contact: f.contacts[0]?.name ?? null,
        wechat: f.contacts.find((c) => c.wechat)?.wechat ?? null,
        /** Orders they supplied; `goodAt`: some of them in this inquiry's category. */
        won: won.get(f.id)?.won ?? 0,
        goodAt: (won.get(f.id)?.inCategory ?? 0) > 0 ? inquiry.category : null,
        /** Added in the last two weeks. */
        isNew: f.createdAt.getTime() > recent,
        // How it can be reached: any of its people's WeChat, email or phone.
        reach: [f.contacts.some((c) => c.wechat) && "WeChat", f.contacts.some((c) => c.email) && "email", f.contacts.some((c) => c.phone) && "phone"].filter(Boolean).join(", ") || null,
        lastAskedOn: last.get(f.id) ?? null,
        offers: offersBy.get(f.id) ?? 0,
        askedHere: asked.has(f.id),
      }))
      .sort((a, b) => (b.lastAskedOn ?? "").localeCompare(a.lastAskedOn ?? "") || b.offers - a.offers || a.name.localeCompare(b.name));
    return {
      items,
      suggestions,
      counts: {
        asked: items.length,
        quoted: items.filter((i) => i.status === "quoted").length,
        waiting: items.filter((i) => i.status === "sent").length,
        late: items.filter((i) => i.late).length,
      },
    };
  }

  async ask(user: SessionUser, inquiryId: string, input: SupplierRequestsInput) {
    await this.must(user);
    const today = this.clock.today();
    if (input.sentOn && input.sentOn > today) throw new DomainError("The date sent cannot be in the future.");
    if (input.replyBy && input.replyBy < (input.sentOn ?? today)) throw new DomainError("The reply-by date cannot be before the date sent.");
    const ids = [...new Set(input.supplierIds)];
    await this.prisma.tx(async (tx) => {
      const i = await tx.inquiry.findFirst({ where: { id: inquiryId, deletedAt: null, ...inquiryAccess(user) }, select: { id: true, refNo: true, stage: true } });
      if (!i) throw new NotFoundError("Inquiry");
      if (i.stage === "won" || i.stage === "lost") throw new DomainError("This deal is closed.");
      const suppliers = await tx.party.findMany({ where: { ...isSupplier, id: { in: ids }, deletedAt: null }, select: { id: true, name: true } });
      if (suppliers.length !== ids.length) throw new DomainError("One of the suppliers is not in your list any more.");
      const already = new Set((await tx.supplierRequest.findMany({ where: { inquiryId, supplierId: { in: ids } }, select: { supplierId: true } })).map((r) => r.supplierId));
      const fresh = suppliers.filter((f) => !already.has(f.id));
      if (!fresh.length) return;
      await tx.supplierRequest.createMany({
        data: fresh.map((f) => ({
          inquiryId,
          supplierId: f.id,
          sentOn: toDbDate(input.sentOn ?? today),
          replyBy: toDbDateOrNull(input.replyBy),
          channel: input.channel,
          note: input.note,
          createdById: user.id,
        })),
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "inquiry",
        entityId: inquiryId,
        summary: `${i.refNo}: asked ${fresh.length === 1 ? fresh[0].name : `${fresh.length} suppliers`} for a price`,
        newValues: { suppliers: fresh.map((f) => f.name), replyBy: input.replyBy },
      });
    });
    return this.list(user, inquiryId);
  }

  async update(user: SessionUser, id: string, input: SupplierRequestUpdateInput) {
    await this.must(user);
    const r = await this.prisma.db.supplierRequest.findUnique({ where: { id }, include: { supplier: { select: { name: true } } } });
    if (!r) throw new NotFoundError("Request");
    const i = await this.inquiry(user, r.inquiryId);
    if (input.supplierQuoteId) {
      const q = await this.prisma.db.supplierQuote.findFirst({ where: { id: input.supplierQuoteId, inquiryId: r.inquiryId, supplierId: r.supplierId, deletedAt: null } });
      if (!q) throw new DomainError("That offer is not this supplier's offer on this inquiry.");
    }
    await this.prisma.tx(async (tx) => {
      await tx.supplierRequest.update({
        where: { id },
        data: {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.replyBy !== undefined && { replyBy: toDbDateOrNull(input.replyBy) }),
          ...(input.channel !== undefined && { channel: input.channel }),
          ...(input.supplierQuoteId !== undefined && { supplierQuoteId: input.supplierQuoteId }),
          ...(input.note !== undefined && { note: input.note }),
        },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "inquiry",
        entityId: r.inquiryId,
        summary: `${i.refNo}: request to ${r.supplier.name}${input.status ? ` marked ${SUPPLIER_REQUEST_STATUS_LABEL[input.status].toLowerCase()}` : " changed"}`,
        oldValues: { status: r.status },
        newValues: input,
      });
    });
    return this.list(user, r.inquiryId);
  }

  async remove(user: SessionUser, id: string) {
    await this.must(user);
    const r = await this.prisma.db.supplierRequest.findUnique({ where: { id }, include: { supplier: { select: { name: true } } } });
    if (!r) throw new NotFoundError("Request");
    const i = await this.inquiry(user, r.inquiryId);
    await this.prisma.tx(async (tx) => {
      await tx.supplierRequest.delete({ where: { id } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "inquiry", entityId: r.inquiryId, summary: `${i.refNo}: request to ${r.supplier.name} removed` });
    });
    return this.list(user, r.inquiryId);
  }
}
