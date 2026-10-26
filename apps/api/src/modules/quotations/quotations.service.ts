import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDate, fromDbDateOrNull, nextReference, toDbDate, type Prisma } from "@kebo/database";
import { costSummary, documentTotals, fromMinor, priceForMargin, toMinor } from "@kebo/money";
import {
  can,
  canAnswer,
  canMoveRevision,
  canQuote,
  canStartRevision,
  draftsDiscardedBy,
  isEditable,
  latestRevision,
  supersededBy,
  type RevisionInput,
  type RevisionStatus,
  type Settings, saleVatFor } from "@kebo/shared";
import { addDays, DomainError, ForbiddenError, GateError, NotFoundError, type ISODate } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { EventBus, type DomainEvent } from "../../common/events/event-bus";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { InquiriesService } from "../inquiries/inquiries.service";
import { StagesService } from "../inquiries/stages.service";
import { SourcingService } from "../sourcing/sourcing.service";
import { OrdersService } from "../orders/orders.service";

/** NUMERIC(14,2) can hold up to this; totals above it are refused with a clear message. */
const MAX_TOTAL_MINOR = 999_999_999_999_99;

const revisionInclude = { lines: { orderBy: { sortOrder: "asc" } } } satisfies Prisma.QuotationRevisionInclude;
type RevisionRow = Prisma.QuotationRevisionGetPayload<{ include: typeof revisionInclude }>;

/** What is frozen on a document when it is sent or issued. */
export function companySnapshot(s: Settings) {
  return { ...s.company };
}

export async function customerSnapshot(tx: Tx, customerId: string, contactId: string | null) {
  const c = await tx.customer.findUniqueOrThrow({ where: { id: customerId }, include: { contacts: { where: { deletedAt: null }, orderBy: { isPrimary: "desc" } } } });
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

/**
 * One quotation per deal, with revisions. A revision is edited only as a draft;
 * sending freezes it (and replaces the older sent one); the customer's answer
 * is recorded on the newest sent revision; acceptance creates the order.
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
    private readonly sourcing: SourcingService,
    private readonly orders: OrdersService,
  ) {}

  /* ---------------------------------------------------------------- reading */

  private view(user: SessionUser, r: RevisionRow) {
    const seeCosts = can(user.role, "sourcing.manage");
    const vat = { rate: Number(r.vatRate), pricesIncludeVat: r.pricesIncludeVat };
    const costing = seeCosts
      ? costSummary(
          r.lines.map((l) => ({ quantity: l.quantity.toString(), unitPriceMinor: decimalToMinor(l.unitPrice), unitCostMinor: l.unitCost === null ? null : decimalToMinor(l.unitCost) })),
          vat,
          decimalToMinor(r.discount),
        )
      : null;
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      currency: r.currency,
      incoterm: r.incoterm,
      incotermPlace: r.incotermPlace,
      depositPercent: Number(r.depositPercent),
      balanceTerms: r.balanceTerms,
      leadTime: r.leadTime,
      validUntil: fromDbDate(r.validUntil),
      vatRate: Number(r.vatRate),
      pricesIncludeVat: r.pricesIncludeVat,
      subtotal: r.subtotal.toFixed(2),
      discount: r.discount.toFixed(2),
      vatAmount: r.vatAmount.toFixed(2),
      total: r.total.toFixed(2),
      terms: r.terms,
      notes: r.notes,
      sentOn: fromDbDateOrNull(r.sentOn),
      answeredOn: fromDbDateOrNull(r.answeredOn),
      customerSnapshot: r.customerSnapshot,
      companySnapshot: r.companySnapshot,
      createdAt: r.createdAt,
      lines: r.lines.map((l) => ({
        id: l.id,
        requestedItemId: l.requestedItemId,
        type: l.type,
        description: l.description,
        model: l.model,
        hsCode: l.hsCode,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: l.unitPrice.toFixed(2),
        lineTotal: l.lineTotal.toFixed(2),
        ...(seeCosts ? { unitCost: l.unitCost?.toFixed(2) ?? null, factoryQuoteLineId: l.factoryQuoteLineId, fxRate: l.fxRate?.toString() ?? null } : {}),
      })),
      costing: costing && { ...costing, cost: fromMinor(costing.costMinor), sales: fromMinor(costing.salesMinor), profit: fromMinor(costing.profitMinor) },
    };
  }

  async get(user: SessionUser, inquiryId: string) {
    const inquiry = await this.inquiries.find(user, inquiryId);
    const q = await this.prisma.db.quotation.findUnique({
      where: { inquiryId },
      include: { revisions: { where: { deletedAt: null }, include: revisionInclude, orderBy: { number: "desc" } } },
    });
    const revisions = q?.revisions ?? [];
    const refs = revisions.map((r) => ({ number: r.number, status: r.status }));
    const start = canStartRevision(refs);
    return {
      inquiry: { id: inquiry.id, refNo: inquiry.refNo, stage: inquiry.stage },
      quotation: q && { id: q.id, refNo: q.refNo },
      revisions: revisions.map((r) => ({ ...this.view(user, r), canAnswer: canAnswer(refs, r.number), editable: isEditable(r.status) })),
      canStartRevision: canQuote(inquiry.stage) && start.ok,
      whyNotStart: !canQuote(inquiry.stage) ? "This deal is closed. Reopen it to quote again." : start.ok ? null : start.reason,
    };
  }

  /** Starting values for the next revision: a copy of the latest, or R1 priced from factory costs plus the default margin. */
  async draft(user: SessionUser, inquiryId: string): Promise<RevisionInput & { number: number }> {
    const inquiry = await this.inquiries.find(user, inquiryId);
    const settings = await this.settings.get();
    const customer = await this.prisma.db.customer.findUniqueOrThrow({ where: { id: inquiry.customerId } });
    const q = await this.prisma.db.quotation.findUnique({ where: { inquiryId }, include: { revisions: { where: { deletedAt: null }, include: revisionInclude, orderBy: { number: "desc" } } } });
    const latest = q?.revisions[0];
    const seeCosts = can(user.role, "sourcing.manage");
    const validUntil = addDays(this.clock.today(), settings.sales.quotationValidityDays);
    if (latest) {
      const v = this.view(user, latest);
      return {
        number: latest.number + 1,
        currency: v.currency,
        incoterm: v.incoterm,
        incotermPlace: v.incotermPlace,
        depositPercent: v.depositPercent,
        balanceTerms: v.balanceTerms,
        leadTime: v.leadTime,
        validUntil: v.validUntil < this.clock.today() ? validUntil : v.validUntil,
        vatRate: v.vatRate,
        discount: Number(v.discount),
        terms: v.terms,
        notes: v.notes,
        lines: latest.lines.map((l) => ({
          requestedItemId: l.requestedItemId,
          type: l.type,
          description: l.description,
          model: l.model,
          hsCode: l.hsCode,
          quantity: Number(l.quantity),
          unit: l.unit,
          unitPrice: Number(l.unitPrice),
          unitCost: seeCosts && l.unitCost !== null ? Number(l.unitCost) : null,
          factoryQuoteLineId: seeCosts ? l.factoryQuoteLineId : null,
          fxRate: seeCosts && l.fxRate !== null ? Number(l.fxRate) : null,
        })),
      };
    }
    // VAT on the sale comes from where the customer is: none for exports, 13% in China.
    const vatRate = saleVatFor(customer.country);
    const options = seeCosts ? (await this.sourcing.forInquiry(user, inquiryId)).items : [];
    const items = await this.prisma.db.requestedItem.findMany({ where: { inquiryId }, orderBy: { sortOrder: "asc" } });
    return {
      number: 1,
      currency: settings.sales.currency,
      incoterm: settings.sales.defaultIncoterm,
      incotermPlace: null,
      depositPercent: settings.sales.defaultDepositPercent,
      balanceTerms: settings.sales.defaultBalanceTerms,
      leadTime: null,
      validUntil,
      vatRate,
      discount: 0,
      terms: settings.sales.defaultTerms || null,
      notes: null,
      lines: items.map((it) => {
        const option = options.find((o) => o.id === it.id);
        const line = option?.options.find((o) => o.id === option.preferredLineId) ?? option?.options.find((o) => o.id === option?.cheapestLineId);
        const cost = line?.unitCost ? toMinor(line.unitCost) : null;
        return {
          requestedItemId: it.id,
          type: "goods" as const,
          description: it.description,
          model: it.model ?? line?.model ?? null,
          hsCode: line?.hsCode ?? null,
          quantity: Number(it.quantity),
          unit: it.unit,
          unitPrice: cost === null ? 0 : Number(fromMinor(priceForMargin(cost, settings.sales.defaultMarginPercent))),
          unitCost: cost === null ? null : Number(fromMinor(cost)),
          factoryQuoteLineId: line?.id ?? null,
          fxRate: null,
        };
      }),
    };
  }

  /* ---------------------------------------------------------------- writing revisions */

  private assertCan(user: SessionUser) {
    if (!can(user.role, "quotations.manage")) throw new ForbiddenError("You cannot make quotations.");
  }

  /** Totals and line rows from the input; cost links must belong to this deal; people who may not see costs keep the stored ones. */
  private async rows(tx: Tx, user: SessionUser, inquiryId: string, input: RevisionInput, keepCostsFrom?: RevisionRow) {
    const totals = documentTotals(
      input.lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
      input.discount,
      { rate: input.vatRate, pricesIncludeVat: false },
    );
    if (totals.total <= 0) throw new DomainError("The quotation total must be more than zero.");
    if (totals.total > MAX_TOTAL_MINOR) throw new DomainError("The quotation total is too large.");
    const items = new Set((await tx.requestedItem.findMany({ where: { inquiryId }, select: { id: true } })).map((r) => r.id));
    const factoryLines = new Set((await tx.factoryQuoteLine.findMany({ where: { factoryQuote: { inquiryId } }, select: { id: true } })).map((r) => r.id));
    const seeCosts = can(user.role, "sourcing.manage");
    const lines = input.lines.map((l, i) => {
      const kept = !seeCosts ? keepCostsFrom?.lines.find((k) => k.requestedItemId && k.requestedItemId === l.requestedItemId) : undefined;
      return {
        requestedItemId: l.requestedItemId && items.has(l.requestedItemId) ? l.requestedItemId : null,
        type: l.type,
        description: l.description,
        model: l.model,
        hsCode: l.hsCode,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        lineTotal: fromMinor(totals.lines[i].lineTotal),
        unitCost: seeCosts ? (l.unitCost ?? null) : (kept?.unitCost ?? null),
        factoryQuoteLineId: seeCosts ? (l.factoryQuoteLineId && factoryLines.has(l.factoryQuoteLineId) ? l.factoryQuoteLineId : null) : (kept?.factoryQuoteLineId ?? null),
        fxRate: seeCosts ? (l.fxRate ?? null) : (kept?.fxRate ?? null),
        sortOrder: i,
      };
    });
    return {
      lines,
      header: {
        currency: input.currency,
        incoterm: input.incoterm,
        incotermPlace: input.incotermPlace,
        depositPercent: input.depositPercent,
        balanceTerms: input.balanceTerms,
        leadTime: input.leadTime,
        validUntil: toDbDate(input.validUntil),
        // VAT is added on top (older revisions may have had prices including VAT; they keep it).
        vatRate: input.vatRate,
        pricesIncludeVat: false,
        subtotal: fromMinor(totals.subtotal),
        discount: fromMinor(totals.discount),
        vatAmount: fromMinor(totals.vat),
        total: fromMinor(totals.total),
        terms: input.terms,
        notes: input.notes,
      },
    };
  }

  async createRevision(user: SessionUser, inquiryId: string, input: RevisionInput) {
    this.assertCan(user);
    const id = await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from inquiries where id = ${inquiryId}::uuid for update`;
      const inquiry = await this.inquiries.findWorkable(user, inquiryId, tx);
      if (!canQuote(inquiry.stage)) throw new DomainError("This deal is closed. Reopen it to quote again.");
      let q = await tx.quotation.findUnique({ where: { inquiryId }, include: { revisions: { where: { deletedAt: null }, include: revisionInclude } } });
      const refs = (q?.revisions ?? []).map((r) => ({ number: r.number, status: r.status }));
      const start = canStartRevision(refs);
      if (!start.ok) throw new GateError(start.reason, "revision_blocked");
      q ??= { ...(await tx.quotation.create({ data: { inquiryId, refNo: await nextReference(tx, "quotation", Number(this.clock.today().slice(0, 4))) } })), revisions: [] };
      // Numbers count every revision ever made (including deleted drafts), so R-numbers are never reused.
      const max = await tx.quotationRevision.aggregate({ where: { quotationId: q.id }, _max: { number: true } });
      const number = (max._max.number ?? 0) + 1;
      const latest = latestRevision(q.revisions);
      const { lines, header } = await this.rows(tx, user, inquiryId, input, latest ?? undefined);
      const rev = await tx.quotationRevision.create({ data: { ...header, quotationId: q.id, number, createdById: user.id, lines: { create: lines } } });
      await this.audit.record(tx, { userId: user.id, action: "create", entityType: "quotation", entityId: rev.id, summary: `${q.refNo} R${number} drafted for ${inquiry.refNo} — ${input.currency} ${header.total}` });
      return rev.id;
    });
    return this.revision(user, id);
  }

  private async loadRevision(user: SessionUser, revisionId: string, tx: Tx | PrismaService["db"] = this.prisma.db) {
    const r = await tx.quotationRevision.findFirst({ where: { id: revisionId, deletedAt: null }, include: { ...revisionInclude, quotation: true } });
    if (!r) throw new NotFoundError("Quotation");
    const inquiry = await this.inquiries.find(user, r.quotation.inquiryId, tx);
    return { r, inquiry };
  }

  async revision(user: SessionUser, revisionId: string) {
    const { r } = await this.loadRevision(user, revisionId);
    return { quotation: { id: r.quotation.id, refNo: r.quotation.refNo, inquiryId: r.quotation.inquiryId }, ...this.view(user, r) };
  }

  async updateRevision(user: SessionUser, revisionId: string, input: RevisionInput) {
    this.assertCan(user);
    await this.prisma.tx(async (tx) => {
      const { r, inquiry } = await this.loadRevision(user, revisionId, tx);
      await this.inquiries.findWorkable(user, inquiry.id, tx);
      if (!isEditable(r.status)) throw new DomainError("Only a draft can be edited. Start a new revision to change what the customer has seen.");
      const { lines, header } = await this.rows(tx, user, inquiry.id, input, r);
      await tx.quoteLine.deleteMany({ where: { revisionId } });
      await tx.quotationRevision.update({ where: { id: revisionId }, data: { ...header, lines: { create: lines } } });
      await this.audit.record(tx, {
        userId: user.id,
        action: "update",
        entityType: "quotation",
        entityId: revisionId,
        summary: `${r.quotation.refNo} R${r.number} edited`,
        oldValues: { total: r.total.toFixed(2), validUntil: fromDbDate(r.validUntil) },
        newValues: { total: header.total, validUntil: input.validUntil },
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
      await this.audit.record(tx, { userId: user.id, action: "delete", entityType: "quotation", entityId: revisionId, summary: `${r.quotation.refNo} R${r.number} draft deleted` });
    });
  }

  /* ---------------------------------------------------------------- sending and answers */

  /**
   * Draft → sent (frozen, with who it was for and from), older sent revisions
   * superseded, the deal moves to Quoted. Then: accepted (order created, deal
   * Won), rejected, or expired — only on the newest sent revision.
   */
  async move(user: SessionUser, revisionId: string, to: Exclude<RevisionStatus, "draft" | "superseded" | "void">, on: ISODate | null) {
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
      const all = await tx.quotationRevision.findMany({ where: { quotationId: r.quotationId, deletedAt: null }, select: { id: true, number: true, status: true } });
      const refs = all.map((x) => ({ number: x.number, status: x.status }));

      if (to === "sent") {
        if (r.number !== latestRevision(refs)!.number) throw new GateError("Only the newest revision can be sent.", "not_latest");
        if (!canQuote(inquiry.stage)) throw new DomainError("This deal is closed. Reopen it to quote again.");
        const settings = await this.settings.get();
        await tx.quotationRevision.update({
          where: { id: r.id },
          data: { status: "sent", sentOn: toDbDate(day), customerSnapshot: await customerSnapshot(tx, inquiry.customerId, inquiry.contactId), companySnapshot: companySnapshot(settings) },
        });
        const older = supersededBy(refs, r.number);
        if (older.length) await tx.quotationRevision.updateMany({ where: { quotationId: r.quotationId, number: { in: older } }, data: { status: "superseded" } });
        const moved = await this.stages.after(tx, inquiry, "quotation_sent", user.id);
        if (moved) events.push(moved);
      } else {
        if (!canAnswer(refs, r.number)) throw new GateError("Answers are recorded on the newest revision the customer has.", "not_latest");
        await tx.quotationRevision.update({ where: { id: r.id }, data: { status: to, answeredOn: toDbDate(day) } });
        if (to === "accepted") {
          const drafts = draftsDiscardedBy(refs, r.number);
          if (drafts.length) await tx.quotationRevision.updateMany({ where: { quotationId: r.quotationId, number: { in: drafts } }, data: { deletedAt: new Date() } });
          const { event } = await this.orders.createFromRevision(tx, r.id, day, user.id);
          events.push(event);
          const moved = await this.stages.after(tx, inquiry, "quotation_accepted", user.id);
          if (moved) events.push(moved);
        }
      }
      await this.audit.record(tx, { userId: user.id, action: "status_change", entityType: "quotation", entityId: r.id, summary: `${r.quotation.refNo} R${r.number}: ${r.status} → ${to}`, oldValues: { status: r.status }, newValues: { status: to } });
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
