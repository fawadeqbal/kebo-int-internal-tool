import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull } from "@kebo/database";
import { convertMinor, fxRate, unitCostMinor, fromMinor } from "@kebo/money";
import { can, costSentence, effectiveRebate, type FactoryQuoteInput, type HsCodeInput } from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { InquiriesService } from "../inquiries/inquiries.service";
import { StagesService } from "../inquiries/stages.service";

/**
 * Factory prices for a deal (internal: never shown to customers). Each line's
 * landed unit cost is worked out in the selling currency: the factory price
 * (always without tax) plus its tax %, less the export rebate for the product's
 * HS code, converted at today's rate. The quotation starts from
 * these costs plus the default margin.
 *
 * Rebate rates are remembered per HS code: the first price with a code saves its
 * rate, later prices start from it, and the list can be corrected in one place.
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
        /** Tax % added on top of these prices (they are without tax). */
        vatRate: Number(q.vatRate),
        priceBasis: q.priceBasis,
        leadTime: q.leadTime,
        moq: q.moq,
        paymentTerms: q.paymentTerms,
        notes: q.notes,
        /** null when the exchange rate for this currency is missing in Settings. */
        fxRate: rate,
        lines: q.lines.map((l) => {
          const vatRate = Number(q.vatRate);
          const rebateRate = Number(l.rebateRate);
          const unitPriceMinor = decimalToMinor(l.unitPrice);
          const costInFactoryCurrency = unitCostMinor({ unitPriceMinor, vatRate, pricesIncludeVat: false, rebateRate });
          const cost = rate ? convertMinor(costInFactoryCurrency, rate) : null;
          return {
            id: l.id,
            requestedItemId: l.requestedItemId,
            description: l.description,
            model: l.model,
            quantity: l.quantity.toString(),
            unit: l.unit,
            unitPrice: l.unitPrice.toFixed(2),
            hsCode: l.hsCode,
            rebateRate,
            /** The rebate that really comes back (never more than the tax). */
            rebateBack: effectiveRebate(rebateRate, vatRate),
            /** e.g. "CNY 100.00 + 13% tax = CNY 113.00 · 13% rebate back · your cost CNY 100.00" (in the factory's currency). */
            costNote: costSentence({ unitPriceMinor, vatRate, rebateRate, costMinor: costInFactoryCurrency, currency: q.currency }),
            /** One unit's landed cost in the selling currency. */
            unitCost: cost === null ? null : fromMinor(cost),
          };
        }),
      };
    });
    const allLines = priced.flatMap((q) => q.lines.map((l) => ({ ...l, factory: q.factory, quoteId: q.id, currency: q.currency })));
    return {
      currency: sales.currency,
      missingRates: [...new Set(priced.filter((q) => q.fxRate === null).map((q) => q.currency))],
      quotes: priced,
      items: items.map((it) => {
        const options = allLines
          .filter((l) => l.requestedItemId === it.id)
          .sort((a, b) => (a.unitCost === null ? 1 : b.unitCost === null ? -1 : Number(a.unitCost) - Number(b.unitCost)));
        return {
          id: it.id,
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
    const f = await tx.factory.create({ data: { name, createdById: user.id } });
    await this.audit.record(tx, { userId: user.id, action: "create", entityType: "factory", entityId: f.id, summary: `Added factory ${f.name}` });
    return f;
  }

  /** Lines keep their ids (quotation lines and preferences point at them). Item links must be this deal's items. */
  private async writeLines(tx: Tx, user: SessionUser, quoteId: string, inquiryId: string, lines: FactoryQuoteInput["lines"]) {
    const own = new Set((await tx.requestedItem.findMany({ where: { inquiryId }, select: { id: true } })).map((r) => r.id));
    const existing = new Set((await tx.factoryQuoteLine.findMany({ where: { factoryQuoteId: quoteId }, select: { id: true } })).map((r) => r.id));
    const keep = lines.map((l) => l.id).filter((id): id is string => !!id && existing.has(id));
    const dropped = [...existing].filter((id) => !keep.includes(id));
    if (dropped.length) {
      await tx.requestedItem.updateMany({ where: { preferredFactoryLineId: { in: dropped } }, data: { preferredFactoryLineId: null } });
      await tx.factoryQuoteLine.deleteMany({ where: { id: { in: dropped } } });
    }
    for (const [n, l] of lines.entries()) {
      if (l.requestedItemId && !own.has(l.requestedItemId)) throw new DomainError("A price is linked to an item that is not on this deal. Reload and try again.");
      const row = { requestedItemId: l.requestedItemId, description: l.description, model: l.model, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, hsCode: l.hsCode ?? null, rebateRate: l.rebateRate, sortOrder: n };
      if (l.id && existing.has(l.id)) await tx.factoryQuoteLine.update({ where: { id: l.id }, data: row });
      else await tx.factoryQuoteLine.create({ data: { ...row, factoryQuoteId: quoteId } });
    }
    // Items with no preferred price yet start with the cheapest-entered first one from this quote.
    await tx.$executeRaw`
      update requested_items ri set preferred_factory_line_id = l.id
        from factory_quote_lines l
       where l.factory_quote_id = ${quoteId}::uuid and l.requested_item_id = ri.id and ri.preferred_factory_line_id is null`;
    // Remember each HS code's rebate for the next price.
    const remembered = new Map(lines.filter((l) => l.hsCode).map((l) => [l.hsCode!, l.rebateRate]));
    for (const [code, rebateRate] of remembered) {
      await tx.hsCode.upsert({ where: { code }, create: { code, rebateRate, updatedById: user.id }, update: { rebateRate, updatedById: user.id } });
    }
  }

  private header(input: FactoryQuoteInput) {
    return {
      reference: input.reference,
      receivedOn: toDbDate(input.receivedOn),
      validUntil: toDbDateOrNull(input.validUntil),
      currency: input.currency,
      vatRate: input.vatRate,
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
      await this.writeLines(tx, user, q.id, inquiryId, input.lines);
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "factory_quote", entityId: q.id, summary: `${inquiry.refNo}: prices from ${factory.name} (${input.lines.length} lines, ${input.currency})` });
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

  async update(user: SessionUser, quoteId: string, input: FactoryQuoteInput) {
    this.assertCan(user);
    return this.prisma.tx(async (tx) => {
      const { q, inquiry } = await this.findQuote(user, quoteId, tx);
      const factory = await this.factoryFor(tx, user, input);
      const updated = await tx.factoryQuote.update({ where: { id: quoteId }, data: { ...this.header(input), factoryId: factory.id } });
      await this.writeLines(tx, user, quoteId, q.inquiryId, input.lines);
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "factory_quote", entityId: quoteId, summary: `${inquiry.refNo}: edited prices from ${factory.name}` });
      return updated;
    });
  }

  /** Removed from the deal; items that preferred one of its lines are left without a preference. Quotations keep their own copy of the cost. */
  async remove(user: SessionUser, quoteId: string) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { inquiry } = await this.findQuote(user, quoteId, tx);
      const lineIds = (await tx.factoryQuoteLine.findMany({ where: { factoryQuoteId: quoteId }, select: { id: true } })).map((l) => l.id);
      await tx.requestedItem.updateMany({ where: { preferredFactoryLineId: { in: lineIds } }, data: { preferredFactoryLineId: null } });
      await tx.factoryQuote.update({ where: { id: quoteId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "factory_quote", entityId: quoteId, summary: `${inquiry.refNo}: removed factory prices` });
    });
  }

  /** Which factory price each item is quoted from by default. */
  async choose(user: SessionUser, inquiryId: string, choices: Record<string, string | null>) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const inquiry = await this.inquiries.findWorkable(user, inquiryId, tx);
      const items = new Set((await tx.requestedItem.findMany({ where: { inquiryId }, select: { id: true } })).map((r) => r.id));
      const lineIds = Object.values(choices).filter((v): v is string => !!v);
      const valid = new Set(
        (await tx.factoryQuoteLine.findMany({ where: { id: { in: lineIds }, factoryQuote: { inquiryId, deletedAt: null } }, select: { id: true } })).map((l) => l.id),
      );
      for (const [itemId, lineId] of Object.entries(choices)) {
        if (!items.has(itemId)) continue;
        if (lineId && !valid.has(lineId)) throw new DomainError("One of the chosen prices is no longer on this deal. Reload the page.");
        await tx.requestedItem.update({ where: { id: itemId }, data: { preferredFactoryLineId: lineId } });
      }
      await this.audit.record(tx, { userId: user.id, action: "update", entityType: "inquiry", entityId: inquiryId, summary: `${inquiry.refNo}: chose the factory prices to quote from` });
    });
    return this.forInquiry(user, inquiryId);
  }

  /* ------------------------------------------------- export rebate by HS code */

  /** The remembered rebate rates, optionally filtered by code or description. */
  async hsCodes(user: SessionUser, q?: string) {
    this.assertCan(user);
    const term = q?.trim();
    const rows = await this.prisma.db.hsCode.findMany({
      where: term ? { OR: [{ code: { startsWith: term.replace(/\s+/g, "") } }, { description: { contains: term, mode: "insensitive" } }] } : {},
      orderBy: { code: "asc" },
      take: 500,
    });
    const ids = [...new Set(rows.map((r) => r.updatedById).filter((v): v is string => !!v))];
    const people = new Map((await this.prisma.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u]));
    return rows.map((r) => ({ code: r.code, rebateRate: Number(r.rebateRate), description: r.description, updatedAt: r.updatedAt.toISOString(), updatedBy: (r.updatedById && people.get(r.updatedById)) || null }));
  }

  /** One HS code's remembered rebate, or null the first time it is used. */
  async hsCode(user: SessionUser, code: string) {
    this.assertCan(user);
    const r = await this.prisma.db.hsCode.findUnique({ where: { code: code.replace(/\s+/g, "") } });
    return r ? { code: r.code, rebateRate: Number(r.rebateRate), description: r.description } : null;
  }

  /** Set an HS code's rebate (e.g. when the official rate changes). Prices already entered keep theirs. */
  async saveHsCode(user: SessionUser, code: string, input: HsCodeInput) {
    this.assertCan(user);
    const clean = code.replace(/\s+/g, "");
    if (!/^[0-9.]{2,20}$/.test(clean)) throw new DomainError("Use digits only for the HS code, e.g. 8437.80");
    return this.prisma.tx(async (tx) => {
      const before = await tx.hsCode.findUnique({ where: { code: clean } });
      const row = await tx.hsCode.upsert({
        where: { code: clean },
        create: { code: clean, rebateRate: input.rebateRate, description: input.description, updatedById: user.id },
        update: { rebateRate: input.rebateRate, description: input.description, updatedById: user.id },
      });
      await this.audit.record(tx, {
        userId: user.id,
        action: before ? "update" : "create",
        entityType: "hs_code",
        entityId: null,
        summary: `Export rebate for HS ${clean}: ${before ? `${Number(before.rebateRate)}% → ` : ""}${input.rebateRate}%`,
      });
      return { code: row.code, rebateRate: Number(row.rebateRate), description: row.description };
    });
  }

  async removeHsCode(user: SessionUser, code: string) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const r = await tx.hsCode.findUnique({ where: { code } });
      if (!r) throw new NotFoundError("HS code");
      await tx.hsCode.delete({ where: { code } });
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "hs_code", entityId: null, summary: `Removed the export rebate for HS ${code}` });
    });
  }
}
