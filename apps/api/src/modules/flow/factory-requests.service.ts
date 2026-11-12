import { Injectable } from "@nestjs/common";
import { fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull, isSupplier } from "@kebo/database";
import { can, FACTORY_REQUEST_STATUS_LABEL, type FactoryRequestsInput, type FactoryRequestUpdateInput, type RequestChannel } from "@kebo/shared";
import { daysBetween, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { inquiryAccess } from "../inquiries/inquiries.service";

/**
 * Asking factories for a price: the inquiry's spec goes to several factories,
 * each one a request that is answered (an offer entered on Factory prices),
 * declined, or left without a reply. Factory names and prices are internal, so
 * only people who manage sourcing see or change these.
 */
@Injectable()
export class FactoryRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
  ) {}

  private async must(user: SessionUser) {
    await this.limits.require("factory_requests");
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot ask factories for prices.");
  }

  private async inquiry(user: SessionUser, id: string) {
    const i = await this.prisma.db.inquiry.findFirst({ where: { id, deletedAt: null, ...inquiryAccess(user) }, select: { id: true, refNo: true, stage: true, category: true } });
    if (!i) throw new NotFoundError("Inquiry");
    return i;
  }

  /** The factories asked, with whether each answered; an offer entered for the factory counts as its answer. */
  async list(user: SessionUser, inquiryId: string) {
    await this.must(user);
    const inquiry = await this.inquiry(user, inquiryId);
    const [rows, offers, factories, lastAsked, offerCounts, wins] = await Promise.all([
      this.prisma.db.factoryRequest.findMany({
        where: { inquiryId },
        orderBy: { createdAt: "asc" },
        include: { factory: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
      }),
      this.prisma.db.factoryQuote.findMany({ where: { inquiryId, deletedAt: null }, select: { id: true, factoryId: true }, orderBy: { createdAt: "asc" } }),
      this.prisma.db.party.findMany({ where: { ...isSupplier, deletedAt: null }, select: { id: true, name: true, createdAt: true, contacts: { where: { deletedAt: null }, select: { name: true, isPrimary: true, wechat: true, email: true, phone: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } }, orderBy: { name: "asc" }, take: 500 }),
      this.prisma.db.factoryRequest.groupBy({ by: ["factoryId"], _max: { sentOn: true } }),
      this.prisma.db.factoryQuote.groupBy({ by: ["factoryId"], where: { deletedAt: null }, _count: { _all: true } }),
      // Orders each factory supplied, and how many of them were in this inquiry's category.
      this.prisma.db.$queryRaw<{ factoryId: string; won: number; inCategory: number }[]>`
        select f.factory_id as "factoryId", count(distinct f.order_id)::int as won,
               count(distinct f.order_id) filter (where lower(i.category) = lower(${inquiry.category}))::int as "inCategory"
        from factory_order_facts f join orders o on o.id = f.order_id join inquiries i on i.id = o.inquiry_id
        where f.status <> 'cancelled' group by f.factory_id`,
    ]);
    const today = this.clock.today();
    const items = rows.map((r) => {
      const offer = r.factoryQuoteId ?? offers.find((q) => q.factoryId === r.factoryId)?.id ?? null;
      const status = r.status === "sent" && offer ? "quoted" : r.status;
      const replyBy = fromDbDateOrNull(r.replyBy);
      return {
        id: r.id,
        factory: r.factory,
        status,
        statusLabel: FACTORY_REQUEST_STATUS_LABEL[status],
        sentOn: fromDbDate(r.sentOn),
        replyBy,
        late: status === "sent" && !!replyBy && replyBy < today,
        channel: r.channel as RequestChannel | null,
        /** Days since asked, while still waiting. */
        waitingDays: status === "sent" ? daysBetween(fromDbDate(r.sentOn), today) : null,
        factoryQuoteId: offer,
        note: r.note,
        by: r.createdBy,
      };
    });
    // The factories to choose from: the ones asked most recently first, then the others by name.
    const last = new Map(lastAsked.map((l) => [l.factoryId, l._max.sentOn ? fromDbDate(l._max.sentOn) : null]));
    const offersBy = new Map(offerCounts.map((c) => [c.factoryId, c._count._all]));
    const asked = new Set(rows.map((r) => r.factoryId));
    const won = new Map(wins.map((w) => [w.factoryId, w]));
    const recent = Date.now() - 14 * 86_400_000;
    const suggestions = factories
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

  async ask(user: SessionUser, inquiryId: string, input: FactoryRequestsInput) {
    await this.must(user);
    const today = this.clock.today();
    if (input.sentOn && input.sentOn > today) throw new DomainError("The date sent cannot be in the future.");
    if (input.replyBy && input.replyBy < (input.sentOn ?? today)) throw new DomainError("The reply-by date cannot be before the date sent.");
    const ids = [...new Set(input.factoryIds)];
    await this.prisma.tx(async (tx) => {
      const i = await tx.inquiry.findFirst({ where: { id: inquiryId, deletedAt: null, ...inquiryAccess(user) }, select: { id: true, refNo: true, stage: true } });
      if (!i) throw new NotFoundError("Inquiry");
      if (i.stage === "won" || i.stage === "lost") throw new DomainError("This deal is closed.");
      const factories = await tx.party.findMany({ where: { ...isSupplier, id: { in: ids }, deletedAt: null }, select: { id: true, name: true } });
      if (factories.length !== ids.length) throw new DomainError("One of the factories is not in your list any more.");
      const already = new Set((await tx.factoryRequest.findMany({ where: { inquiryId, factoryId: { in: ids } }, select: { factoryId: true } })).map((r) => r.factoryId));
      const fresh = factories.filter((f) => !already.has(f.id));
      if (!fresh.length) return;
      await tx.factoryRequest.createMany({
        data: fresh.map((f) => ({
          inquiryId,
          factoryId: f.id,
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
        summary: `${i.refNo}: asked ${fresh.length === 1 ? fresh[0].name : `${fresh.length} factories`} for a price`,
        newValues: { factories: fresh.map((f) => f.name), replyBy: input.replyBy },
      });
    });
    return this.list(user, inquiryId);
  }

  async update(user: SessionUser, id: string, input: FactoryRequestUpdateInput) {
    await this.must(user);
    const r = await this.prisma.db.factoryRequest.findUnique({ where: { id }, include: { factory: { select: { name: true } } } });
    if (!r) throw new NotFoundError("Request");
    const i = await this.inquiry(user, r.inquiryId);
    if (input.factoryQuoteId) {
      const q = await this.prisma.db.factoryQuote.findFirst({ where: { id: input.factoryQuoteId, inquiryId: r.inquiryId, factoryId: r.factoryId, deletedAt: null } });
      if (!q) throw new DomainError("That offer is not this factory's offer on this inquiry.");
    }
    await this.prisma.tx(async (tx) => {
      await tx.factoryRequest.update({
        where: { id },
        data: {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.replyBy !== undefined && { replyBy: toDbDateOrNull(input.replyBy) }),
          ...(input.channel !== undefined && { channel: input.channel }),
          ...(input.factoryQuoteId !== undefined && { factoryQuoteId: input.factoryQuoteId }),
          ...(input.note !== undefined && { note: input.note }),
        },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "inquiry",
        entityId: r.inquiryId,
        summary: `${i.refNo}: request to ${r.factory.name}${input.status ? ` marked ${FACTORY_REQUEST_STATUS_LABEL[input.status].toLowerCase()}` : " changed"}`,
        oldValues: { status: r.status },
        newValues: input,
      });
    });
    return this.list(user, r.inquiryId);
  }

  async remove(user: SessionUser, id: string) {
    await this.must(user);
    const r = await this.prisma.db.factoryRequest.findUnique({ where: { id }, include: { factory: { select: { name: true } } } });
    if (!r) throw new NotFoundError("Request");
    const i = await this.inquiry(user, r.inquiryId);
    await this.prisma.tx(async (tx) => {
      await tx.factoryRequest.delete({ where: { id } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "inquiry", entityId: r.inquiryId, summary: `${i.refNo}: request to ${r.factory.name} removed` });
    });
    return this.list(user, r.inquiryId);
  }
}
