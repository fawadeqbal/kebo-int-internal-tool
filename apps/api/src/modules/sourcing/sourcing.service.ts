import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull } from "@kebo/database";
import { convertAmount, convertMinor, fxRate, withTaxMinor, fromMinor } from "@kebo/money";
import {
  can,
  coverage,
  lineNumbers,
  taxSentence,
  type CopyLinesInput,
  type FactoryLinePatch,
  type FactoryLinesInput,
  type FactoryQuoteInput,
  type LineMoveInput,
} from "@kebo/shared";
import { DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { InquiriesService } from "../inquiries/inquiries.service";
import { StagesService } from "../inquiries/stages.service";
import { requireReason } from "../../common/audit/reason";

const quoteInclude = {
  factory: { select: { id: true, name: true } },
  lines: {
    orderBy: { sortOrder: "asc" as const },
    include: { _count: { select: { quoteLines: { where: { revision: { deletedAt: null } } } } } },
  },
  files: { where: { deletedAt: null }, orderBy: { createdAt: "asc" as const } },
};

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
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factory prices.");
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
        include: quoteInclude,
        orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
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
          /** The same product in other factories' offers (lines copied from each other share it). */
          productKey: l.productKey ?? l.id,
          /** A quotation is priced from it: changing its price, quantity or place asks why. */
          used: l._count.quoteLines > 0,
        };
      });
      return {
        id: q.id,
        factory: q.factory,
        reference: q.reference,
        receivedOn: fromDbDate(q.receivedOn),
        validUntil: fromDbDateOrNull(q.validUntil),
        currency: q.currency,
        basis: q.basis,
        basisPlace: q.basisPlace,
        leadTime: q.leadTime,
        moq: q.moq,
        paymentTerms: q.paymentTerms,
        notes: q.notes,
        /** null when the exchange rate for this currency is missing in Settings. */
        fxRate: rate,
        lines: lines.map(({ costMinor: _c, ...l }) => l),
        /** What the whole offer costs us in the selling currency (null when a rate is missing). */
        totalCost: rate === null ? null : fromMinor(lines.reduce((t, l) => t + (l.costMinor ?? 0), 0)),
        /** Lines still without a price (a line priced in its parts does not count). */
        unpriced: q.lines.filter((l) => Number(l.unitPrice) === 0 && !q.lines.some((p) => p.parentId === l.id)).length,
        /** Which of the customer's items it answers, and which it misses. */
        coverage: coverage(
          itemRefs,
          q.lines.map((l) => l.requestedItemId),
        ),
        /** The factory's own quotation, catalogue, screenshots: kept as evidence (internal). */
        files: q.files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          mimeType: f.mimeType,
          size: f.size,
          kind: f.kind,
          note: f.note,
          uploadedOn: f.createdAt.toISOString(),
        })),
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
      /**
       * Without the customer's list, the same products across offers (lines copied
       * from another offer keep its product), cheapest first, oldest offer's wording.
       */
      products: (() => {
        const groups = new Map<string, typeof allLines>();
        for (const q of [...priced].reverse())
          for (const l of q.lines) groups.set(l.productKey, [...(groups.get(l.productKey) ?? []), { ...l, factory: q.factory, quoteId: q.id, currency: q.currency }]);
        return [...groups.entries()]
          .filter(([, lines]) => new Set(lines.map((l) => l.quoteId)).size > 1)
          .map(([key, lines]) => {
            const options = [...lines].sort((a, b) => rank(a.unitCost) - rank(b.unitCost));
            return {
              key,
              description: lines[0]!.description,
              quantity: lines[0]!.quantity,
              unit: lines[0]!.unit,
              cheapestLineId: options.find((o) => o.unitCost !== null && Number(o.unitCost) > 0)?.id ?? null,
              options,
            };
          });
      })(),
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
  private async writeLines(tx: Tx, quoteId: string, inquiryId: string, lines: NonNullable<FactoryQuoteInput["lines"]>) {
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
        throw new DomainError("A price is linked to an item that is not on this inquiry. Reload and try again.");
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
      basis: input.basis,
      basisPlace: input.basisPlace,
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
      if (input.lines) await this.writeLines(tx, q.id, inquiryId, input.lines);
      await this.audit.record(tx, {
        userId: user.id,
        action: "create",
        entityType: "factory_quote",
        entityId: q.id,
        summary: `${inquiry.refNo}: offer from ${factory.name} (${input.currency}${input.lines ? `, ${input.lines.length} lines` : ""})`,
      });
      const moved = await this.stages.after(tx, inquiry, "factory_price_added", user.id);
      if (moved) events.push(moved);
      return q;
    });
    await this.events.publish(...events);
    return quote;
  }

  private async findQuote(user: SessionUser, quoteId: string, tx: Tx) {
    // One change to an offer at a time (lines are numbered by their order).
    await tx.$queryRaw`select id from factory_quotes where id = ${quoteId}::uuid for update`;
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
      for (const [id, l] of input.lines ? used : []) {
        const next = input.lines!.find((x) => x.id === id);
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
      // A new currency: the prices are turned into it at the Settings rates, or kept as they are (typed in the wrong currency).
      const recurrency = input.currency !== q.currency;
      let converted: { id: string; unitPrice: number }[] = [];
      if (recurrency && input.convertPrices && !input.lines) {
        const { sales } = await this.settings.get();
        const lines = await tx.factoryQuoteLine.findMany({ where: { factoryQuoteId: quoteId }, select: { id: true, unitPrice: true } });
        converted = lines.map((l) => {
          const v = convertAmount(Number(l.unitPrice), q.currency, input.currency, sales.currency, sales.exchangeRates);
          if (v === null) throw new DomainError(`There is no exchange rate between ${q.currency} and ${input.currency} in Settings, so the prices cannot be converted.`);
          return { id: l.id, unitPrice: v };
        });
      }
      if (used.size && recurrency) changes.push(`currency ${q.currency} → ${input.currency}${converted.length ? " (prices converted)" : " (prices kept)"}`);
      const reason = changes.length
        ? requireReason(input.reason, "factoryPrice", "you are changing prices a quotation uses")
        : input.reason;
      const updated = await tx.factoryQuote.update({ where: { id: quoteId }, data: { ...this.header(input), factoryId: factory.id } });
      if (input.lines) await this.writeLines(tx, quoteId, q.inquiryId, input.lines);
      for (const l of converted) await tx.factoryQuoteLine.update({ where: { id: l.id }, data: { unitPrice: l.unitPrice } });
      if (recurrency && !used.size) changes.push(`currency ${q.currency} → ${input.currency}${converted.length ? `, ${converted.length} prices converted` : ""}`);
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "factory_quote",
        entityId: quoteId,
        summary: `${inquiry.refNo}: edited the offer from ${factory.name}${changes.length ? ` (${changes.join("; ")})` : ""}`,
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

  /* ---------------------------------------------------------------- lines, one change at a time
   * The line table saves each change as it is made: lines added (typed, pasted
   * or copied from another factory), one line edited, removed or moved. Each
   * call answers with the whole offer, numbered again. A line a quotation is
   * priced from asks why before its price, quantity or place changes.
   */

  /** One offer as the sourcing page shows it (after a change). */
  async quote(user: SessionUser, quoteId: string) {
    const q = await this.prisma.db.factoryQuote.findFirst({ where: { id: quoteId, deletedAt: null }, select: { inquiryId: true } });
    if (!q) throw new NotFoundError("Factory offer");
    const view = await this.forInquiry(user, q.inquiryId);
    return view.quotes.find((x) => x.id === quoteId)!;
  }

  /** The offer's lines in display order: each line, then its parts. */
  private async linesOf(tx: Tx, quoteId: string) {
    const rows = await tx.factoryQuoteLine.findMany({
      where: { factoryQuoteId: quoteId },
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { quoteLines: { where: { revision: { deletedAt: null } } } } } },
    });
    const tops = rows.filter((r) => !r.parentId);
    return tops.flatMap((t) => [t, ...rows.filter((r) => r.parentId === t.id)]);
  }

  /** Writes the new order (and parents) for the rows that moved. */
  private async saveOrder(tx: Tx, before: { id: string; parentId: string | null }[], after: { id: string; parentId: string | null }[]) {
    const old = new Map(before.map((r, n) => [r.id, { n, parentId: r.parentId }]));
    for (const [n, r] of after.entries()) {
      const o = old.get(r.id);
      if (!o || o.n !== n || o.parentId !== r.parentId)
        await tx.factoryQuoteLine.update({ where: { id: r.id }, data: { sortOrder: n, parentId: r.parentId } });
    }
  }

  private async lineAndQuote(user: SessionUser, lineId: string, tx: Tx) {
    const line = await tx.factoryQuoteLine.findUnique({ where: { id: lineId } });
    if (!line) throw new NotFoundError("Line");
    const { q, inquiry } = await this.findQuote(user, line.factoryQuoteId, tx);
    return { line, q, inquiry };
  }

  private async checkItems(tx: Tx, inquiryId: string, ids: (string | null | undefined)[]) {
    const wanted = ids.filter((x): x is string => !!x);
    if (!wanted.length) return;
    const own = await tx.requestedItem.count({ where: { inquiryId, id: { in: wanted } } });
    if (own !== new Set(wanted).size) throw new DomainError("A line is linked to an item that is not on this inquiry. Reload and try again.");
  }

  /** Lines typed or pasted in: after a line (or at the end), at that line's level or as parts of `parentId`. */
  async addLines(user: SessionUser, quoteId: string, input: FactoryLinesInput) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { q, inquiry } = await this.findQuote(user, quoteId, tx);
      const lines = await this.linesOf(tx, quoteId);
      if (lines.length + input.lines.length > 1000) throw new DomainError("An offer can have up to 1,000 lines.");
      const parent = input.parentId ? lines.find((l) => l.id === input.parentId) : null;
      if (input.parentId && (!parent || parent.parentId)) throw new DomainError("A part can only go under a line that is not a part itself.");
      for (const [n, l] of input.lines.entries()) {
        if (l.partOf === null) continue;
        if (parent || l.partOf >= n || input.lines[l.partOf]!.partOf !== null)
          throw new DomainError(`"${l.description.split("\n")[0]}" can only be a part of a line above it that is not a part itself.`);
      }
      await this.checkItems(tx, q.inquiryId, input.lines.map((l) => l.requestedItemId));
      const created: { id: string; parentId: string | null }[] = [];
      for (const l of input.lines) {
        const parentId = parent ? parent.id : l.partOf === null ? null : created[l.partOf]!.id;
        const row = await tx.factoryQuoteLine.create({
          data: {
            factoryQuoteId: quoteId,
            requestedItemId: l.requestedItemId ?? null,
            description: l.description,
            model: l.model,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            parentId,
            sortOrder: 100000 + created.length,
          },
        });
        created.push({ id: row.id, parentId });
      }
      // Where they go: after the given line (and its parts, unless they are parts of the same line), else at the end.
      const at = (() => {
        const after = input.afterId ? lines.findIndex((l) => l.id === input.afterId) : -1;
        if (parent) {
          const end = lines.findIndex((l, n) => n > lines.indexOf(parent) && l.parentId !== parent.id);
          const blockEnd = end < 0 ? lines.length : end;
          return after >= 0 && (lines[after]!.id === parent.id || lines[after]!.parentId === parent.id) ? after + 1 : blockEnd;
        }
        if (after < 0) return lines.length;
        const top = lines[after]!.parentId ? lines.findIndex((l) => l.id === lines[after]!.parentId) : after;
        let end = top + 1;
        while (end < lines.length && lines[end]!.parentId === lines[top]!.id) end++;
        return end;
      })();
      const order = [...lines.slice(0, at), ...created, ...lines.slice(at)];
      await this.saveOrder(tx, lines, order);
      await tx.factoryQuote.update({ where: { id: quoteId }, data: { updatedAt: new Date() } });
      // Typing lines in one by one is not history; a pasted list is.
      if (input.lines.length > 1)
        await this.audit.record(tx, {
          userId: user.id,
          action: "update",
          entityType: "factory_quote",
          entityId: quoteId,
          summary: `${inquiry.refNo}: added ${input.lines.length} lines to the offer`,
        });
    });
    return this.quote(user, quoteId);
  }

  /** One line changed in place. */
  async editLine(user: SessionUser, lineId: string, patch: FactoryLinePatch) {
    this.assertCan(user);
    const quoteId = await this.prisma.tx(async (tx) => {
      const { line, q, inquiry } = await this.lineAndQuote(user, lineId, tx);
      if (patch.requestedItemId !== undefined) await this.checkItems(tx, q.inquiryId, [patch.requestedItemId]);
      const used = (await tx.quoteLine.count({ where: { factoryQuoteLineId: lineId, revision: { deletedAt: null } } })) > 0;
      const changes: string[] = [];
      if (patch.unitPrice !== undefined && Number(patch.unitPrice) !== Number(line.unitPrice))
        changes.push(`price ${line.unitPrice.toFixed(2)} → ${Number(patch.unitPrice).toFixed(2)}`);
      if (patch.taxRate !== undefined && Number(patch.taxRate) !== Number(line.taxRate)) changes.push(`tax ${Number(line.taxRate)}% → ${Number(patch.taxRate)}%`);
      if (patch.quantity !== undefined && Number(patch.quantity) !== Number(line.quantity))
        changes.push(`qty ${line.quantity.toString()} → ${Number(patch.quantity)}`);
      const reason = used && changes.length ? requireReason(patch.reason, "factoryPrice", "you are changing a price a quotation uses") : patch.reason;
      const { reason: _r, ...data } = patch;
      await tx.factoryQuoteLine.update({ where: { id: lineId }, data });
      await tx.factoryQuote.update({ where: { id: q.id }, data: { updatedAt: new Date() } });
      if (used && changes.length)
        await this.audit.record(tx, {
          userId: user.id,
          action: "update",
          entityType: "factory_quote",
          entityId: q.id,
          summary: `${inquiry.refNo}: ${line.description.split("\n")[0]}: ${changes.join(", ")}`,
          reason,
        });
      return q.id;
    });
    return this.quote(user, quoteId);
  }

  /** A line (with its parts) taken out of the offer. Quotations keep their own copy. */
  async removeLine(user: SessionUser, lineId: string, reasonInput?: string) {
    this.assertCan(user);
    const quoteId = await this.prisma.tx(async (tx) => {
      const { line, q, inquiry } = await this.lineAndQuote(user, lineId, tx);
      const ids = [lineId, ...(await tx.factoryQuoteLine.findMany({ where: { parentId: lineId }, select: { id: true } })).map((r) => r.id)];
      const used = (await tx.quoteLine.count({ where: { factoryQuoteLineId: { in: ids }, revision: { deletedAt: null } } })) > 0;
      const reason = used ? requireReason(reasonInput, "factoryPrice", "you are removing a line a quotation uses") : reasonInput;
      await tx.factoryQuoteLine.deleteMany({ where: { id: { in: ids } } });
      await tx.factoryQuote.update({ where: { id: q.id }, data: { updatedAt: new Date() } });
      if (used)
        await this.audit.record(tx, {
          userId: user.id,
          action: "update",
          entityType: "factory_quote",
          entityId: q.id,
          summary: `${inquiry.refNo}: removed ${line.description.split("\n")[0]} from the offer`,
          reason,
        });
      return q.id;
    });
    return this.quote(user, quoteId);
  }

  /** Up / down among its neighbours, into the line above as a part, or out as a line of its own. */
  async moveLine(user: SessionUser, lineId: string, input: LineMoveInput) {
    this.assertCan(user);
    const quoteId = await this.prisma.tx(async (tx) => {
      const { q, inquiry, line } = await this.lineAndQuote(user, lineId, tx);
      const lines = await this.linesOf(tx, q.id);
      const i = lines.findIndex((l) => l.id === lineId);
      let order: { id: string; parentId: string | null }[] = lines.map((l) => ({ id: l.id, parentId: l.parentId }));
      const blockEnd = (n: number) => {
        let j = n + 1;
        if (!order[n]!.parentId) while (j < order.length && order[j]!.parentId === order[n]!.id) j++;
        return j;
      };
      if (input.to === "indent") {
        if (line.parentId) throw new DomainError("It is a part already.");
        if (lines.some((l) => l.parentId === lineId)) throw new DomainError("A line with parts cannot become a part. Move its parts out first.");
        const above = [...order.slice(0, i)].reverse().find((l) => !l.parentId);
        if (!above) throw new DomainError("There is no line above to make it a part of.");
        order[i] = { id: lineId, parentId: above.id };
      } else if (input.to === "outdent") {
        if (!line.parentId) throw new DomainError("It is not a part.");
        const old = line.parentId;
        order = order.map((l, n) => (n === i ? { ...l, parentId: null } : n > i && l.parentId === old ? { ...l, parentId: lineId } : l));
      } else {
        const by = input.to === "up" ? -1 : 1;
        if (line.parentId) {
          const j = i + by;
          if (order[j]?.parentId !== line.parentId) throw new DomainError(input.to === "up" ? "It is the first part already." : "It is the last part already.");
          [order[i], order[j]] = [order[j]!, order[i]!];
        } else {
          const tops = order.map((l, n) => (l.parentId ? -1 : n)).filter((n) => n >= 0);
          const other = tops[tops.indexOf(i) + by];
          if (other === undefined) throw new DomainError(input.to === "up" ? "It is the first line already." : "It is the last line already.");
          const [a, b] = by < 0 ? [other, i] : [i, other];
          order = [...order.slice(0, a), ...order.slice(b, blockEnd(b)), ...order.slice(a, blockEnd(a)), ...order.slice(blockEnd(b))];
        }
      }
      const changed = new Set(order.filter((l, n) => lines[n]!.id !== l.id || lines.find((x) => x.id === l.id)!.parentId !== l.parentId).map((l) => l.id));
      const used = lines.some((l) => changed.has(l.id) && l._count.quoteLines > 0);
      const reason = used ? requireReason(input.reason, "factoryPrice", "this changes how a quotation's lines are numbered") : input.reason;
      await this.saveOrder(tx, lines, order);
      await tx.factoryQuote.update({ where: { id: q.id }, data: { updatedAt: new Date() } });
      if (used)
        await this.audit.record(tx, {
          userId: user.id,
          action: "update",
          entityType: "factory_quote",
          entityId: q.id,
          summary: `${inquiry.refNo}: moved ${line.description.split("\n")[0]} (${input.to})`,
          reason,
        });
      return q.id;
    });
    return this.quote(user, quoteId);
  }

  /**
   * Starts (or adds to) an offer from another factory's lines on the same deal:
   * same products and breakdown, this factory's models and prices to fill in.
   * The copies keep the source line's product, so offers compare line by line.
   */
  async copyLines(user: SessionUser, quoteId: string, input: CopyLinesInput) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { q, inquiry } = await this.findQuote(user, quoteId, tx);
      if (input.fromQuoteId === quoteId) throw new DomainError("Choose another factory's offer.");
      const from = await tx.factoryQuote.findFirst({ where: { id: input.fromQuoteId, inquiryId: q.inquiryId, deletedAt: null }, include: { factory: true } });
      if (!from) throw new DomainError("That offer is not on this inquiry any more.");
      const source = await this.linesOf(tx, from.id);
      if (!source.length) throw new DomainError(`${from.factory.name}'s offer has no lines yet.`);
      const existing = await tx.factoryQuoteLine.count({ where: { factoryQuoteId: quoteId } });
      if (existing + source.length > 1000) throw new DomainError("An offer can have up to 1,000 lines.");
      const ids = new Map<string, string>();
      for (const [n, l] of source.entries()) {
        const row = await tx.factoryQuoteLine.create({
          data: {
            factoryQuoteId: quoteId,
            requestedItemId: l.requestedItemId,
            description: l.description,
            model: l.model,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: input.withPrices ? l.unitPrice : 0,
            taxRate: l.taxRate,
            parentId: l.parentId ? ids.get(l.parentId)! : null,
            productKey: l.productKey ?? l.id,
            sortOrder: existing + n,
          },
        });
        ids.set(l.id, row.id);
      }
      await tx.factoryQuote.update({ where: { id: quoteId }, data: { updatedAt: new Date() } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "factory_quote",
        entityId: quoteId,
        summary: `${inquiry.refNo}: copied ${source.length} lines from ${from.factory.name}'s offer`,
      });
    });
    return this.quote(user, quoteId);
  }
}
