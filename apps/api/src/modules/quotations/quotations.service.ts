import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, nextReference, toDbDate, type Prisma } from "@kebo/database";
import { convertMinor, costSummary, documentTotals, fromMinor, fxRate, priceForMargin, toMinor, withTaxMinor } from "@kebo/money";
import {
  can,
  canAnswer,
  canMoveRevision,
  canQuote,
  canStartRevision,
  coverage,
  draftsDiscardedBy,
  isEditable,
  latestRevision,
  lineNumbers,
  numberQuoteLines,
  optionLetter,
  supersededBy,
  type OptionInput,
  type RevisionInput,
  type RevisionStatus,
  type Settings,
} from "@kebo/shared";
import { addDays, DomainError, ForbiddenError, GateError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { InquiriesService } from "../inquiries/inquiries.service";
import { StagesService } from "../inquiries/stages.service";
import { OrdersService } from "../orders/orders.service";
import { requireReason } from "../../common/audit/reason";

/** NUMERIC(14,2) can hold up to this; totals above it are refused with a clear message. */
const MAX_TOTAL_MINOR = 999_999_999_999_99;

/** Lines with what is needed to number them (factory parts, or the customer's item parts). */
export const numberedLineInclude = {
  factoryQuoteLine: { select: { parentId: true } },
  requestedItem: { select: { parentId: true } },
} satisfies Prisma.QuoteLineInclude;

const revisionInclude = {
  options: {
    orderBy: { sortOrder: "asc" },
    include: {
      factoryQuote: { select: { id: true, currency: true, factory: { select: { id: true, name: true } } } },
      lines: { orderBy: { sortOrder: "asc" }, include: numberedLineInclude },
    },
  },
} satisfies Prisma.QuotationRevisionInclude;
type RevisionRow = Prisma.QuotationRevisionGetPayload<{ include: typeof revisionInclude }>;
type OptionRow = RevisionRow["options"][number];

/** "1", "2", "2.1" for one option's lines (or an order's, through their quotation lines). */
export function numbersOf(lines: Prisma.QuoteLineGetPayload<{ include: typeof numberedLineInclude }>[]) {
  return numberQuoteLines(
    lines.map((l) => ({
      id: l.id,
      factoryQuoteLineId: l.factoryQuoteLineId,
      factoryParentId: l.factoryQuoteLine?.parentId ?? null,
      requestedItemId: l.requestedItemId,
      itemParentId: l.requestedItem?.parentId ?? null,
    })),
  );
}

/** The letterhead frozen on a document when it is sent (the stamp image is not copied: documents print the current one). */
export function companySnapshot(s: Settings) {
  const { stamp: _stamp, ...company } = s.company;
  return company;
}

export async function customerSnapshot(tx: Tx, customerId: string, contactId: string | null) {
  const c = await tx.customer.findUniqueOrThrow({
    where: { id: customerId },
    include: { contacts: { where: { deletedAt: null }, orderBy: { isPrimary: "desc" } } },
  });
  const contact = c.contacts.find((x) => x.id === contactId) ?? c.contacts[0] ?? null;
  return {
    name: c.name,
    country: c.country,
    address: c.address,
    taxNo: c.taxNo,
    regNo: c.regNo,
    contact: contact && { name: contact.name, email: contact.email, phone: contact.phone ?? contact.whatsapp },
  };
}

type Db = Tx | PrismaService["db"];

/**
 * One quotation per deal, with revisions R1, R2… Each revision offers one or
 * more options (A, B…): each option is one factory's whole offer — its lines
 * exactly as the factory gave them, locked — with our prices, discount, lead
 * time and charges. (Without factory prices, an option is the customer's items
 * priced by hand.) A revision is edited only as a draft; sending freezes it;
 * the customer accepts exactly one option, which becomes the order.
 */
@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly settings: SettingsService,
    private readonly inquiries: InquiriesService,
    private readonly stages: StagesService,
    private readonly orders: OrdersService,
  ) {}

  /* ---------------------------------------------------------------- what can be offered */

  /** The deal's items numbered "1", "2", "2.1". */
  private async items(db: Db, inquiryId: string) {
    const items = await db.requestedItem.findMany({ where: { inquiryId }, orderBy: { sortOrder: "asc" } });
    const no = lineNumbers(items.map((i) => ({ key: i.id, parentKey: i.parentId })));
    return items.map((i, n) => ({ ...i, no: no[n]! }));
  }

  /**
   * Everything a revision can offer, with costs in `currency`: each factory
   * offer (its lines numbered, which items it covers), and the customer's own
   * items for an option without factory prices.
   */
  async offers(user: SessionUser, inquiryId: string, currency: string, db: Db = this.prisma.db) {
    await this.inquiries.find(user, inquiryId, db);
    const { sales } = await this.settings.get();
    const items = await this.items(db, inquiryId);
    const refs = items.map((i) => ({ id: i.id, parentId: i.parentId, no: i.no }));
    const quotes = can(user, "sourcing.manage")
      ? await db.factoryQuote.findMany({
          // An offer still being typed in (no lines yet) cannot be offered.
          where: { inquiryId, deletedAt: null, lines: { some: {} } },
          include: { factory: { select: { id: true, name: true } }, lines: { orderBy: { sortOrder: "asc" } } },
          orderBy: { receivedOn: "asc" },
        })
      : [];
    const offers = quotes.map((q) => {
      const rate = fxRate(q.currency, currency, sales.currency, sales.exchangeRates);
      const no = lineNumbers(q.lines.map((l) => ({ key: l.id, parentKey: l.parentId })));
      const lines = q.lines.map((l, n) => {
        const cost = rate ? convertMinor(withTaxMinor(decimalToMinor(l.unitPrice), Number(l.taxRate)), rate) : null;
        return {
          id: l.id,
          no: no[n]!,
          parentId: l.parentId,
          requestedItemId: l.requestedItemId,
          answersNo: items.find((i) => i.id === l.requestedItemId)?.no ?? null,
          description: l.description,
          model: l.model,
          quantity: l.quantity.toString(),
          unit: l.unit,
          unitCost: cost === null ? null : fromMinor(cost),
          costMinor: cost,
        };
      });
      return {
        factoryQuoteId: q.id,
        factory: q.factory,
        currency: q.currency,
        receivedOn: fromDbDate(q.receivedOn),
        validUntil: fromDbDateOrNull(q.validUntil),
        leadTime: q.leadTime,
        coverage: coverage(
          refs,
          q.lines.map((l) => l.requestedItemId),
        ),
        /** No exchange rate for its currency in Settings: costs are unknown. */
        missingRate: rate === null,
        /** Lines still without a factory price (a line priced in its parts does not count). */
        unpriced: q.lines.filter((l) => Number(l.unitPrice) === 0 && !q.lines.some((p) => p.parentId === l.id)).length,
        totalCost: rate === null ? null : fromMinor(lines.reduce((t, l) => t + Math.round((l.costMinor ?? 0) * Number(l.quantity)), 0)),
        lines: lines.map(({ costMinor: _c, ...l }) => l),
      };
    });
    return {
      currency,
      defaultMargin: sales.defaultMarginPercent,
      offers,
      /** The customer's items, for an option priced by hand (no factory prices). */
      items: items.map((i) => ({
        id: i.id,
        no: i.no,
        parentId: i.parentId,
        description: i.description,
        model: i.model,
        quantity: i.quantity.toString(),
        unit: i.unit,
      })),
    };
  }

  /* ---------------------------------------------------------------- reading */

  private optionView(user: SessionUser, o: OptionRow, items: { id: string; parentId: string | null; no: string }[]) {
    const seeCosts = can(user, "sourcing.manage");
    const no = numbersOf(o.lines);
    const costing = seeCosts
      ? costSummary(
          o.lines.map((l) => ({
            quantity: l.quantity.toString(),
            unitPriceMinor: decimalToMinor(l.unitPrice),
            unitCostMinor: l.unitCost === null ? null : decimalToMinor(l.unitCost),
          })),
          decimalToMinor(o.discount),
        )
      : null;
    return {
      id: o.id,
      letter: o.letter,
      status: o.status,
      /** The factory whose offer this is (internal; null when priced from the customer's items). */
      factory: seeCosts ? (o.factoryQuote?.factory ?? null) : null,
      factoryQuoteId: seeCosts ? o.factoryQuoteId : null,
      leadTime: o.leadTime,
      subtotal: o.subtotal.toFixed(2),
      discount: o.discount.toFixed(2),
      total: o.total.toFixed(2),
      coverage: coverage(
        items,
        o.lines.map((l) => l.requestedItemId),
      ),
      lines: o.lines.map((l, i) => ({
        id: l.id,
        /** "1", "2", "2.1" within the option. */
        no: no[i]!,
        requestedItemId: l.requestedItemId,
        type: l.type,
        description: l.description,
        model: l.model,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: l.unitPrice.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        ...(seeCosts
          ? { unitCost: l.unitCost?.toFixed(2) ?? null, factoryQuoteLineId: l.factoryQuoteLineId, fxRate: l.fxRate?.toString() ?? null }
          : {}),
      })),
      costing: costing && {
        ...costing,
        cost: fromMinor(costing.costMinor),
        sales: fromMinor(costing.salesMinor),
        profit: fromMinor(costing.profitMinor),
      },
    };
  }

  private view(user: SessionUser, r: RevisionRow, items: { id: string; parentId: string | null; no: string }[]) {
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      currency: r.currency,
      incoterm: r.incoterm,
      incotermPlace: r.incotermPlace,
      depositPercent: Number(r.depositPercent),
      balanceTerms: r.balanceTerms,
      validUntil: fromDbDate(r.validUntil),
      /** Option A's (or, once accepted, the accepted option's) figures, for lists and reports. */
      leadTime: r.leadTime,
      subtotal: r.subtotal.toFixed(2),
      discount: r.discount.toFixed(2),
      total: r.total.toFixed(2),
      paymentTerms: r.paymentTerms,
      deliveryTerms: r.deliveryTerms,
      notes: r.notes,
      sentOn: fromDbDateOrNull(r.sentOn),
      answeredOn: fromDbDateOrNull(r.answeredOn),
      customerSnapshot: r.customerSnapshot,
      companySnapshot: r.companySnapshot,
      createdAt: r.createdAt,
      options: r.options.map((o) => this.optionView(user, o, items)),
    };
  }

  async get(user: SessionUser, inquiryId: string) {
    const inquiry = await this.inquiries.find(user, inquiryId);
    const q = await this.prisma.db.quotation.findUnique({
      where: { inquiryId },
      include: { revisions: { where: { deletedAt: null }, include: revisionInclude, orderBy: { number: "desc" } } },
    });
    const items = await this.items(this.prisma.db, inquiryId);
    const revisions = q?.revisions ?? [];
    const refs = revisions.map((r) => ({ number: r.number, status: r.status }));
    const start = canStartRevision(refs);
    return {
      inquiry: { id: inquiry.id, refNo: inquiry.refNo, stage: inquiry.stage },
      quotation: q && { id: q.id, refNo: q.refNo },
      revisions: revisions.map((r) => ({
        ...this.view(user, r, items),
        canAnswer: canAnswer(refs, r.number),
        editable: isEditable(r.status),
      })),
      canStartRevision: canQuote(inquiry.stage) && start.ok,
      whyNotStart: !canQuote(inquiry.stage) ? "This deal is closed. Reopen it to quote again." : start.ok ? null : start.reason,
    };
  }

  /** A revision's values as the editor sends them back (prices keyed by factory line, or by item without factory prices). */
  private asInput(r: RevisionRow): RevisionInput {
    return {
      currency: r.currency,
      incoterm: r.incoterm,
      incotermPlace: r.incotermPlace,
      depositPercent: Number(r.depositPercent),
      balanceTerms: r.balanceTerms,
      validUntil: fromDbDate(r.validUntil),
      paymentTerms: r.paymentTerms,
      deliveryTerms: r.deliveryTerms,
      notes: r.notes,
      options: r.options.map((o) => ({
        factoryQuoteId: o.factoryQuoteId,
        discount: Number(o.discount),
        leadTime: o.leadTime,
        prices: o.lines
          .filter((l) => l.type === "goods" && (o.factoryQuoteId ? l.factoryQuoteLineId : l.requestedItemId))
          .map((l) => ({ lineId: (o.factoryQuoteId ? l.factoryQuoteLineId : l.requestedItemId)!, unitPrice: Number(l.unitPrice) })),
        charges: o.lines
          .filter((l) => l.type !== "goods" || (o.factoryQuoteId ? !l.factoryQuoteLineId : !l.requestedItemId))
          .map((l) => ({
            type: l.type === "service" ? ("service" as const) : ("charge" as const),
            description: l.description,
            quantity: Number(l.quantity),
            unit: l.unit,
            unitPrice: Number(l.unitPrice),
            unitCost: l.unitCost === null ? null : Number(l.unitCost),
          })),
      })),
    };
  }

  /**
   * Starting values for the next revision: a copy of the latest one (options
   * whose offer was removed are left out), or for R1 the offer that covers the
   * most items at the lowest cost, priced at the default margin.
   */
  async draft(user: SessionUser, inquiryId: string): Promise<RevisionInput & { number: number }> {
    await this.inquiries.find(user, inquiryId); // only for people who may see the deal
    const settings = await this.settings.get();
    const q = await this.prisma.db.quotation.findUnique({
      where: { inquiryId },
      include: { revisions: { where: { deletedAt: null }, include: revisionInclude, orderBy: { number: "desc" } } },
    });
    const latest = q?.revisions[0];
    const validUntil = addDays(this.clock.today(), settings.sales.quotationValidityDays);
    const available = await this.offers(user, inquiryId, latest?.currency ?? settings.sales.currency);
    if (latest) {
      const input = this.asInput(latest);
      const live = new Set(available.offers.map((o) => o.factoryQuoteId));
      const options = input.options.filter((o) => !o.factoryQuoteId || live.has(o.factoryQuoteId));
      return {
        ...input,
        number: latest.number + 1,
        validUntil: input.validUntil < this.clock.today() ? validUntil : input.validUntil,
        options: options.length ? options : input.options,
      };
    }
    const margin = settings.sales.defaultMarginPercent;
    const best = [...available.offers].sort(
      (a, b) =>
        a.coverage.missing.length - b.coverage.missing.length ||
        a.unpriced - b.unpriced ||
        (a.totalCost === null ? 1 : b.totalCost === null ? -1 : Number(a.totalCost) - Number(b.totalCost)),
    )[0];
    const option: OptionInput = best
      ? {
          factoryQuoteId: best.factoryQuoteId,
          discount: 0,
          leadTime: best.leadTime,
          charges: [],
          prices: best.lines.map((l) => ({
            lineId: l.id,
            unitPrice: l.unitCost === null ? 0 : Number(fromMinor(priceForMargin(toMinor(l.unitCost), margin))),
          })),
        }
      : {
          factoryQuoteId: null,
          discount: 0,
          leadTime: null,
          charges: [],
          prices: available.items.map((i) => ({ lineId: i.id, unitPrice: 0 })),
        };
    return {
      number: 1,
      currency: settings.sales.currency,
      incoterm: settings.sales.defaultIncoterm,
      incotermPlace: null,
      depositPercent: settings.sales.defaultDepositPercent,
      balanceTerms: settings.sales.defaultBalanceTerms,
      validUntil,
      paymentTerms: settings.sales.defaultPaymentTerms || null,
      deliveryTerms: settings.sales.defaultDeliveryTerms || null,
      notes: null,
      options: [option],
    };
  }

  /* ---------------------------------------------------------------- writing revisions */

  private assertCan(user: SessionUser) {
    if (!can(user, "quotations.manage")) throw new ForbiddenError("You cannot make quotations.");
  }

  /**
   * The options as rows: each factory offer's lines exactly as the factory gave
   * them (all of them, in its order, with its parts), priced by the person,
   * costs worked out here at today's rate; then the charges.
   */
  private async rows(tx: Tx, user: SessionUser, inquiryId: string, input: RevisionInput) {
    const { sales } = await this.settings.get();
    const seen = new Set<string>();
    const items = await this.items(tx, inquiryId);
    const built: {
      option: Omit<Prisma.QuotationOptionUncheckedCreateInput, "revisionId">;
      lines: Omit<Prisma.QuoteLineCreateManyInput, "revisionId" | "optionId">[];
    }[] = [];
    for (const [n, o] of input.options.entries()) {
      const letter = optionLetter(n);
      const priceOf = (id: string, what: string) => {
        const p = o.prices.find((x) => x.lineId === id);
        if (!p) throw new DomainError(`Option ${letter}: enter a price for "${what.split("\n")[0]!.slice(0, 60)}".`);
        return p.unitPrice;
      };
      const lines: Omit<Prisma.QuoteLineCreateManyInput, "revisionId" | "optionId" | "lineTotal">[] = [];
      if (o.factoryQuoteId) {
        if (!can(user, "sourcing.manage")) throw new ForbiddenError("Only people who see factory prices can quote a factory's offer.");
        if (seen.has(o.factoryQuoteId)) throw new DomainError("Each option must be a different factory's offer.");
        seen.add(o.factoryQuoteId);
        const q = await tx.factoryQuote.findFirst({
          where: { id: o.factoryQuoteId, inquiryId, deletedAt: null },
          include: { lines: { orderBy: { sortOrder: "asc" } } },
        });
        if (!q) throw new DomainError(`Option ${letter}: that factory offer is no longer on this deal. Reload the page.`);
        const rate = fxRate(q.currency, input.currency, sales.currency, sales.exchangeRates);
        for (const l of q.lines) {
          const cost = rate ? convertMinor(withTaxMinor(decimalToMinor(l.unitPrice), Number(l.taxRate)), rate) : null;
          lines.push({
            requestedItemId: l.requestedItemId,
            type: "goods",
            description: l.description,
            model: l.model,
            quantity: l.quantity,
            unit: l.unit,
            unitPrice: priceOf(l.id, l.description),
            unitCost: cost === null ? null : fromMinor(cost),
            factoryQuoteLineId: l.id,
            fxRate: rate,
          });
        }
      } else {
        for (const i of items) {
          lines.push({
            requestedItemId: i.id,
            type: "goods",
            description: i.description,
            model: i.model,
            quantity: i.quantity,
            unit: i.unit,
            unitPrice: priceOf(i.id, i.description),
            unitCost: null,
          });
        }
      }
      for (const c of o.charges)
        lines.push({
          type: c.type,
          description: c.description,
          quantity: c.quantity,
          unit: c.unit,
          unitPrice: c.unitPrice,
          unitCost: c.unitCost ?? null,
        });
      const totals = documentTotals(
        lines.map((l) => ({ quantity: String(l.quantity), unitPrice: String(l.unitPrice) })),
        o.discount,
      );
      if (totals.total <= 0) throw new DomainError(`Option ${letter}: the total must be more than zero.`);
      if (totals.total > MAX_TOTAL_MINOR) throw new DomainError(`Option ${letter}: the total is too large.`);
      built.push({
        option: {
          letter,
          sortOrder: n,
          factoryQuoteId: o.factoryQuoteId ?? null,
          leadTime: o.leadTime,
          subtotal: fromMinor(totals.subtotal),
          discount: fromMinor(totals.discount),
          total: fromMinor(totals.total),
        },
        lines: lines.map((l, k) => ({ ...l, lineTotal: fromMinor(totals.lines[k]!.lineTotal), sortOrder: k })),
      });
    }
    const a = built[0]!.option;
    return {
      built,
      header: {
        currency: input.currency,
        incoterm: input.incoterm,
        incotermPlace: input.incotermPlace,
        depositPercent: input.depositPercent,
        balanceTerms: input.balanceTerms,
        validUntil: toDbDate(input.validUntil),
        paymentTerms: input.paymentTerms,
        deliveryTerms: input.deliveryTerms,
        notes: input.notes,
        // The revision's own figures follow Option A until the customer accepts one.
        leadTime: a.leadTime,
        subtotal: a.subtotal!,
        discount: a.discount!,
        total: a.total!,
      },
    };
  }

  private async writeOptions(tx: Tx, revisionId: string, built: Awaited<ReturnType<QuotationsService["rows"]>>["built"]) {
    for (const b of built) {
      const o = await tx.quotationOption.create({ data: { ...b.option, revisionId } });
      await tx.quoteLine.createMany({ data: b.lines.map((l) => ({ ...l, revisionId, optionId: o.id })) });
    }
  }

  async createRevision(user: SessionUser, inquiryId: string, input: RevisionInput) {
    this.assertCan(user);
    const id = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from inquiries where id = ${inquiryId}::uuid for update`;
      const inquiry = await this.inquiries.findWorkable(user, inquiryId, tx);
      if (!canQuote(inquiry.stage)) throw new DomainError("This deal is closed. Reopen it to quote again.");
      let q = await tx.quotation.findUnique({
        where: { inquiryId },
        include: { revisions: { where: { deletedAt: null }, select: { number: true, status: true } } },
      });
      const refs = (q?.revisions ?? []).map((r) => ({ number: r.number, status: r.status }));
      const start = canStartRevision(refs);
      if (!start.ok) throw new GateError(start.reason, "revision_blocked");
      q ??= {
        ...(await tx.quotation.create({
          data: { inquiryId, refNo: await nextReference(tx, "quotation", Number(this.clock.today().slice(0, 4))) },
        })),
        revisions: [],
      };
      // Numbers count every revision ever made (including deleted drafts), so R-numbers are never reused.
      const max = await tx.quotationRevision.aggregate({ where: { quotationId: q.id }, _max: { number: true } });
      const number = (max._max.number ?? 0) + 1;
      // A new revision after the customer has seen one says why it changed.
      const seen = q.revisions.find((r) => r.status !== "draft");
      const reason = seen
        ? requireReason(input.reason, "newRevision", "the quotation changes after the customer has seen it")
        : input.reason;
      const { built, header } = await this.rows(tx, user, inquiryId, input);
      const rev = await tx.quotationRevision.create({ data: { ...header, quotationId: q.id, number, createdById: user.id } });
      await this.writeOptions(tx, rev.id, built);
      await this.audit.record(tx, {
        userId: user.id,
        action: "create",
        entityType: "quotation",
        entityId: rev.id,
        summary: `${q.refNo} R${number} drafted for ${inquiry.refNo} — ${built.map((b) => `Option ${b.option.letter} ${input.currency} ${String(b.option.total)}`).join(", ")}`,
        reason,
      });
      return rev.id;
    });
    return this.revision(user, id);
  }

  private async loadRevision(user: SessionUser, revisionId: string, tx: Db = this.prisma.db) {
    const r = await tx.quotationRevision.findFirst({
      where: { id: revisionId, deletedAt: null },
      include: { ...revisionInclude, quotation: true },
    });
    if (!r) throw new NotFoundError("Quotation");
    const inquiry = await this.inquiries.find(user, r.quotation.inquiryId, tx);
    return { r, inquiry };
  }

  async revision(user: SessionUser, revisionId: string) {
    const { r } = await this.loadRevision(user, revisionId);
    const items = await this.items(this.prisma.db, r.quotation.inquiryId);
    return { quotation: { id: r.quotation.id, refNo: r.quotation.refNo, inquiryId: r.quotation.inquiryId }, ...this.view(user, r, items) };
  }

  /** A saved draft as the editor sends it back. */
  async values(user: SessionUser, revisionId: string) {
    const { r } = await this.loadRevision(user, revisionId);
    return { number: r.number, ...this.asInput(r) };
  }

  /** A draft is saved whole: its options are rebuilt from the factory offers as they are now. */
  async updateRevision(user: SessionUser, revisionId: string, input: RevisionInput) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { r, inquiry } = await this.loadRevision(user, revisionId, tx);
      await this.inquiries.findWorkable(user, inquiry.id, tx);
      if (!isEditable(r.status))
        throw new DomainError("Only a draft can be edited. Start a new revision to change what the customer has seen.");
      const { built, header } = await this.rows(tx, user, inquiry.id, input);
      await tx.quotationOption.deleteMany({ where: { revisionId } });
      await tx.quotationRevision.update({ where: { id: revisionId }, data: header });
      await this.writeOptions(tx, revisionId, built);
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "quotation",
        entityId: revisionId,
        summary: `${r.quotation.refNo} R${r.number} edited`,
        oldValues: { options: r.options.map((o) => `${o.letter} ${o.total.toFixed(2)}`).join(", "), validUntil: fromDbDate(r.validUntil) },
        newValues: { options: built.map((b) => `${b.option.letter} ${String(b.option.total)}`).join(", "), validUntil: input.validUntil },
      });
    });
    return this.revision(user, revisionId);
  }

  async deleteDraft(user: SessionUser, revisionId: string) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { r, inquiry } = await this.loadRevision(user, revisionId, tx);
      await this.inquiries.findWorkable(user, inquiry.id, tx);
      if (r.status !== "draft") throw new DomainError("Only drafts can be deleted.");
      await tx.quotationRevision.update({ where: { id: revisionId }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "delete",
        entityType: "quotation",
        entityId: revisionId,
        summary: `${r.quotation.refNo} R${r.number} draft deleted`,
      });
    });
  }

  /* ---------------------------------------------------------------- sending and answers */

  /**
   * Draft → sent (frozen, with who it was for and from), older sent revisions
   * superseded, the deal moves to Quoted. Then: accepted — exactly one option,
   * the others not chosen; the order is made from it and the deal is Won —
   * rejected, or expired; only on the newest sent revision.
   */
  async move(
    user: SessionUser,
    revisionId: string,
    to: Exclude<RevisionStatus, "draft" | "superseded" | "void">,
    on: ISODate | null,
    reasonInput?: string | null,
    optionId?: string | null,
  ) {
    this.assertCan(user);
    const today = this.clock.today();
    const day = on ?? today;
    if (day > today) throw new DomainError("The date cannot be in the future.");
    const events: DomainEvent[] = [];
    await this.prisma.tx(async (tx) => {
      const head = await tx.quotationRevision.findFirst({ where: { id: revisionId, deletedAt: null }, include: { quotation: true } });
      if (!head) throw new NotFoundError("Quotation");
      // One change at a time per deal (sending R3 while someone accepts R2…).
      await tx.$queryRaw`select id from inquiries where id = ${head.quotation.inquiryId}::uuid for update`;
      const { r, inquiry } = await this.loadRevision(user, revisionId, tx);
      await this.inquiries.findWorkable(user, inquiry.id, tx);
      if (!canMoveRevision(r.status, to)) throw new GateError(`A ${r.status} revision cannot be marked ${to}.`, "revision_move");
      const reason =
        to === "rejected" || to === "expired" ? requireReason(reasonInput, "quoteAnswer", `the quotation is ${to}`) : reasonInput;
      const all = await tx.quotationRevision.findMany({
        where: { quotationId: r.quotationId, deletedAt: null },
        select: { id: true, number: true, status: true },
      });
      const refs = all.map((x) => ({ number: x.number, status: x.status }));
      let chosen: OptionRow | null = null;

      if (to === "sent") {
        if (r.number !== latestRevision(refs)!.number) throw new GateError("Only the newest revision can be sent.", "not_latest");
        if (!canQuote(inquiry.stage)) throw new DomainError("This deal is closed. Reopen it to quote again.");
        const settings = await this.settings.get();
        await tx.quotationRevision.update({
          where: { id: r.id },
          data: {
            status: "sent",
            sentOn: toDbDate(day),
            customerSnapshot: await customerSnapshot(tx, inquiry.customerId, inquiry.contactId),
            companySnapshot: companySnapshot(settings),
          },
        });
        const older = supersededBy(refs, r.number);
        if (older.length)
          await tx.quotationRevision.updateMany({
            where: { quotationId: r.quotationId, number: { in: older } },
            data: { status: "superseded" },
          });
        const moved = await this.stages.after(tx, inquiry, "quotation_sent", user.id);
        if (moved) events.push(moved);
      } else {
        if (!canAnswer(refs, r.number)) throw new GateError("Answers are recorded on the newest revision the customer has.", "not_latest");
        if (to === "accepted") {
          // Exactly one option: the one the customer chose (the only one, when there is one).
          chosen = optionId ? (r.options.find((o) => o.id === optionId) ?? null) : r.options.length === 1 ? r.options[0]! : null;
          if (!chosen)
            throw new DomainError(
              optionId ? "That option is not on this revision. Reload the page." : "Choose the option the customer accepted.",
            );
          await tx.quotationOption.update({ where: { id: chosen.id }, data: { status: "accepted" } });
          await tx.quotationOption.updateMany({ where: { revisionId: r.id, id: { not: chosen.id } }, data: { status: "not_chosen" } });
          await tx.quotationRevision.update({
            where: { id: r.id },
            data: {
              status: to,
              answeredOn: toDbDate(day),
              leadTime: chosen.leadTime,
              subtotal: chosen.subtotal,
              discount: chosen.discount,
              total: chosen.total,
            },
          });
          const drafts = draftsDiscardedBy(refs, r.number);
          if (drafts.length)
            await tx.quotationRevision.updateMany({
              where: { quotationId: r.quotationId, number: { in: drafts } },
              data: { deletedAt: new Date() },
            });
          const { event } = await this.orders.createFromRevision(tx, r.id, chosen.id, day, user.id);
          events.push(event);
          const moved = await this.stages.after(tx, inquiry, "quotation_accepted", user.id);
          if (moved) events.push(moved);
        } else {
          await tx.quotationRevision.update({ where: { id: r.id }, data: { status: to, answeredOn: toDbDate(day) } });
        }
      }
      await this.audit.record(tx, {
        userId: user.id,
        action: "status_change",
        entityType: "quotation",
        entityId: r.id,
        summary: `${r.quotation.refNo} R${r.number}: ${r.status} → ${to}${chosen ? ` (Option ${chosen.letter}, ${r.currency} ${chosen.total.toFixed(2)})` : ""}`,
        oldValues: { status: r.status },
        newValues: { status: to, ...(chosen ? { option: chosen.letter } : {}) },
        reason,
      });
      events.unshift({
        type: "revision.statusChanged",
        inquiryId: inquiry.id,
        refNo: `${r.quotation.refNo} R${r.number}`,
        revision: r.number,
        status: to,
        actorId: user.id,
        notify: [inquiry.assigneeId, inquiry.createdById, r.createdById].filter((v): v is string => !!v),
      });
    });
    await this.events.publish(...events);
    return this.revision(user, revisionId);
  }
}
