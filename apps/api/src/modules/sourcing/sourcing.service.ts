import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull } from "@kebo/database";
import { convertMinor, fxRate, withTaxMinor, fromMinor } from "@kebo/money";
import { can, lineNumbers, taxSentence, type FactoryQuoteInput } from "@kebo/shared";
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
 * Factory prices for a deal (internal: never shown to customers). Each line's
 * cost is worked out in the selling currency: the factory price (without tax)
 * plus the item's tax %, converted at today's rate. The quotation starts from
 * these costs plus the default margin.
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

  /** Every price for the deal with its cost in the selling currency, and per item the options cheapest first. */
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
    const priced = quotes.map((q) => {
      const rate = fxRate(q.currency, sales.currency, sales.currency, sales.exchangeRates);
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
        lines: q.lines.map((l) => {
          const taxRate = Number(l.taxRate);
          const unitPriceMinor = decimalToMinor(l.unitPrice);
          const costInFactoryCurrency = withTaxMinor(unitPriceMinor, taxRate);
          const cost = rate ? convertMinor(costInFactoryCurrency, rate) : null;
          return {
            id: l.id,
            requestedItemId: l.requestedItemId,
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
          };
        }),
      };
    });
    const numbers = lineNumbers(items.map((it) => ({ key: it.id, parentKey: it.parentId })));
    const allLines = priced.flatMap((q) => q.lines.map((l) => ({ ...l, factory: q.factory, quoteId: q.id, currency: q.currency })));
    return {
      currency: sales.currency,
      missingRates: [...new Set(priced.filter((q) => q.fxRate === null).map((q) => q.currency))],
      quotes: priced,
      items: items.map((it, n) => {
        const options = allLines
          .filter((l) => l.requestedItemId === it.id)
          .sort((a, b) => (a.unitCost === null ? 1 : b.unitCost === null ? -1 : Number(a.unitCost) - Number(b.unitCost)));
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
          preferredLineId: it.preferredFactoryLineId,
          cheapestLineId: options.find((o) => o.unitCost !== null)?.id ?? null,
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

  /** Lines keep their ids (quotation lines and preferences point at them). Item links must be this deal's items. */
  private async writeLines(tx: Tx, quoteId: string, inquiryId: string, lines: FactoryQuoteInput["lines"]) {
    const own = new Set((await tx.requestedItem.findMany({ where: { inquiryId }, select: { id: true } })).map((r) => r.id));
    const existing = new Set(
      (await tx.factoryQuoteLine.findMany({ where: { factoryQuoteId: quoteId }, select: { id: true } })).map((r) => r.id),
    );
    const keep = lines.map((l) => l.id).filter((id): id is string => !!id && existing.has(id));
    const dropped = [...existing].filter((id) => !keep.includes(id));
    if (dropped.length) {
      await tx.requestedItem.updateMany({ where: { preferredFactoryLineId: { in: dropped } }, data: { preferredFactoryLineId: null } });
      await tx.factoryQuoteLine.deleteMany({ where: { id: { in: dropped } } });
    }
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
      };
      if (l.id && existing.has(l.id)) await tx.factoryQuoteLine.update({ where: { id: l.id }, data: row });
      else await tx.factoryQuoteLine.create({ data: { ...row, factoryQuoteId: quoteId } });
    }
    // Items with no preferred price yet start with the cheapest-entered first one from this quote.
    await tx.$executeRaw`
      update requested_items ri set preferred_factory_line_id = l.id
        from factory_quote_lines l
       where l.factory_quote_id = ${quoteId}::uuid and l.requested_item_id = ri.id and ri.preferred_factory_line_id is null`;
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

  /** Removed from the deal; items that preferred one of its lines are left without a preference. Quotations keep their own copy of the cost. */
  async remove(user: SessionUser, quoteId: string, reasonInput?: string) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { inquiry } = await this.findQuote(user, quoteId, tx);
      const reason = (await this.usedLines(tx, quoteId)).size
        ? requireReason(reasonInput, "factoryPrice", "you are removing prices a quotation uses")
        : reasonInput;
      const lineIds = (await tx.factoryQuoteLine.findMany({ where: { factoryQuoteId: quoteId }, select: { id: true } })).map((l) => l.id);
      await tx.requestedItem.updateMany({ where: { preferredFactoryLineId: { in: lineIds } }, data: { preferredFactoryLineId: null } });
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

  /** Which factory price each item is quoted from by default. */
  async choose(user: SessionUser, inquiryId: string, choices: Record<string, string | null>, reasonInput?: string) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const inquiry = await this.inquiries.findWorkable(user, inquiryId, tx);
      const rows = await tx.requestedItem.findMany({
        where: { inquiryId },
        select: { id: true, description: true, preferredFactoryLineId: true },
      });
      const items = new Set(rows.map((r) => r.id));
      // Once a quotation exists, switching an item to another factory's price needs a reason.
      const quoted = await tx.quotationRevision.count({ where: { quotation: { inquiryId }, deletedAt: null } });
      const switched = rows.filter((r) => r.preferredFactoryLineId && r.id in choices && choices[r.id] !== r.preferredFactoryLineId);
      const reason =
        quoted && switched.length
          ? requireReason(reasonInput, "factoryChoice", "you are changing which factory an item is quoted from")
          : reasonInput;
      const lineIds = Object.values(choices).filter((v): v is string => !!v);
      const valid = new Set(
        (
          await tx.factoryQuoteLine.findMany({
            where: { id: { in: lineIds }, factoryQuote: { inquiryId, deletedAt: null } },
            select: { id: true },
          })
        ).map((l) => l.id),
      );
      for (const [itemId, lineId] of Object.entries(choices)) {
        if (!items.has(itemId)) continue;
        if (lineId && !valid.has(lineId)) throw new DomainError("One of the chosen prices is no longer on this deal. Reload the page.");
        await tx.requestedItem.update({ where: { id: itemId }, data: { preferredFactoryLineId: lineId } });
      }
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "inquiry",
        entityId: inquiryId,
        summary: `${inquiry.refNo}: chose the factory prices to quote from${switched.length ? ` (changed: ${switched.map((r) => r.description).join(", ")})` : ""}`,
        reason,
      });
    });
    return this.forInquiry(user, inquiryId);
  }
}
