import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, nextReference, Prisma, toDbDate } from "@kebo/database";
import { convertMinor, costSummary, documentTotals, fromMinor, fxRate, priceForMargin, quoteUnitCostMinor, toMinor } from "@kebo/money";
import {
  BASIS_STEP_LABEL,
  BASIS_STEPS,
  balanceTermsOfParts,
  byLetter,
  basisGap,
  can,
  canAnswer,
  canMoveRevision,
  canQuote,
  canStartRevision,
  coverage,
  CURRENCIES,
  depositOfParts,
  draftsDiscardedBy,
  isLeadFrom,
  isWarrantyFrom,
  leadWords,
  isEditable,
  nextQuotationLetter,
  quotationBase,
  quotationNumber,
  type NewQuotationsInput,
  latestRevision,
  QUOTED_STATUSES,
  type Currency,
  lineNumbers,
  numberQuoteLines,
  offerTermsOf,
  optionLetter,
  parseWarranty,
  quotePartsOf,
  storedParts,
  supersededBy,
  type Incoterm,
  type OptionInput,
  type RevisionInput,
  type RevisionStatus,
  type Settings,
  type PaymentRoute,
  type QuotePartRule,
  type SentVia,
  SENT_VIA_TEXT,
  unpricedItems,
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
import { customerSnapshot } from "../orders/buyer";
import { figuresOf } from "./revision-figures";
import { CompanyMail } from "../../common/notify/company-mail";

/** Incoterms whose place is at the supplier's end (its works or its port): there the offer's place is ours too. */
const AT_THE_SUPPLIER = new Set<Incoterm>(["EXW", "FCA", "FAS", "FOB"]);

/** NUMERIC(14,2) can hold up to this; totals above it are refused with a clear message. */
const MAX_TOTAL_MINOR = 999_999_999_999_99;

/** Lines with what is needed to number them (factory parts, or the customer's item parts). */
export const numberedLineInclude = {
  // (Its price now, too: a quotation says when the offer's price changed after it was made.)
  factoryQuoteLine: { select: { parentId: true, unitPrice: true } },
  requestedItem: { select: { parentId: true } },
} satisfies Prisma.QuoteLineInclude;

const revisionInclude = {
  options: {
    orderBy: { sortOrder: "asc" },
    include: {
      factoryQuote: {
        select: {
          id: true,
          currency: true,
          factory: { select: { id: true, name: true } },
          // What the factory gives (its terms now), beside what this option promises the customer.
          leadTime: true,
          leadDays: true,
          leadFrom: true,
          paymentParts: true,
          advancePercent: true,
          warranty: true,
          warrantyMonths: true,
          warrantyFrom: true,
          // A quotation is never valid longer than the supplier's prices (canvas "From the supplier offer to the quotation").
          validUntil: true,
        },
      },
      lines: { orderBy: { sortOrder: "asc" }, include: numberedLineInclude },
      costs: true,
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

/** The customer as it is now (name, address, tax and registration numbers, the deal's contact): see orders/buyer. */
export { customerSnapshot };

type Db = Tx | PrismaService["db"];
/** One supplier offer a quotation can be made from (QuotationsService.offers). */
type OfferChoice = Awaited<ReturnType<QuotationsService["offers"]>>["offers"][number];

/** A factory offer's terms as facts (design "terms that travel"): see @kebo/shared offerTermsOf. */
export const factoryTerms = offerTermsOf;

/** An option's lead time as stored: its days and moment with the words worked out from them, or its words alone. */
function optionLead(o: { leadDays?: number | null; leadFrom?: string | null; leadTime: string | null }) {
  if (o.leadDays === null || o.leadDays === undefined) return { leadDays: null, leadFrom: null, leadTime: o.leadTime };
  const from = isLeadFrom(o.leadFrom) ? o.leadFrom : "after_payment";
  return { leadDays: o.leadDays, leadFrom: from, leadTime: leadWords(o.leadDays, from, "customer") };
}

/**
 * Any number of quotations per deal, A, B, C… (QUO-2026-0531-B), each with revisions R1, R2… A revision offers
 * one or more options (older quotations have several; a quotation from one factory offer has one): an option is
 * one factory's whole offer — its lines exactly as the factory gave them, locked — with our prices, discount,
 * lead time and charges. (Without factory prices, an option is the customer's items priced by hand.) A revision
 * is edited only as a draft; sending freezes it; the customer accepts exactly one option, which becomes the order.
 */
/** Where a first revision's starting values came from (said under each field; all of them can be changed). */
export interface DraftFrom {
  customer: string | null;
  /** The customer's own currency, or the company's (Settings). */
  currency: "customer" | "settings";
  /** Incoterm and place: from the last quotation sent to this customer, or the company's usual (Settings). */
  delivery: "last_quotation" | "settings";
  /** That quotation's inquiry number. */
  lastQuotation: string | null;
}

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
    private readonly mail: CompanyMail,
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
        const cost = rate ? convertMinor(quoteUnitCostMinor(decimalToMinor(l.unitPrice), Number(l.taxRate), q.taxIncluded, sales.exportVatRefundPercent), rate) : null;
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
        /** What the factory's prices already pay for (EXW, FOB…), and where. */
        basis: q.basis,
        basisPlace: q.basisPlace,
        receivedOn: fromDbDate(q.receivedOn),
        validUntil: fromDbDateOrNull(q.validUntil),
        leadTime: q.leadTime,
        /** Its lead time as days from a moment, as typed (null: only its words, an older offer). */
        leadDays: q.leadDays,
        leadFrom: isLeadFrom(q.leadFrom) ? q.leadFrom : null,
        /**
         * What the factory gives (design "terms that travel"), to check a promise against: its lead time, its
         * payment as parts and its warranty (an older offer's words read for them where they say them plainly).
         */
        terms: factoryTerms(q, sales.factoryAdvancePercent),
        coverage: coverage(
          refs,
          q.lines.map((l) => l.requestedItemId),
        ),
        /** No exchange rate for its currency in Settings: costs are unknown. */
        missingRate: rate === null,
        /** Items still without a supplier price (a part is priced in its item; an item priced in its parts is priced). */
        unpriced: unpricedItems(q.lines.map((l) => ({ id: l.id, parentId: l.parentId, price: l.unitPrice.toString() }))),
        totalCost: rate === null ? null : fromMinor(lines.reduce((t, l) => t + Math.round((l.costMinor ?? 0) * Number(l.quantity)), 0)),
        lines: lines.map(({ costMinor: _c, ...l }) => l),
      };
    });
    return {
      currency,
      defaultMargin: sales.defaultMarginPercent,
      /** For costs entered in other currencies (freight in USD, trucking in CNY): 1 main currency buys N. */
      mainCurrency: sales.currency,
      rates: sales.exchangeRates,
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

  private optionView(user: SessionUser, o: OptionRow, items: { id: string; parentId: string | null; no: string }[], selling: Incoterm, usualAdvance: number) {
    const seeCosts = can(user, "sourcing.manage");
    const no = numbersOf(o.lines);
    const extra = o.costs.reduce((t, c) => t + decimalToMinor(c.cost), 0);
    const costing = seeCosts
      ? costSummary(
          o.lines.map((l) => ({
            quantity: l.quantity.toString(),
            unitPriceMinor: decimalToMinor(l.unitPrice),
            unitCostMinor: l.unitCost === null ? null : decimalToMinor(l.unitCost),
          })),
          decimalToMinor(o.discount),
          extra,
        )
      : null;
    const gap = o.factoryQuoteId ? basisGap(o.factoryBasis, selling) : null;
    return {
      id: o.id,
      letter: o.letter,
      status: o.status,
      /** The factory whose offer this is (internal; null when priced from the customer's items). */
      factory: seeCosts ? (o.factoryQuote?.factory ?? null) : null,
      factoryQuoteId: seeCosts ? o.factoryQuoteId : null,
      leadTime: o.leadTime,
      /** The lead time we promise as days from a moment (null: only its words, an older option). */
      leadDays: o.leadDays,
      leadFrom: isLeadFrom(o.leadFrom) ? o.leadFrom : null,
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
        /** Freight and the like to reach the basis we sell on (part of the cost). */
        extraCost: fromMinor(costing.extraCostMinor),
      },
      ...(seeCosts
        ? {
            /** The factory's price basis this option was priced on, and what it takes to reach ours. */
            factoryBasis: o.factoryBasis,
            factoryBasisPlace: o.factoryBasisPlace,
            /** What the option's factory gives now (its offer's terms), to check the promise against. */
            factoryTerms: o.factoryQuote ? factoryTerms(o.factoryQuote, usualAdvance) : null,
            /** The day the supplier's prices end (a quotation is never valid longer than them). */
            factoryValidUntil: o.factoryQuote ? fromDbDateOrNull(o.factoryQuote.validUntil) : null,
            factoryCurrency: o.factoryQuote?.currency ?? null,
            /**
             * The supplier's prices that changed after this was quoted (canvas "From the supplier offer to the quotation",
             * change 7): each line's price then and now, in the offer's currency (now null: gone from the offer). Lines
             * quoted before the price was kept say nothing.
             */
            offerChanged: o.factoryQuote
              ? o.lines.flatMap((l, i) => {
                  if (l.factoryUnitPrice === null) return [];
                  const now = l.factoryQuoteLine?.unitPrice ?? null;
                  if (now !== null && now.equals(l.factoryUnitPrice)) return [];
                  return [{ no: no[i]!, description: l.description.split("\n")[0]!, was: l.factoryUnitPrice.toFixed(2), now: now?.toFixed(2) ?? null }];
                })
              : [],
            gap,
            costs: o.costs
              .sort((a, b) => BASIS_STEPS.indexOf(a.step) - BASIS_STEPS.indexOf(b.step))
              .map((c) => ({ step: c.step, amount: c.amount.toFixed(2), currency: c.currency, cost: c.cost.toFixed(2), note: c.note })),
          }
        : {}),
    };
  }

  private view(user: SessionUser, r: RevisionRow, items: { id: string; parentId: string | null; no: string }[], usualAdvance: number) {
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      currency: r.currency,
      incoterm: r.incoterm,
      incotermPlace: r.incotermPlace,
      portOfDischarge: r.portOfDischarge,
      depositPercent: Number(r.depositPercent),
      balanceTerms: r.balanceTerms,
      /** How the customer pays (null: not decided yet). */
      paymentRoute: r.paymentRoute,
      /** The payment as parts: the ones kept, else (an older quotation) its deposit and balance. */
      paymentParts: quotePartsOf(r),
      validUntil: fromDbDate(r.validUntil),
      /** The accepted option's figures (before that, Option A's), read from the options: `figuresOf` says which. */
      ...figuresOf(r),
      paymentTerms: r.paymentTerms,
      deliveryTerms: r.deliveryTerms,
      warranty: r.warranty,
      /** The warranty as months from a moment (null: only its words, an older quotation). */
      warrantyMonths: r.warrantyMonths,
      warrantyFrom: isWarrantyFrom(r.warrantyFrom) ? r.warrantyFrom : null,
      notes: r.notes,
      sentOn: fromDbDateOrNull(r.sentOn),
      /** How it went to the customer (null: not said, or sent before this was kept). */
      sentVia: r.sentVia as SentVia | null,
      answeredOn: fromDbDateOrNull(r.answeredOn),
      customerSnapshot: r.customerSnapshot,
      companySnapshot: r.companySnapshot,
      createdAt: r.createdAt,
      options: r.options.map((o) => this.optionView(user, o, items, r.incoterm, usualAdvance)),
    };
  }

  /** The deal's quotations, A, B, C… (by letter), each with its live revisions, newest first. */
  private async quotationsOf(db: Db, inquiryId: string) {
    const all = await db.quotation.findMany({
      where: { inquiryId },
      include: { revisions: { where: { deletedAt: null }, include: revisionInclude, orderBy: { number: "desc" } } },
    });
    return byLetter(all);
  }

  /** One quotation with its revisions, and whether a new revision can be started on it. */
  private quotationView(
    user: SessionUser,
    q: Awaited<ReturnType<QuotationsService["quotationsOf"]>>[number],
    items: { id: string; parentId: string | null; no: string }[],
    usual: number,
    stage: Parameters<typeof canQuote>[0],
  ) {
    const refs = q.revisions.map((r) => ({ number: r.number, status: r.status }));
    const start = canStartRevision(refs);
    return {
      id: q.id,
      refNo: q.refNo,
      letter: q.letter,
      revisions: q.revisions.map((r) => ({
        ...this.view(user, r, items, usual),
        canAnswer: canAnswer(refs, r.number),
        editable: isEditable(r.status),
      })),
      canStartRevision: canQuote(stage) && start.ok,
      whyNotStart: !canQuote(stage) ? "This inquiry is closed. Reopen it to quote again." : start.ok ? null : start.reason,
    };
  }

  async get(user: SessionUser, inquiryId: string) {
    const inquiry = await this.inquiries.find(user, inquiryId);
    const quotations = await this.quotationsOf(this.prisma.db, inquiryId);
    const items = await this.items(this.prisma.db, inquiryId);
    const settings = await this.settings.get();
    const usual = settings.sales.factoryAdvancePercent;
    // What New quotations starts with: the currency of the deal's latest quotation (else the customer's own, or
    // the company's), the usual validity and margin.
    const newest = quotations.flatMap((q) => q.revisions).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const newDefaults = {
      currency: newest?.currency ?? (await this.firstTerms(inquiry, settings)).currency,
      validUntil: addDays(this.clock.today(), settings.sales.quotationValidityDays),
      margin: settings.sales.defaultMarginPercent,
    };
    // A quotation whose drafts were all deleted is not shown (its letter is given to the next new one).
    const views = quotations.filter((q) => q.revisions.length > 0).map((q) => this.quotationView(user, q, items, usual, inquiry.stage));
    // The first quotation, as the page shows it until it lists them all (with none yet: R1 can be started).
    const first = views[0] ?? null;
    const open = canQuote(inquiry.stage);
    return {
      inquiry: { id: inquiry.id, refNo: inquiry.refNo, stage: inquiry.stage },
      quotation: first && { id: first.id, refNo: first.refNo, letter: first.letter },
      revisions: first?.revisions ?? [],
      canStartRevision: first ? first.canStartRevision : open,
      whyNotStart: first ? first.whyNotStart : open ? null : "This inquiry is closed. Reopen it to quote again.",
      /** Every quotation of the deal, A, B, C…, each with its revisions. */
      quotations: views,
      newDefaults,
    };
  }

  /** A revision's values as the editor sends them back (prices keyed by factory line, or by item without factory prices). */
  private asInput(r: RevisionRow): RevisionInput {
    return {
      // Stored as text; only the business's currencies can be saved.
      currency: r.currency as Currency,
      incoterm: r.incoterm,
      incotermPlace: r.incotermPlace,
      portOfDischarge: r.portOfDischarge,
      depositPercent: Number(r.depositPercent),
      balanceTerms: r.balanceTerms,
      paymentRoute: r.paymentRoute,
      // The parts it keeps (an older quotation: none, its deposit and balance say it), so a client that sends
      // these values back with another deposit or balance changes them as before.
      paymentParts: storedParts(r.paymentParts, "customer")?.map((p) => ({ ...p, rule: p.rule as QuotePartRule })) ?? null,
      validUntil: fromDbDate(r.validUntil),
      paymentTerms: r.paymentTerms,
      deliveryTerms: r.deliveryTerms,
      warranty: r.warranty,
      warrantyMonths: r.warrantyMonths,
      warrantyFrom: isWarrantyFrom(r.warrantyFrom) ? r.warrantyFrom : null,
      notes: r.notes,
      options: r.options.map((o) => ({
        factoryQuoteId: o.factoryQuoteId,
        discount: Number(o.discount),
        leadTime: o.leadTime,
        leadDays: o.leadDays,
        leadFrom: isLeadFrom(o.leadFrom) ? o.leadFrom : null,
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
        costs: o.costs.map((c) => ({ step: c.step, amount: Number(c.amount), currency: c.currency as Currency, note: c.note })),
      })),
    };
  }

  /**
   * Starting values for the next revision: a copy of the latest one (options
   * whose offer was removed are left out), or for R1 the offer that covers the
   * most items at the lowest cost, priced at the default margin.
   */
  async draft(user: SessionUser, inquiryId: string, quotationId?: string): Promise<RevisionInput & { number: number; from?: DraftFrom }> {
    const inquiry = await this.inquiries.find(user, inquiryId); // only for people who may see the deal
    const settings = await this.settings.get();
    const quotations = await this.quotationsOf(this.prisma.db, inquiryId);
    const q = quotationId ? quotations.find((x) => x.id === quotationId) : quotations[0];
    if (quotationId && !q) throw new NotFoundError("Quotation");
    const latest = q?.revisions[0];
    const validUntil = addDays(this.clock.today(), settings.sales.quotationValidityDays);
    const first = latest ? null : await this.firstTerms(inquiry, settings);
    const available = await this.offers(user, inquiryId, latest?.currency ?? first!.currency);
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
    // A quotation whose drafts were all deleted goes on from its last number (numbers are never used twice).
    const number = q ? ((await this.prisma.db.quotationRevision.aggregate({ where: { quotationId: q.id }, _max: { number: true } }))._max.number ?? 0) + 1 : 1;
    const best = [...available.offers].sort(
      (a, b) =>
        a.coverage.missing.length - b.coverage.missing.length ||
        a.unpriced - b.unpriced ||
        (a.totalCost === null ? 1 : b.totalCost === null ? -1 : Number(a.totalCost) - Number(b.totalCost)),
    )[0];
    return {
      number,
      currency: first!.currency,
      ...this.offerTerms(first!.terms, best),
      options: [this.optionFrom(best, available.items, settings.sales.defaultMarginPercent, settings.sales.leadSpareDays)],
      from: first!.from,
    };
  }

  /**
   * The terms a deal's first revision starts with (every one can be changed): the customer's own currency, when
   * Settings has a rate for it; the delivery terms of the last quotation to them; the company's usual payment,
   * conditions and warranty (as months from a moment when its words say them).
   */
  private async firstTerms(inquiry: { id: string; customerId: string }, settings: Settings) {
    const customer = await this.prisma.db.party.findUnique({ where: { id: inquiry.customerId }, select: { name: true, defaultCurrency: true } });
    const theirs = CURRENCIES.find((c) => c === customer?.defaultCurrency?.trim().toUpperCase()) ?? null;
    const currency = theirs && fxRate(theirs, settings.sales.currency, settings.sales.currency, settings.sales.exchangeRates) !== null ? theirs : settings.sales.currency;
    const before = await this.prisma.db.quotationRevision.findFirst({
      where: { deletedAt: null, status: { in: [...QUOTED_STATUSES] }, quotation: { inquiry: { customerId: inquiry.customerId, deletedAt: null, id: { not: inquiry.id } } } },
      orderBy: { createdAt: "desc" },
      select: { incoterm: true, incotermPlace: true, quotation: { select: { inquiry: { select: { refNo: true } } } } },
    });
    const usualWarranty = settings.sales.warrantyTerms?.replace(/^warranty\s*:\s*/i, "").slice(0, 300) || null;
    const warranty = parseWarranty(usualWarranty);
    const terms = {
      incoterm: before?.incoterm ?? settings.sales.defaultIncoterm,
      incotermPlace: before?.incotermPlace ?? null,
      portOfDischarge: null,
      depositPercent: settings.sales.defaultDepositPercent,
      balanceTerms: settings.sales.defaultBalanceTerms,
      // How they pay is decided later unless it is chosen here; the payment starts as the company's deposit and
      // balance (no parts kept until the form sends them).
      paymentRoute: null,
      paymentParts: null,
      validUntil: addDays(this.clock.today(), settings.sales.quotationValidityDays),
      paymentTerms: settings.sales.defaultPaymentTerms || null,
      deliveryTerms: settings.sales.defaultDeliveryTerms || null,
      ...(warranty
        ? { warrantyMonths: warranty.months, warrantyFrom: warranty.from, warranty: warranty.rest }
        : { warrantyMonths: null, warrantyFrom: null, warranty: usualWarranty }),
      notes: null,
    } satisfies Omit<RevisionInput, "currency" | "options">;
    const from: DraftFrom = {
      customer: customer?.name ?? null,
      currency: currency === theirs && currency !== settings.sales.currency ? "customer" : "settings",
      delivery: before ? "last_quotation" : "settings",
      lastQuotation: before?.quotation.inquiry.refNo ?? null,
    };
    return { currency, terms, from };
  }

  /**
   * A quotation made from a supplier's offer starts from what the offer says (canvas "From the supplier offer to the
   * quotation", 19 Nov): the offer's place when we quote its Incoterm at its end (FOB Qingdao, not just FOB); its
   * warranty (12 months from shipment), so the promise is covered; and never valid longer than its prices (cut at the
   * offer's last day, while that is still ahead). Everything can still be changed in the draft.
   */
  private offerTerms<T extends { incoterm: Incoterm; incotermPlace: string | null; warrantyMonths: number | null; warrantyFrom: string | null; validUntil: ISODate }>(
    terms: T,
    offer: OfferChoice | null | undefined,
  ): T {
    if (!offer) return terms;
    const out = { ...terms };
    if (offer.basis && offer.basis === terms.incoterm && AT_THE_SUPPLIER.has(offer.basis) && offer.basisPlace?.trim()) out.incotermPlace = offer.basisPlace.trim();
    if (offer.terms.warrantyMonths !== null && offer.terms.warrantyFrom) {
      out.warrantyMonths = offer.terms.warrantyMonths;
      out.warrantyFrom = offer.terms.warrantyFrom;
    }
    if (offer.validUntil && offer.validUntil >= this.clock.today() && offer.validUntil < out.validUntil) out.validUntil = offer.validUntil as ISODate;
    return out;
  }

  /**
   * An option quoting one factory offer: its lines priced at `margin` (on the price) over their cost, and what
   * the factory gives promised to the customer from the same moment (the days can be raised; an older offer's
   * words as they are). Without an offer: the customer's items, to be priced by hand.
   */
  private optionFrom(
    offer: OfferChoice | null | undefined,
    items: { id: string }[],
    margin: number,
    /** Added to the supplier's days (Settings: leadSpareDays). */
    spare = 0,
  ): OptionInput {
    if (!offer) return { factoryQuoteId: null, discount: 0, leadTime: null, leadDays: null, leadFrom: null, charges: [], costs: [], prices: items.map((i) => ({ lineId: i.id, unitPrice: 0 })) };
    return {
      factoryQuoteId: offer.factoryQuoteId,
      discount: 0,
      ...(offer.leadDays !== null
        ? { leadDays: offer.leadDays + spare, leadFrom: offer.leadFrom, leadTime: leadWords(offer.leadDays + spare, offer.leadFrom, "customer") }
        : { leadTime: offer.leadTime }),
      charges: [],
      costs: [],
      prices: offer.lines.map((l) => ({
        lineId: l.id,
        unitPrice: l.unitCost === null ? 0 : Number(fromMinor(priceForMargin(toMinor(l.unitCost), margin))),
      })),
    };
  }

  /**
   * New quotations (design "one way, any number"): one draft for each offer ticked, or one from the customer's
   * items priced by hand (null), each its own quotation: QUO-2026-0531-B, -C… An offer already quoted can be
   * quoted again on other terms. A quotation whose drafts were all deleted before any was sent gives its letter
   * back first. Each starts in the currency, validity and margin chosen, with the deal's usual first terms.
   */
  async createQuotations(user: SessionUser, inquiryId: string, input: NewQuotationsInput) {
    this.assertCan(user);
    const settings = await this.settings.get();
    const seen = await this.inquiries.find(user, inquiryId);
    const first = await this.firstTerms(seen, settings);
    const available = await this.offers(user, inquiryId, input.currency);
    if (input.offers.some((id) => id) && !can(user, "sourcing.manage")) throw new ForbiddenError("Only people who see supplier prices can quote a supplier's offer.");
    const made = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from inquiries where id = ${inquiryId}::uuid for update`;
      const inquiry = await this.inquiries.findWorkable(user, inquiryId, tx);
      if (!canQuote(inquiry.stage)) throw new DomainError("This inquiry is closed. Reopen it to quote again.");
      const existing = byLetter(await tx.quotation.findMany({ where: { inquiryId }, include: { revisions: { select: { status: true, deletedAt: true } } } }));
      const free = existing.filter((q) => q.revisions.every((r) => r.status === "draft" && r.deletedAt !== null));
      const letters = existing.map((q) => q.letter);
      let base = existing[0] ? quotationBase(existing[0]) : null;
      const out: { id: string; refNo: string; letter: string; revisionId: string; number: number }[] = [];
      for (const offerId of input.offers) {
        const offer = offerId ? available.offers.find((o) => o.factoryQuoteId === offerId) : null;
        if (offerId && !offer) throw new DomainError("One of the offers is no longer on this inquiry, or has no items yet. Reload the page.");
        const values: RevisionInput = {
          ...this.offerTerms({ ...first.terms, validUntil: input.validUntil }, offer),
          currency: input.currency as Currency,
          options: [this.optionFrom(offer, available.items, input.margin, settings.sales.leadSpareDays)],
        };
        let q = free.shift() ?? null;
        if (!q) {
          base ??= await nextReference(tx, "quotation", Number(this.clock.today().slice(0, 4)));
          const letter = nextQuotationLetter(letters);
          letters.push(letter);
          q = { ...(await tx.quotation.create({ data: { inquiryId, letter, refNo: quotationNumber(base, letter) } })), revisions: [] };
        }
        const max = await tx.quotationRevision.aggregate({ where: { quotationId: q.id }, _max: { number: true } });
        const number = (max._max.number ?? 0) + 1;
        const { built, header } = await this.rows(tx, user, inquiryId, values);
        const rev = await tx.quotationRevision.create({ data: { ...header, quotationId: q.id, number, createdById: user.id } });
        await this.writeOptions(tx, rev.id, built);
        await this.audit.record(tx, {
          userId: user.id,
          action: "create",
          entityType: "quotation",
          entityId: rev.id,
          summary: `${q.refNo} R${number} drafted for ${inquiry.refNo} from ${offer ? `${offer.factory.name}'s offer` : "own prices"} — ${input.currency} ${String(built[0]!.option.total)}`,
        });
        out.push({ id: q.id, refNo: q.refNo, letter: q.letter, revisionId: rev.id, number });
      }
      return out;
    });
    return { quotations: made };
  }

  /** The quotation (any of the deal's), for people who may see its deal. */
  private async quotationOfId(user: SessionUser, quotationId: string) {
    const q = await this.prisma.db.quotation.findUnique({ where: { id: quotationId }, select: { id: true, inquiryId: true } });
    if (!q) throw new NotFoundError("Quotation");
    await this.inquiries.find(user, q.inquiryId);
    return q;
  }

  /** Starting values for a quotation's next revision (a copy of its latest). */
  async draftFor(user: SessionUser, quotationId: string) {
    const q = await this.quotationOfId(user, quotationId);
    return this.draft(user, q.inquiryId, q.id);
  }

  /** A quotation's next revision (after the customer has seen one: with the reason it changes). */
  async createRevisionOn(user: SessionUser, quotationId: string, input: RevisionInput) {
    const q = await this.quotationOfId(user, quotationId);
    return this.createRevision(user, q.inquiryId, input, q.id);
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
      costs: Omit<Prisma.OptionCostCreateManyInput, "optionId">[];
    }[] = [];
    for (const [n, o] of input.options.entries()) {
      const letter = optionLetter(n);
      const priceOf = (id: string, what: string) => {
        const p = o.prices.find((x) => x.lineId === id);
        if (!p) throw new DomainError(`Option ${letter}: enter a price for "${what.split("\n")[0]!.slice(0, 60)}".`);
        return p.unitPrice;
      };
      const lines: Omit<Prisma.QuoteLineCreateManyInput, "revisionId" | "optionId" | "lineTotal">[] = [];
      let basis: { factoryBasis: Incoterm | null; factoryBasisPlace: string | null } = { factoryBasis: null, factoryBasisPlace: null };
      if (o.factoryQuoteId) {
        if (!can(user, "sourcing.manage")) throw new ForbiddenError("Only people who see supplier prices can quote a supplier's offer.");
        if (seen.has(o.factoryQuoteId)) throw new DomainError("Each option must be a different supplier's offer.");
        seen.add(o.factoryQuoteId);
        const q = await tx.factoryQuote.findFirst({
          where: { id: o.factoryQuoteId, inquiryId, deletedAt: null },
          include: { lines: { orderBy: { sortOrder: "asc" } } },
        });
        if (!q) throw new DomainError(`Option ${letter}: that supplier offer is no longer on this inquiry. Reload the page.`);
        basis = { factoryBasis: q.basis, factoryBasisPlace: q.basisPlace };
        const rate = fxRate(q.currency, input.currency, sales.currency, sales.exchangeRates);
        for (const l of q.lines) {
          const cost = rate ? convertMinor(quoteUnitCostMinor(decimalToMinor(l.unitPrice), Number(l.taxRate), q.taxIncluded, sales.exportVatRefundPercent), rate) : null;
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
            factoryUnitPrice: l.unitPrice,
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
      // Costs between the factory's basis and ours, in the quotation's currency at today's rate.
      const costs: Omit<Prisma.OptionCostCreateManyInput, "optionId">[] = [];
      for (const c of o.costs.filter((x) => Number(x.amount) > 0)) {
        if (!can(user, "sourcing.manage")) throw new ForbiddenError("Only people who see supplier prices can enter costs.");
        if (costs.some((x) => x.step === c.step)) throw new DomainError(`Option ${letter}: ${BASIS_STEP_LABEL[c.step]} is entered twice.`);
        const rate = fxRate(c.currency, input.currency, sales.currency, sales.exchangeRates);
        if (rate === null) throw new DomainError(`Option ${letter}: there is no exchange rate for ${c.currency} in Settings, so ${BASIS_STEP_LABEL[c.step].toLowerCase()} cannot be turned into ${input.currency}.`);
        costs.push({ step: c.step, amount: c.amount, currency: c.currency, cost: fromMinor(convertMinor(toMinor(c.amount), rate)), fxRate: rate, note: c.note ?? null });
      }
      const totals = documentTotals(
        lines.map((l) => ({ quantity: String(l.quantity), unitPrice: String(l.unitPrice) })),
        o.discount,
      );
      // A draft can wait for its prices (own prices start at 0); sending needs them (see move).
      if (totals.total < 0) throw new DomainError(`Option ${letter}: the discount is more than the items.`);
      if (totals.total > MAX_TOTAL_MINOR) throw new DomainError(`Option ${letter}: the total is too large.`);
      built.push({
        option: {
          letter,
          sortOrder: n,
          factoryQuoteId: o.factoryQuoteId ?? null,
          ...basis,
          ...optionLead(o),
          subtotal: fromMinor(totals.subtotal),
          discount: fromMinor(totals.discount),
          total: fromMinor(totals.total),
        },
        lines: lines.map((l, k) => ({ ...l, lineTotal: fromMinor(totals.lines[k]!.lineTotal), sortOrder: k })),
        costs,
      });
    }
    // The payment as parts (design "terms that travel"): the deposit and the balance's rule are worked out from
    // them, for what reads those. Sent without parts (an older client): its deposit and balance, no parts kept.
    const parts = input.paymentParts ?? null;
    const months = input.warrantyMonths;
    return {
      built,
      header: {
        currency: input.currency,
        incoterm: input.incoterm,
        incotermPlace: input.incotermPlace,
        depositPercent: parts ? depositOfParts(parts) : input.depositPercent,
        balanceTerms: parts ? balanceTermsOfParts(parts) : input.balanceTerms,
        paymentParts: parts ?? Prisma.DbNull,
        validUntil: toDbDate(input.validUntil),
        paymentTerms: input.paymentTerms,
        deliveryTerms: input.deliveryTerms,
        notes: input.notes,
        // Left out by an older form: kept as it is.
        ...(input.portOfDischarge !== undefined ? { portOfDischarge: input.portOfDischarge } : {}),
        ...(input.paymentRoute !== undefined ? { paymentRoute: input.paymentRoute } : {}),
        ...(input.warranty !== undefined ? { warranty: input.warranty } : {}),
        ...(months !== undefined ? { warrantyMonths: months, warrantyFrom: months === null ? null : (input.warrantyFrom ?? "shipment") } : {}),
      },
    };
  }

  private async writeOptions(tx: Tx, revisionId: string, built: Awaited<ReturnType<QuotationsService["rows"]>>["built"]) {
    for (const b of built) {
      const o = await tx.quotationOption.create({ data: { ...b.option, revisionId } });
      await tx.quoteLine.createMany({ data: b.lines.map((l) => ({ ...l, revisionId, optionId: o.id })) });
      if (b.costs.length) await tx.optionCost.createMany({ data: b.costs.map((c) => ({ ...c, optionId: o.id })) });
    }
  }

  async createRevision(user: SessionUser, inquiryId: string, input: RevisionInput, quotationId?: string) {
    this.assertCan(user);
    const id = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from inquiries where id = ${inquiryId}::uuid for update`;
      const inquiry = await this.inquiries.findWorkable(user, inquiryId, tx);
      if (!canQuote(inquiry.stage)) throw new DomainError("This inquiry is closed. Reopen it to quote again.");
      const quotations = byLetter(
        await tx.quotation.findMany({
          where: { inquiryId },
          include: { revisions: { where: { deletedAt: null }, select: { number: true, status: true } } },
        }),
      );
      let q = quotationId ? quotations.find((x) => x.id === quotationId) : quotations[0];
      if (quotationId && !q) throw new NotFoundError("Quotation");
      const refs = (q?.revisions ?? []).map((r) => ({ number: r.number, status: r.status }));
      const start = canStartRevision(refs);
      if (!start.ok) throw new GateError(start.reason, "revision_blocked");
      // The deal's first quotation: a new QUO number, with its letter (QUO-2026-0531-A).
      if (!q) {
        const letter = nextQuotationLetter(quotations.map((x) => x.letter));
        const base = await nextReference(tx, "quotation", Number(this.clock.today().slice(0, 4)));
        q = { ...(await tx.quotation.create({ data: { inquiryId, letter, refNo: quotationNumber(base, letter) } })), revisions: [] };
      }
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
    const usual = (await this.settings.get()).sales.factoryAdvancePercent;
    return {
      quotation: { id: r.quotation.id, refNo: r.quotation.refNo, letter: r.quotation.letter, inquiryId: r.quotation.inquiryId },
      ...this.view(user, r, items, usual),
    };
  }

  /**
   * A draft whose supplier offer changed after it was made (canvas "From the supplier offer to the quotation", change
   * 7): `update` prices each line again at the margin it had, on the offer's cost now; `keep` keeps its prices on the
   * offer's cost now (the margin moves). Either way the draft is saved on the offer as it is now, so it says nothing more.
   */
  async offerPrices(user: SessionUser, revisionId: string, mode: "update" | "keep") {
    this.assertCan(user);
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("Only people who see supplier prices can take an offer's new prices.");
    const { r } = await this.loadRevision(user, revisionId);
    if (!isEditable(r.status)) throw new DomainError("Only a draft takes the offer's new prices. Start a new revision to change what the customer has seen.");
    const input = this.asInput(r);
    if (mode === "update") {
      const available = await this.offers(user, r.quotation.inquiryId, r.currency);
      input.options = input.options.map((o, n) => {
        const row = r.options[n];
        const offer = o.factoryQuoteId ? available.offers.find((x) => x.factoryQuoteId === o.factoryQuoteId) : null;
        if (!row || !offer) return o;
        return {
          ...o,
          prices: o.prices.map((p) => {
            const line = row.lines.find((l) => l.factoryQuoteLineId === p.lineId);
            const now = offer.lines.find((l) => l.id === p.lineId)?.unitCost ?? null;
            if (!line || line.unitCost === null || now === null || !(Number(line.unitPrice) > 0)) return p;
            // The margin it had, exactly (on the price), on the cost now.
            const margin = ((Number(line.unitPrice) - Number(line.unitCost)) / Number(line.unitPrice)) * 100;
            if (!(margin < 100)) return p;
            return { ...p, unitPrice: Number(fromMinor(priceForMargin(toMinor(now), margin))) };
          }),
        };
      });
    }
    return this.updateRevision(user, revisionId, input);
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
   * Emails the revision to the customer with its PDF (made by the web app from
   * the print page) and, while it is a draft, marks it sent "By email to …".
   */
  async email(user: SessionUser, revisionId: string, input: { to: string[]; cc: string[]; subject: string; message?: string | null; pdf?: string | null; fileName?: string | null }) {
    this.assertCan(user);
    const head = await this.prisma.db.quotationRevision.findFirst({ where: { id: revisionId, deletedAt: null }, include: { quotation: true } });
    if (!head) throw new NotFoundError("Quotation");
    const { r, inquiry } = await this.loadRevision(user, revisionId, this.prisma.db);
    await this.inquiries.findWorkable(user, inquiry.id, this.prisma.db);
    if (r.status !== "draft" && r.status !== "sent") throw new GateError(`A ${r.status} revision is not sent again.`, "revision_move");
    // The company's own email (Admin settings › Email sending), else the server's.
    const mailer = await this.mail.mailer();
    if (!mailer.enabled)
      throw new DomainError("Email is not set up yet (an admin sets it under Admin settings › Email sending). Download the PDF, send it yourself, then use “Sent another way — mark as sent”.");
    await mailer.send({
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      subject: input.subject,
      text: input.message?.trim() || input.subject,
      replyTo: user.email ?? undefined,
      attachments: input.pdf ? [{ filename: input.fileName || `${head.quotation.refNo} R${r.number}.pdf`, content: Buffer.from(input.pdf, "base64"), contentType: "application/pdf" }] : undefined,
    });
    const how = `By email to ${input.to.join(", ")}`;
    if (r.status === "draft") return this.move(user, revisionId, "sent", null, how, null, { via: "email" });
    await this.audit.record(this.prisma.db, {
      userId: user.id,
      action: "update",
      entityType: "quotation",
      entityId: r.id,
      summary: `${head.quotation.refNo} R${r.number} emailed again to ${input.to.join(", ")}`,
    });
    return { ok: true };
  }

  /** Drafts of one inquiry to send together: each its quotation's newest, still a draft, with a price. */
  private async sendable(user: SessionUser, inquiryId: string, revisionIds: string[]) {
    this.assertCan(user);
    const inquiry = await this.inquiries.findWorkable(user, inquiryId);
    if (!canQuote(inquiry.stage)) throw new DomainError("This inquiry is closed. Reopen it to quote again.");
    const revs = await this.prisma.db.quotationRevision.findMany({
      where: { id: { in: revisionIds }, deletedAt: null, quotation: { inquiryId } },
      select: { id: true, number: true, status: true, quotation: { select: { refNo: true } }, options: { select: { total: true } } },
    });
    if (revs.length !== new Set(revisionIds).size) throw new DomainError("One of the quotations is no longer on this inquiry. Reload the page.");
    for (const r of revs) {
      if (r.status !== "draft") throw new GateError(`${r.quotation.refNo} R${r.number} was sent already.`, "revision_move");
      if (r.options.some((o) => !(Number(o.total) > 0))) throw new DomainError(`Price ${r.quotation.refNo} R${r.number} before sending: it comes to 0.`);
    }
    return revisionIds.map((id) => revs.find((r) => r.id === id)!);
  }

  /**
   * Several quotations in one email (design "one way, any number"): their PDFs attached (made by the web app,
   * in the same order), then each draft marked sent by email.
   */
  async emailMany(user: SessionUser, inquiryId: string, input: { revisionIds: string[]; to: string[]; cc: string[]; subject: string; message?: string | null }, pdfs: { buffer: Buffer }[]) {
    const revs = await this.sendable(user, inquiryId, input.revisionIds);
    const mailer = await this.mail.mailer();
    if (!mailer.enabled)
      throw new DomainError("Email is not set up yet (an admin sets it under Admin settings › Email sending). Download the PDFs, send them yourself, then use “I sent it myself”.");
    await mailer.send({
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      subject: input.subject,
      text: input.message?.trim() || input.subject,
      replyTo: user.email ?? undefined,
      // Each PDF is named for its quotation here ("QUO-2026-0531-C R1.pdf"), whatever the file was called.
      attachments: pdfs.length
        ? revs.flatMap((r, i) => (pdfs[i] ? [{ filename: `${r.quotation.refNo} R${r.number}.pdf`, content: pdfs[i].buffer, contentType: "application/pdf" }] : []))
        : undefined,
    });
    const how = `By email to ${input.to.join(", ")}`;
    for (const r of revs) await this.move(user, r.id, "sent", null, how, null, { via: "email" });
    return { sent: revs.map((r) => `${r.quotation.refNo} R${r.number}`) };
  }

  /** Several drafts marked sent at once (sent another way). */
  async markManySent(user: SessionUser, inquiryId: string, input: { revisionIds: string[]; on?: ISODate | null; via?: SentVia }) {
    const revs = await this.sendable(user, inquiryId, input.revisionIds);
    const how = input.via ? `Sent ${SENT_VIA_TEXT[input.via]}` : null;
    for (const r of revs) await this.move(user, r.id, "sent", input.on ?? null, how, null, { via: input.via });
    return { sent: revs.map((r) => `${r.quotation.refNo} R${r.number}`) };
  }

  /**
   * Draft → sent (frozen, with who it was for and from), older sent revisions
   * superseded, the deal moves to Quoted. Then: accepted — exactly one option,
   * the others not chosen; the order is made from it and the deal is Won; the
   * deal's other quotations the customer has become Not chosen and their drafts
   * are put away — rejected, or expired; only on the newest sent revision.
   */
  async move(
    user: SessionUser,
    revisionId: string,
    to: Exclude<RevisionStatus, "draft" | "superseded" | "void">,
    on: ISODate | null,
    reasonInput?: string | null,
    optionId?: string | null,
    /** Accepted: the customer's PO or reference, and the payment route when it is not the one the terms imply. Sent: how it went. */
    accept: { customerRef?: string | null; route?: PaymentRoute; via?: SentVia } = {},
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
        if (r.options.some((o) => !(Number(o.total) > 0)))
          throw new DomainError(r.options.length > 1 ? "Price every option before sending: one of them comes to 0." : "Price the items before sending: the quotation comes to 0.");
        if (!canQuote(inquiry.stage)) throw new DomainError("This inquiry is closed. Reopen it to quote again.");
        const settings = await this.settings.get();
        await tx.quotationRevision.update({
          where: { id: r.id },
          data: {
            status: "sent",
            sentOn: toDbDate(day),
            sentVia: accept.via ?? null,
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
          // One quotation of the deal is accepted.
          const taken = await tx.quotationRevision.findFirst({
            where: { status: "accepted", deletedAt: null, quotation: { inquiryId: inquiry.id, id: { not: r.quotationId } } },
            select: { number: true, quotation: { select: { refNo: true } } },
          });
          if (taken)
            throw new GateError(`The customer already accepted ${taken.quotation.refNo} R${taken.number}. Cancel its order to accept another quotation.`, "revision_move");
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
            data: { status: to, answeredOn: toDbDate(day) },
          });
          const drafts = draftsDiscardedBy(refs, r.number);
          if (drafts.length)
            await tx.quotationRevision.updateMany({
              where: { quotationId: r.quotationId, number: { in: drafts } },
              data: { deletedAt: new Date() },
            });
          const { event } = await this.orders.createFromRevision(tx, r.id, chosen.id, day, user.id, accept);
          events.push(event);
          // The deal's other quotations: what the customer has is Not chosen (kept exactly as sent), and their
          // drafts are put away. Answered ones (rejected, expired) stay as they are.
          const others = await tx.quotationRevision.findMany({
            where: { deletedAt: null, status: { in: ["sent", "draft"] }, quotation: { inquiryId: inquiry.id, id: { not: r.quotationId } } },
            select: { id: true, number: true, status: true, quotation: { select: { refNo: true } } },
          });
          const notChosen = others.filter((o) => o.status === "sent");
          if (notChosen.length)
            await tx.quotationRevision.updateMany({ where: { id: { in: notChosen.map((o) => o.id) } }, data: { status: "not_chosen", answeredOn: toDbDate(day) } });
          const putAway = others.filter((o) => o.status === "draft");
          if (putAway.length) await tx.quotationRevision.updateMany({ where: { id: { in: putAway.map((o) => o.id) } }, data: { deletedAt: new Date() } });
          for (const o of notChosen)
            await this.audit.record(tx, {
              userId: user.id,
              action: "status_change",
              entityType: "quotation",
              entityId: o.id,
              summary: `${o.quotation.refNo} R${o.number}: sent → not chosen (the customer accepted ${r.quotation.refNo} R${r.number})`,
              oldValues: { status: "sent" },
              newValues: { status: "not_chosen" },
            });
          for (const o of putAway)
            await this.audit.record(tx, {
              userId: user.id,
              action: "delete",
              entityType: "quotation",
              entityId: o.id,
              summary: `${o.quotation.refNo} R${o.number} draft put away (the customer accepted ${r.quotation.refNo} R${r.number})`,
            });
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
        revisionId: r.id,
        reason: reason ?? null,
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
