import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull } from "@kebo/database";
import { convertMinor, fxRate, withTaxMinor, fromMinor } from "@kebo/money";
import { can, coverage, lineNumbers, taxSentence, type FactoryQuoteInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { InquiriesService } from "../inquiries/inquiries.service";
import { StagesService } from "../inquiries/stages.service";
import { requireReason } from "../../common/audit/reason";

/**
 * Factory offers for a deal (internal: never shown to customers). Each offer is
 * one factory's lines as it gave them — its models, quantities and breakdown
 * into parts — each saying which of the customer's items it answers. Each
 * line's cost is worked out in the selling currency: the factory price
 * (without tax) plus its tax %, converted at today's rate. A quotation offers
 * one or more whole offers as options A, B…
 */
@Injectable()
export class SourcingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly settings: SettingsService,
    private readonly inquiries: InquiriesService,
    private readonly stages: StagesService,
  ) {}

  private assertCan(user: SessionUser) {
    if (!can(user.role, "sourcing.manage")) throw new ForbiddenError("You cannot see factory prices.");
  }

  /** Every offer with its lines (numbered, parts under their line), costs in the selling currency and which items it covers; per item the prices cheapest first. */
  async forInquiry(user: SessionUser, inquiryId: string) {
    this.assertCan(user);
    await this.inquiries.find(user, inquiryId);
    const { sales } = await this.settings.get();
    const [items, quotes] = await Promise.all([
      this.prisma.db.requestedItem.findMany({ where: { inquiryId }, orderBy: { sortOrder: "asc" } }),
      this.prisma.db.factoryQuote.findMany({
        where: { inquiryId, deletedAt: null },
        include: { factory: { select: { id: true, name: true } }, lines: { orderBy: { sortOrder: "asc" } } },
        orderBy: { receivedOn: "desc" },
      }),
    ]);
    const numbers = lineNumbers(items.map((it) => ({ key: it.id, parentKey: it.parentId })));
    const itemRefs = items.map((it, n) => ({ id: it.id, parentId: it.parentId, no: numbers[n]! }));
    const priced = quotes.map((q) => {
      const rate = fxRate(q.currency, sales.currency, sales.currency, sales.exchangeRates);
      const lineNo = lineNumbers(q.lines.map((l) => ({ key: l.id, parentKey: l.parentId })));
      const lines = q.lines.map((l, n) => {
        const taxRate = Number(l.taxRate);
        const unitPriceMinor = decimalToMinor(l.unitPrice);
        const costInFactoryCurrency = withTaxMinor(unitPriceMinor, taxRate);
        const cost = rate ? convertMinor(costInFactoryCurrency, rate) : null;
        return {
          id: l.id,
          /** "1", "2", "2.1" within this offer. */
          no: lineNo[n]!,
          parentId: l.parentId,
          requestedItemId: l.requestedItemId,
          /** The customer's item it answers, by number ("2"). */
          answersNo: itemRefs.find((i) => i.id === l.requestedItemId)?.no ?? null,
          description: l.description,
          model: l.model,
          quantity: l.quantity.toString(),
          unit: l.unit,
          unitPrice: l.unitPrice.toFixed(2),
          /** Tax % added on top of the price. */
          taxRate,
          /** e.g. "CNY 100.00 + 13% tax = CNY 113.00" (in the factory's currency). */
          costNote: taxSentence(unitPriceMinor, taxRate, q.currency),
          /** One unit's landed cost in the selling currency. */
          unitCost: cost === null ? null : fromMinor(cost),
          costMinor: cost === null ? null : Math.round(cost * Number(l.quantity)),
        };
      });
      return {
        id: q.id,
        factory: q.factory,
        reference: q.reference,
        receivedOn: fromDbDate(q.receivedOn),
        validUntil: fromDbDateOrNull(q.validUntil),
        currency: q.currency,
        priceBasis: q.priceBasis,
        leadTime: q.leadTime,
        moq: q.moq,
        paymentTerms: q.paymentTerms,
        notes: q.notes,
        /** null when the exchange rate for this currency is missing in Settings. */
        fxRate: rate,
        lines: lines.map(({ costMinor: _c, ...l }) => l),
        /** What the whole offer costs us in the selling currency (null when a rate is missing). */
        totalCost: rate === null ? null : fromMinor(lines.reduce((t, l) => t + (l.costMinor ?? 0), 0)),
        /** Which of the customer's items it answers, and which it misses. */
        coverage: coverage(
          itemRefs,
          q.lines.map((l) => l.requestedItemId),
        ),
      };
    });
    const rank = (cost: string | null) => (cost === null ? Number.MAX_VALUE : Number(cost) > 0 ? Number(cost) : Number.MAX_VALUE / 2);
    const allLines = priced.flatMap((q) => q.lines.map((l) => ({ ...l, factory: q.factory, quoteId: q.id, currency: q.currency })));
    return {
      currency: sales.currency,
      missingRates: [...new Set(priced.filter((q) => q.fxRate === null).map((q) => q.currency))],
      quotes: priced,
      items: items.map((it, n) => {
        const options = allLines
          .filter((l) => l.requestedItemId === it.id)
          // A line at 0 is priced in its parts (or included): it goes last and is never "cheapest".
          .sort((a, b) => rank(a.unitCost) - rank(b.unitCost));
        return {
          id: it.id,
          /** "2", "2.1" (a part of item 2). */
          no: numbers[n],
          parentId: it.parentId,
          hasParts: items.some((p) => p.parentId === it.id),
          description: it.description,
          model: it.model,
          quantity: it.quantity.toString(),
          unit: it.unit,
          cheapestLineId: options.find((o) => o.unitCost !== null && Number(o.unitCost) > 0)?.id ?? null,
          options,
        };
      }),
    };
  }

  /** An existing factory, a known one with the same name, or a new one. */
  private async factoryFor(tx: Tx, user: SessionUser, input: FactoryQuoteInput) {
    if (input.factoryId) {
      const f = await tx.factory.findFirst({ where: { id: input.factoryId, deletedAt: null } });
      if (!f) throw new DomainError("That factory was removed. Choose another one.");
      return f;
    }
    const name = input.newFactoryName!.trim().replace(/\s+/g, " ");
    const known = await tx.factory.findFirst({ where: { deletedAt: null, name: { equals: name, mode: "insensitive" } } });
    if (known) return known;
    const f = await tx.factory.create({ data: { name, createdById: user.id, ownerId: user.id } });
    await this.audit.record(tx, {
      userId: user.id,
      action: "create",
      entityType: "factory",
      entityId: f.id,
      summary: `Added factory ${f.name}`,
    });
    return f;
  }

  /**
   * Lines keep their ids (quotation lines point at them). Item links must be this
   * deal's items. A part (partOf) points at an earlier line that is not a part itself.
   */
  private async writeLines(tx: Tx, quoteId: string, inquiryId: string, lines: FactoryQuoteInput["lines"]) {
    for (const [n, l] of lines.entries()) {
      if (l.partOf === null) continue;
      if (l.partOf >= n || lines[l.partOf]!.partOf !== null)
        throw new DomainError(`"${l.description.split("\n")[0]}" can only be a part of a line above it that is not a part itself.`);
    }
    const own = new Set((await tx.requestedItem.findMany({ where: { inquiryId }, select: { id: true } })).map((r) => r.id));
    const existing = new Set(
      (await tx.factoryQuoteLine.findMany({ where: { factoryQuoteId: quoteId }, select: { id: true } })).map((r) => r.id),
    );
    const keep = lines.map((l) => l.id).filter((id): id is string => !!id && existing.has(id));
    const dropped = [...existing].filter((id) => !keep.includes(id));
    if (dropped.length) {
      await tx.factoryQuoteLine.updateMany({ where: { parentId: { in: dropped } }, data: { parentId: null } });
      await tx.factoryQuoteLine.deleteMany({ where: { id: { in: dropped } } });
    }
    const ids: string[] = [];
    for (const [n, l] of lines.entries()) {
      if (l.requestedItemId && !own.has(l.requestedItemId))
        throw new DomainError("A price is linked to an item that is not on this deal. Reload and try again.");
      const row = {
        requestedItemId: l.requestedItemId,
        description: l.description,
        model: l.model,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        taxRate: l.taxRate,
        sortOrder: n,
        parentId: l.partOf === null ? null : ids[l.partOf]!,
      };
      if (l.id && existing.has(l.id)) ids.push((await tx.factoryQuoteLine.update({ where: { id: l.id }, data: row })).id);
      else ids.push((await tx.factoryQuoteLine.create({ data: { ...row, factoryQuoteId: quoteId } })).id);
    }
  }

  private header(input: FactoryQuoteInput) {
    return {
      reference: input.reference,
      receivedOn: toDbDate(input.receivedOn),
      validUntil: toDbDateOrNull(input.validUntil),
      currency: input.currency,
      priceBasis: input.priceBasis,
      leadTime: input.leadTime,
      moq: input.moq,
      paymentTerms: input.paymentTerms,
      notes: input.notes,
    };
  }

  async create(user: SessionUser, inquiryId: string, input: FactoryQuoteInput) {
    this.assertCan(user);
    const events: DomainEvent[] = [];
    const quote = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from inquiries where id = ${inquiryId}::uuid for update`;
      const inquiry = await this.inquiries.findWorkable(user, inquiryId, tx);
      const factory = await this.factoryFor(tx, user, input);
      const q = await tx.factoryQuote.create({ data: { ...this.header(input), inquiryId, factoryId: factory.id, createdById: user.id } });
      await this.writeLines(tx, q.id, inquiryId, input.lines);
      await this.audit.record(tx, {
        userId: user.id,
        action: "create",
        entityType: "factory_quote",
        entityId: q.id,
        summary: `${inquiry.refNo}: prices from ${factory.name} (${input.lines.length} lines, ${input.currency})`,
      });
      const moved = await this.stages.after(tx, inquiry, "factory_price_added", user.id);
      if (moved) events.push(moved);
      return q;
    });
    await this.events.publish(...events);
    return quote;
  }

  private async findQuote(user: SessionUser, quoteId: string, tx: Tx) {
    const q = await tx.factoryQuote.findFirst({ where: { id: quoteId, deletedAt: null } });
    if (!q) throw new NotFoundError("Factory prices");
    const inquiry = await this.inquiries.findWorkable(user, q.inquiryId, tx);
    return { q, inquiry };
  }

  /** This quote's lines that a quotation (any revision) is priced from. */
  private async usedLines(tx: Tx, quoteId: string) {
    const lines = await tx.factoryQuoteLine.findMany({
      where: { factoryQuoteId: quoteId, quoteLines: { some: { revision: { deletedAt: null } } } },
    });
    return new Map(lines.map((l) => [l.id, l]));
  }

  async update(user: SessionUser, quoteId: string, input: FactoryQuoteInput) {
    this.assertCan(user);
    return this.prisma.tx(async (tx) => {
      const { q, inquiry } = await this.findQuote(user, quoteId, tx);
      const factory = await this.factoryFor(tx, user, input);
      // Changing a price a quotation uses (or whose factory it is) needs a reason.
      const used = await this.usedLines(tx, quoteId);
      const changes: string[] = [];
      if (used.size && factory.id !== q.factoryId) changes.push("factory changed");
      for (const [id, l] of used) {
        const next = input.lines.find((x) => x.id === id);
        if (!next) changes.push(`removed ${l.description}`);
        else if (
          Number(next.unitPrice) !== Number(l.unitPrice) ||
          Number(next.taxRate) !== Number(l.taxRate) ||
          Number(next.quantity) !== Number(l.quantity)
        )
          changes.push(
            `${l.description}: ${l.unitPrice.toFixed(2)} → ${Number(next.unitPrice).toFixed(2)}${Number(next.taxRate) !== Number(l.taxRate) ? `, tax ${Number(l.taxRate)}% → ${Number(next.taxRate)}%` : ""}${Number(next.quantity) !== Number(l.quantity) ? `, qty ${l.quantity.toString()} → ${next.quantity}` : ""}`,
          );
      }
      const reason = changes.length
        ? requireReason(input.reason, "factoryPrice", "you are changing prices a quotation uses")
        : input.reason;
      const updated = await tx.factoryQuote.update({ where: { id: quoteId }, data: { ...this.header(input), factoryId: factory.id } });
      await this.writeLines(tx, quoteId, q.inquiryId, input.lines);
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "factory_quote",
        entityId: quoteId,
        summary: `${inquiry.refNo}: edited prices from ${factory.name}${changes.length ? ` (${changes.join("; ")})` : ""}`,
        reason,
      });
      return updated;
    });
  }

  /** Removed from the deal. Quotations keep their own copy of the lines and costs. */
  async remove(user: SessionUser, quoteId: string, reasonInput?: string) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { inquiry } = await this.findQuote(user, quoteId, tx);
      const reason = (await this.usedLines(tx, quoteId)).size
        ? requireReason(reasonInput, "factoryPrice", "you are removing prices a quotation uses")
        : reasonInput;
      await tx.factoryQuote.update({ where: { id: quoteId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "delete",
        entityType: "factory_quote",
        entityId: quoteId,
        summary: `${inquiry.refNo}: removed factory prices`,
        reason,
      });
    });
  }
}
