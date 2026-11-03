import { Injectable } from "@nestjs/common";
import { fromDbDate, fromDbDateOrNull, toDbDate, toDbDateOrNull, type Prisma } from "@kebo/database";
import {
  bankStepsFor,
  BANK_STEP_LABEL,
  can,
  CLAIM_STATUS_LABEL,
  documentDone,
  DEFAULT_PRODUCTION_STEPS,
  DEFAULT_SAT_CHECKS,
  flowSteps,
  ORDER_DOCUMENT_LABEL,
  appMakesDocument,
  PAYMENT_ROUTE_SHORT,
  balanceWhenOf,
  lcChecksLine,
  documentsInUse,
  routeSummary,
  type BankContractInput,
  type BankStepInput,
  type BankStepKind,
  type ClaimStatus,
  type FlowFacts,
  type OrderStage,
  type PaymentRoute,
  type SatResult,
  type ShipMode,
  type ShipmentStatus,
  type ClaimInput,
  type ClaimUpdateInput,
  type DeliveryAllGoodInput,
  type DeliveryInput,
  type SatAllPassedInput,
  type FactoryOrderInput,
  type OrderDocumentInput,
  type OrderDocumentKind,
  type OrderDocumentStatus,
  type OrderDocumentUpdateInput,
  type PaymentRouteInput,
  type Permission,
  type PlanFeature,
  type ProductionInput,
  type SatInput,
  type ShipmentInput,
  type ShipmentUpdateInput,
} from "@kebo/shared";
import { addDays, dateIn, DomainError, ForbiddenError, NotFoundError } from "@kebo/utils";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { orderAccess, OrdersService } from "../orders/orders.service";
import type { DomainEvent } from "../../common/events/event-bus";
import { SettingsService } from "../settings/settings.service";
import { datePapers, lcChecksOf, rebuildRoutePlan, termsOf } from "../money/route-plan";
import { chargedExpenses, fxOf, positionOf, type PositionFacts, type MoneyCtx } from "../money/position";
import { seedFactoryPlans } from "../money/factory-plan";

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

type FlowAction =
  "route" | "bank_contract" | "factory_order" | "production" | "shipment" | "document" | "bank_step" | "delivery" | "sat" | "claim";

/** The production timeline is the checklist's own Production items. */
const productionWhere = { step: "production", key: null } as const;

/** What the step line is worked out from (see @kebo/shared flowSteps), for one order with its flow rows. */
interface FlowRows {
  stage: OrderStage;
  status: string;
  paymentRoute: PaymentRoute | null;
  factoryOrderedOn: Date | null;
  readyOn: Date | null;
  proformaNo: string | null;
  packedAt: Date | null;
  deliveredOn: Date | null;
  satDoneOn: Date | null;
  /** The production items of the checklist (done or skipped). */
  checklist: { doneAt: Date | null; skippedAt: Date | null }[];
  shipments: { mode: ShipMode; status: ShipmentStatus }[];
  documents: { kind: OrderDocumentKind; status: OrderDocumentStatus }[];
  bankSteps: { step: BankStepKind }[];
  satChecks: { result: SatResult }[];
  claims: { status: ClaimStatus }[];
}

/** Why a kind the app makes is not recorded by hand. */
function madeByTheApp(kind: OrderDocumentKind) {
  const label = ORDER_DOCUMENT_LABEL[kind];
  return `The ${label.charAt(0).toLowerCase()}${label.slice(1)} is made by the app, so it is not recorded by hand: ${
    kind === "proforma_invoice"
      ? "issue it on the order"
      : kind === "packing_list"
        ? "fill in the packing on Shipping; it is final once the order ships"
        : "make it final on its page"
  }. A signed or stamped copy goes to its paper or the order's files.`;
}

/** A paper of the shipment's set is in: recorded as done, or the order's own proforma / packing list made. */
function documentIn(o: Pick<FlowRows, "documents" | "proformaNo" | "packedAt">, kind: OrderDocumentKind) {
  const rows = o.documents.filter((d) => d.kind === kind);
  if (rows.length) return rows.some((d) => documentDone(d.status));
  return kind === "proforma_invoice" ? !!o.proformaNo : kind === "packing_list" ? !!o.packedAt : false;
}

/** `papersOff`: Settings › Papers we use (switched-off papers are not counted unless already in). */
export function factsOf(o: FlowRows, depositIn: boolean, papersOff: readonly string[] = []): FlowFacts {
  const route = o.paymentRoute;
  const required = documentsInUse(route, o.shipments[0]?.mode ?? "sea", papersOff, (k) => documentIn(o, k));
  const ready = required.filter((kind) => documentIn(o, kind)).length;
  const bankKinds = bankStepsFor(route);
  return {
    stage: o.stage,
    cancelled: o.status === "cancelled",
    route,
    depositIn,
    factoryOrderedOn: fromDbDateOrNull(o.factoryOrderedOn),
    production: { total: o.checklist.length, done: o.checklist.filter((p) => p.doneAt || p.skippedAt).length },
    readyOn: fromDbDateOrNull(o.readyOn),
    shipments: {
      total: o.shipments.length,
      departed: o.shipments.filter((s) => ["departed", "arrived", "cleared"].includes(s.status)).length,
      arrived: o.shipments.filter((s) => s.status === "arrived" || s.status === "cleared").length,
    },
    documents: { required: required.length, ready },
    bankSteps: { required: bankKinds.length, done: o.bankSteps.filter((b) => bankKinds.includes(b.step)).length },
    deliveredOn: fromDbDateOrNull(o.deliveredOn),
    sat: {
      total: o.satChecks.length,
      passed: o.satChecks.filter((c) => c.result === "pass").length,
      failed: o.satChecks.filter((c) => c.result === "fail").length,
      doneOn: fromDbDateOrNull(o.satDoneOn),
    },
    openClaims: o.claims.filter((c) => c.status === "open" || c.status === "with_factory").length,
  };
}

/** The deposit (the plan's deposit row, else the accepted %; with no deposit: everything) has come in, as orderPosition says. */
function depositInOf(o: PositionFacts, fx: MoneyCtx) {
  return positionOf(o, fx).depositReceived;
}

interface DocumentView {
  /** Null: not recorded yet (a paper the shipment needs, or one the system prints). */
  id: string | null;
  kind: OrderDocumentKind;
  label: string;
  required: boolean;
  status: OrderDocumentStatus;
  number: string | null;
  issuedOn: string | null;
  shipmentId: string | null;
  note: string | null;
  /** Kept elsewhere: where it is. */
  keptWhere: string | null;
  /** Made by the app: the final paper. */
  paperId: string | null;
  file: { id: string; name: string; size: number } | null;
  printable: "proforma" | "packing-list" | null;
}

/** Papers the system makes itself from the order (printed from the order page). */
const SYSTEM_DOCUMENTS: Partial<Record<OrderDocumentKind, "proforma" | "packing-list">> = {
  proforma_invoice: "proforma",
  packing_list: "packing-list",
};

/**
 * The order flow after the customer accepts: how the customer pays, the factory
 * order, production, shipments, the document set and its trip through the banks,
 * delivery, the site acceptance test and claims.
 *
 * Who may do what is checked twice: the route's @RequirePermissions/@RequireFeature,
 * and here (the same rules for any caller). Rows are company rows under row-level
 * security; every change is written to the order's history.
 */
@Injectable()
export class FlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly orders: OrdersService,
    private readonly settings: SettingsService,
  ) {}

  /* ---------------------------------------------------------------- guards */

  private async must(user: SessionUser, permission: Permission, feature: PlanFeature | null, what: string) {
    if (feature) await this.limits.require(feature);
    if (!can(user, permission)) throw new ForbiddenError(`You cannot ${what}.`);
  }

  /** The order, locked for the change, if the person may see it and it is not cancelled. */
  private async lockOrder(tx: Tx, user: SessionUser, id: string) {
    await tx.$queryRaw`select id from orders where id = ${id}::uuid for update`;
    const o = await tx.order.findFirst({ where: { id, ...orderAccess(user) } });
    if (!o) throw new NotFoundError("Order");
    if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
    return o;
  }

  /** Each change has its own action (flow.route, flow.shipment…), so the order's history can show it under its step. */
  private async log(
    tx: Tx,
    user: SessionUser,
    orderId: string,
    action: FlowAction,
    summary: string,
    oldValues?: object,
    newValues?: object,
  ) {
    await this.audit.record(tx, {
      userId: user.id,
      action: `flow.${action}`,
      entityType: "order",
      entityId: orderId,
      summary,
      oldValues: oldValues as Record<string, unknown> | undefined,
      newValues: newValues as Record<string, unknown> | undefined,
    });
  }

  /* ---------------------------------------------------------------- reading */

  /** Everything after the quotation for one order, only the modules the company has. */
  async get(user: SessionUser, id: string) {
    const o = await this.prisma.db.order.findFirst({
      where: { id, ...orderAccess(user) },
      include: {
        payments: { where: { voidedAt: null } },
        bankContract: true,
        planItems: { orderBy: { sortOrder: "asc" }, select: { amount: true, dueRule: true, part: true } },
        expenses: chargedExpenses,
        checklist: {
          where: productionWhere,
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: { factory: { select: { id: true, name: true } } },
        },
        shipments: { orderBy: { createdAt: "asc" } },
        documents: {
          orderBy: [{ kind: "asc" }, { updatedAt: "asc" }],
          include: { attachment: { select: { id: true, fileName: true, size: true, deletedAt: true } } },
        },
        bankSteps: true,
        satChecks: { orderBy: { sortOrder: "asc" } },
        claims: { orderBy: { openedOn: "desc" } },
        satEngineer: { select: { id: true, name: true } },
        lines: { where: { factoryId: { not: null } }, select: { factory: { select: { id: true, name: true } } } },
      },
    });
    if (!o) throw new NotFoundError("Order");
    const features = await this.limits.features();
    const has = (f: PlanFeature) => !features || features.includes(f);

    const settings = await this.settings.get();
    const depositIn = depositInOf(o, fxOf(settings, await this.limits.allows("expenses")));

    const route = o.paymentRoute;
    const mode = o.shipments[0]?.mode ?? "sea";
    const required = documentsInUse(route, mode, settings.papers.off, (k) => documentIn(o, k));
    const documents = this.documentSet(o, required);
    const bankKinds = bankStepsFor(route);
    const bankSteps = bankKinds.map((step) => {
      const s = o.bankSteps.find((b) => b.step === step);
      return {
        step,
        label: BANK_STEP_LABEL[step],
        doneOn: fromDbDateOrNull(s?.doneOn),
        courier: s?.courier ?? null,
        reference: s?.reference ?? null,
        note: s?.note ?? null,
        /** "Money reached us": the payment that recorded it (the step is ticked by recording it). */
        paymentId: s?.paymentId ?? null,
      };
    });

    const shipments = o.shipments.map((s) => ({
      id: s.id,
      mode: s.mode,
      status: s.status,
      forwarder: s.forwarder,
      bookingNo: s.bookingNo,
      blNo: s.blNo,
      vessel: s.vessel,
      portOfLoading: s.portOfLoading,
      portOfDischarge: s.portOfDischarge,
      containerNo: s.containerNo,
      containerType: s.containerType,
      sealNo: s.sealNo,
      loadedOn: fromDbDateOrNull(s.loadedOn),
      vgmKg: s.vgmKg === null ? null : s.vgmKg.toString(),
      etd: fromDbDateOrNull(s.etd),
      eta: fromDbDateOrNull(s.eta),
      departedOn: fromDbDateOrNull(s.departedOn),
      arrivedOn: fromDbDateOrNull(s.arrivedOn),
      note: s.note,
    }));
    const sat = o.satChecks.map((c) => ({ id: c.id, item: c.item, result: c.result, note: c.note }));
    const claims = o.claims.map((c) => ({
      id: c.id,
      title: c.title,
      detail: c.detail,
      status: c.status,
      statusLabel: CLAIM_STATUS_LABEL[c.status],
      openedOn: fromDbDate(c.openedOn),
      resolvedOn: fromDbDateOrNull(c.resolvedOn),
      resolution: c.resolution,
    }));
    const steps = flowSteps(factsOf(o, depositIn, settings.papers.off), features);

    const factories = [...new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : []))).values()];
    const b = o.bankContract;
    const terms = termsOf(o);
    const checks = has("bank_contracts") ? lcChecksOf(o, settings.reminders.lcCourierDays) : null;
    return {
      orderId: o.id,
      refNo: o.refNo,
      steps,
      modules: {
        bankContracts: has("bank_contracts"),
        production: has("production"),
        shipping: has("shipping"),
        bankDocuments: has("bank_documents"),
        deliverySat: has("delivery_sat"),
      },
      payment: {
        route,
        routeLabel: route ? PAYMENT_ROUTE_SHORT[route] : null,
        /** The route's terms: informal balance before shipment or against the B/L copy; LC at sight or deferred N days. */
        balanceWhen: terms.balanceWhen,
        lcTerms: terms.lcTerms,
        lcDays: terms.lcDays,
        /** "LC, deferred 90 days". */
        summary: routeSummary(terms),
        /** The LC against the order (LC orders only): { key, label, ok (null: not known yet), detail }. */
        lcChecks: checks,
        lcChecksLine: checks ? lcChecksLine(checks) : null,
        depositIn,
        bankContract:
          has("bank_contracts") && b
            ? {
                number: b.number,
                status: b.status,
                customerBank: b.customerBank,
                ourBank: b.ourBank,
                amount: num(b.amount),
                currency: b.currency,
                openedOn: fromDbDateOrNull(b.openedOn),
                latestShipOn: fromDbDateOrNull(b.latestShipOn),
                expiresOn: fromDbDateOrNull(b.expiresOn),
                note: b.note,
              }
            : null,
      },
      factory: {
        orderedOn: fromDbDateOrNull(o.factoryOrderedOn),
        orderNo: o.factoryOrderNo,
        readyOn: fromDbDateOrNull(o.readyOn),
        factories,
      },
      production: has("production")
        ? {
            steps: o.checklist.map((p) => ({
              id: p.id,
              title: p.title ?? "",
              factory: p.factory,
              plannedOn: fromDbDateOrNull(p.dueOn),
              doneOn: p.doneAt ? dateIn(p.doneAt, this.clock.timeZone) : null,
              note: p.note,
              late: !p.doneAt && !p.skippedAt && !!p.dueOn && fromDbDate(p.dueOn) < this.clock.today(),
            })),
            suggested: o.checklist.length ? [] : [...DEFAULT_PRODUCTION_STEPS],
          }
        : null,
      shipping: has("shipping") ? { shipments } : null,
      documents: has("bank_documents") ? { set: documents, bankSteps } : null,
      delivery: has("delivery_sat")
        ? {
            deliveredOn: fromDbDateOrNull(o.deliveredOn),
            condition: o.deliveryCondition,
            note: o.deliveryNote,
            receivedBy: o.deliveryReceivedBy,
            satEngineer: o.satEngineer,
            satPlannedOn: fromDbDateOrNull(o.satPlannedOn),
            satDoneOn: fromDbDateOrNull(o.satDoneOn),
            satSignedBy: o.satSignedBy,
            sat,
            suggestedSat: sat.length ? [] : [...DEFAULT_SAT_CHECKS],
            claims,
          }
        : null,
    };
  }

  /** The papers the shipment needs plus any others recorded, with where each stands. */
  private documentSet(
    o: {
      proformaNo: string | null;
      packedAt: Date | null;
      documents: {
        id: string;
        kind: OrderDocumentKind;
        title: string | null;
        number: string | null;
        issuedOn: Date | null;
        status: OrderDocumentStatus;
        shipmentId: string | null;
        note: string | null;
        keptWhere: string | null;
        paperId: string | null;
        attachment: { id: string; fileName: string; size: number; deletedAt: Date | null } | null;
      }[];
    },
    required: OrderDocumentKind[],
  ): DocumentView[] {
    const row = (d: (typeof o.documents)[number]): DocumentView => ({
      id: d.id,
      kind: d.kind,
      label: d.kind === "other" && d.title ? d.title : ORDER_DOCUMENT_LABEL[d.kind],
      required: required.includes(d.kind),
      status: d.status,
      number: d.number,
      issuedOn: fromDbDateOrNull(d.issuedOn),
      shipmentId: d.shipmentId,
      note: d.note,
      keptWhere: d.keptWhere,
      paperId: d.paperId,
      file: d.attachment && !d.attachment.deletedAt ? { id: d.attachment.id, name: d.attachment.fileName, size: d.attachment.size } : null,
      printable: SYSTEM_DOCUMENTS[d.kind] ?? null,
    });
    const out = required.flatMap((kind): DocumentView[] => {
      const rows = o.documents.filter((d) => d.kind === kind);
      if (rows.length) return rows.map(row);
      // Not recorded: the system's own papers stand as the order does.
      const system = SYSTEM_DOCUMENTS[kind];
      const status: OrderDocumentStatus =
        kind === "proforma_invoice"
          ? o.proformaNo
            ? "ready"
            : "missing"
          : kind === "packing_list"
            ? o.packedAt
              ? "ready"
              : "missing"
            : "missing";
      return [
        {
          id: null,
          kind,
          label: ORDER_DOCUMENT_LABEL[kind],
          required: true,
          status,
          number: kind === "proforma_invoice" ? o.proformaNo : null,
          issuedOn: null,
          shipmentId: null,
          note: null,
          keptWhere: null,
          paperId: null,
          file: null,
          printable: system ?? null,
        },
      ];
    });
    return [...out, ...o.documents.filter((d) => !required.includes(d.kind)).map(row)];
  }

  /**
   * The open orders' current step, for the orders board (columns by step): one
   * light query for up to 300 orders. Steps of switched-off modules are skipped.
   */
  async board(user: SessionUser, mine: boolean) {
    const rows = await this.prisma.db.order.findMany({
      where: { ...orderAccess(user), status: "open", ...(mine ? { inquiry: { assigneeId: user.id } } : {}) },
      select: {
        id: true,
        stage: true,
        status: true,
        paymentRoute: true,
        factoryOrderedOn: true,
        readyOn: true,
        proformaNo: true,
        packedAt: true,
        deliveredOn: true,
        satDoneOn: true,
        total: true,
        currency: true,
        depositPercent: true,
        mainCurrency: true,
        mainRate: true,
        payments: { where: { voidedAt: null }, select: { currency: true, amount: true, bankCharges: true } },
        planItems: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
        expenses: chargedExpenses,
        checklist: { where: productionWhere, select: { doneAt: true, skippedAt: true } },
        shipments: { orderBy: { createdAt: "asc" }, select: { mode: true, status: true } },
        documents: { select: { kind: true, status: true } },
        bankSteps: { select: { step: true } },
        satChecks: { select: { result: true } },
        claims: { select: { status: true } },
      },
      orderBy: { stageSince: "asc" },
      take: 300,
    });
    const [features, settings, expensesOn] = await Promise.all([this.limits.features(), this.settings.get(), this.limits.allows("expenses")]);
    const fx = fxOf(settings, expensesOn);
    return {
      items: rows.map((o) => {
        const steps = flowSteps(factsOf(o, depositInOf(o, fx), settings.papers.off), features);
        const current = steps.find((s) => s.state === "current") ?? null;
        return { id: o.id, current: current && { key: current.key, label: current.label, sub: current.sub } };
      }),
    };
  }

  /* ---------------------------------------------------------------- payment route, bank contract, factory order */

  /**
   * The route and its terms build the plan: changing them rebuilds the
   * instalments not paid yet (payments stay). The papers word their payment
   * terms from the route; the order's balance terms stay as accepted.
   */
  async setRoute(user: SessionUser, id: string, input: PaymentRouteInput) {
    await this.must(user, "orders.update", null, "change orders");
    if (input.route && input.route !== "informal") await this.limits.require("bank_contracts");
    const { reminders } = await this.settings.get();
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      const was = termsOf(o);
      const lc = input.route === "letter_of_credit";
      const t = {
        route: input.route,
        balanceWhen: input.balanceWhen ?? was.balanceWhen ?? (input.route === "informal" ? (balanceWhenOf(o.balanceTerms) ?? "before_shipment") : null),
        lcTerms: lc ? (input.lcTerms ?? was.lcTerms ?? "at_sight") : (input.lcTerms ?? was.lcTerms),
        lcDays: input.lcDays ?? was.lcDays,
      };
      if (lc && t.lcTerms === "deferred" && !t.lcDays) throw new DomainError("Say after how many days the deferred LC pays (counted from the day the papers reach their bank).");
      if (was.route === t.route && was.balanceWhen === t.balanceWhen && was.lcTerms === t.lcTerms && was.lcDays === t.lcDays) return;
      await tx.order.update({
        where: { id },
        // The balance terms stay as accepted: the papers word the terms from the route itself.
        data: { paymentRoute: t.route, balanceWhen: t.balanceWhen, lcTerms: t.lcTerms, lcDays: t.lcDays },
      });
      const plan = await rebuildRoutePlan(tx, o, t, reminders);
      await this.log(
        tx,
        user,
        id,
        "route",
        `${o.refNo}: payment route ${t.route ? (routeSummary(t) ?? PAYMENT_ROUTE_SHORT[t.route]) : "cleared"}${plan.was !== plan.now ? " · plan rebuilt" : ""}`,
        { route: o.paymentRoute, terms: routeSummary(was), plan: plan.was },
        { route: t.route, terms: routeSummary(t), plan: plan.now },
      );
    });
    return this.get(user, id);
  }

  async saveBankContract(user: SessionUser, id: string, input: BankContractInput) {
    await this.must(user, "orders.update", "bank_contracts", "change orders");
    if (input.amount !== null && !input.currency) throw new DomainError("Choose the currency of the amount.");
    if (input.openedOn && input.expiresOn && input.expiresOn < input.openedOn)
      throw new DomainError("The contract cannot expire before it opens.");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      if (o.paymentRoute !== "bank_contract" && o.paymentRoute !== "letter_of_credit")
        throw new DomainError("Set the payment route to a bank contract or LC first.");
      const data = {
        number: input.number,
        status: input.status,
        customerBank: input.customerBank,
        ourBank: input.ourBank,
        amount: input.amount,
        currency: input.currency,
        openedOn: toDbDateOrNull(input.openedOn),
        latestShipOn: toDbDateOrNull(input.latestShipOn),
        expiresOn: toDbDateOrNull(input.expiresOn),
        note: input.note,
      };
      const before = await tx.orderBankContract.findUnique({ where: { orderId: id } });
      await tx.orderBankContract.upsert({ where: { orderId: id }, create: { orderId: id, ...data }, update: data });
      await this.log(
        tx,
        user,
        id,
        "bank_contract",
        `${o.refNo}: ${o.paymentRoute === "letter_of_credit" ? "LC" : "bank contract"} ${before ? "changed" : "added"}`,
        before ?? undefined,
        input,
      );
    });
    return this.get(user, id);
  }

  /** The day we ordered from the factory and their order number; only the fields sent change. */
  async setFactoryOrder(user: SessionUser, id: string, input: FactoryOrderInput) {
    await this.must(user, "orders.update", null, "change orders");
    if (input.factoryOrderedOn && input.factoryOrderedOn > this.clock.today())
      throw new DomainError("The factory order date cannot be in the future.");
    const event = await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      const was = { factoryOrderedOn: fromDbDateOrNull(o.factoryOrderedOn), factoryOrderNo: o.factoryOrderNo };
      const data: Prisma.OrderUncheckedUpdateInput = {};
      if (input.factoryOrderedOn !== undefined) data.factoryOrderedOn = toDbDateOrNull(input.factoryOrderedOn);
      if (input.factoryOrderNo !== undefined) data.factoryOrderNo = input.factoryOrderNo;
      if (!Object.keys(data).length) return null;
      await tx.order.update({ where: { id }, data });
      const ordered = input.factoryOrderedOn !== undefined ? input.factoryOrderedOn : was.factoryOrderedOn;
      // Ordered: each factory gets the payment plan (advance when we order, balance on the ready date).
      if (input.factoryOrderedOn) await seedFactoryPlans(tx, id, (await this.settings.get()).sales.factoryAdvancePercent);
      const parts = [
        input.factoryOrderedOn !== undefined
          ? input.factoryOrderedOn
            ? `ordered from the factory on ${input.factoryOrderedOn}`
            : "factory order date cleared"
          : null,
        input.factoryOrderNo !== undefined && input.factoryOrderNo !== was.factoryOrderNo
          ? input.factoryOrderNo
            ? `their order no. ${input.factoryOrderNo}`
            : "their order no. cleared"
          : null,
      ].filter(Boolean);
      await this.log(tx, user, id, "factory_order", `${o.refNo}: ${parts.join(", ") || "factory order saved"}`, was, input);
      // Ordered from the factory: the order is in production.
      return input.factoryOrderedOn && ordered ? this.orders.followFlow(tx, user, id, "in_production", "ordered from the factory") : null;
    });
    await this.orders.announce(event);
    return this.get(user, id);
  }

  /* ---------------------------------------------------------------- production */

  /**
   * The production timeline as a whole (kept for the phone app): it is the
   * checklist's own Production items, so rows sent with their id are changed,
   * others added (Mark done), missing ones removed.
   */
  async saveProduction(user: SessionUser, id: string, input: ProductionInput) {
    await this.must(user, "orders.update", "production", "change orders");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      const existing = await tx.orderChecklistItem.findMany({ where: { orderId: id, ...productionWhere } });
      const doneAt = (on: string | null, was: { doneAt: Date | null } | undefined) =>
        on ? (was?.doneAt && dateIn(was.doneAt, this.clock.timeZone) === on ? was.doneAt : toDbDate(on)) : null;
      await this.replaceList(
        tx,
        existing.map((e) => e.id),
        input.steps,
        (s, i) => {
          const was = existing.find((e) => e.id === s.id);
          const at = doneAt(s.doneOn, was);
          return {
            title: s.title,
            factoryId: s.factoryId,
            dueOn: toDbDateOrNull(s.plannedOn),
            doneAt: at,
            doneById: at ? (was?.doneAt ? was.doneById : user.id) : null,
            note: s.note,
            sortOrder: (i + 1) * 10,
          };
        },
        {
          remove: (ids) => tx.orderChecklistItem.deleteMany({ where: { id: { in: ids }, orderId: id } }),
          update: (rowId, data) => tx.orderChecklistItem.update({ where: { id: rowId }, data }),
          create: (data) =>
            tx.orderChecklistItem.create({ data: { ...data, orderId: id, step: "production", tool: "done", createdById: user.id } }),
        },
        "production step",
      );
      // The timeline was made here: the company's list is not copied in on top of it.
      if (!o.checklistSeededAt) await tx.order.update({ where: { id }, data: { checklistSeededAt: new Date() } });
      const done = input.steps.filter((s) => s.doneOn).length;
      await this.log(
        tx,
        user,
        id,
        "production",
        `${o.refNo}: production timeline saved (${done} of ${input.steps.length} done)`,
        undefined,
        { ...input, step: "production" },
      );
    });
    return this.get(user, id);
  }

  /** Keeps rows sent with their id (changed), adds the rest, removes the ones not sent. */
  private async replaceList<I extends { id: string | null }, D>(
    _tx: Tx,
    existingIds: string[],
    items: I[],
    data: (item: I, index: number) => D,
    ops: {
      remove: (ids: string[]) => Promise<unknown>;
      update: (id: string, d: D) => Promise<unknown>;
      create: (d: D) => Promise<unknown>;
    },
    what: string,
  ) {
    for (const item of items)
      if (item.id && !existingIds.includes(item.id))
        throw new DomainError(`That ${what} is not on this order any more. Reload and try again.`);
    const keep = new Set(items.map((i) => i.id).filter(Boolean) as string[]);
    const gone = existingIds.filter((x) => !keep.has(x));
    if (gone.length) await ops.remove(gone);
    for (const [i, item] of items.entries()) {
      if (item.id) await ops.update(item.id, data(item, i));
      else await ops.create(data(item, i));
    }
  }

  /* ---------------------------------------------------------------- shipping */

  async addShipment(user: SessionUser, id: string, input: ShipmentInput) {
    await this.must(user, "shipping.manage", "shipping", "manage shipping");
    const event = await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      const s = await tx.shipment.create({ data: { orderId: id, ...this.shipmentData(input) } });
      await this.log(
        tx,
        user,
        id,
        "shipment",
        `${o.refNo}: shipment added (${input.mode}${input.blNo ? `, B/L ${input.blNo}` : ""})`,
        undefined,
        { shipmentId: s.id, ...input },
      );
      return this.shipped(tx, user, id, input.status, input.departedOn, input.blNo);
    });
    await this.orders.announce(event);
    return this.get(user, id);
  }

  async updateShipment(user: SessionUser, shipmentId: string, input: ShipmentUpdateInput) {
    await this.must(user, "shipping.manage", "shipping", "manage shipping");
    const orderId = await this.orderOf("shipment", shipmentId);
    const event = await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, orderId);
      const before = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
      const next = { etd: fromDbDateOrNull(before.etd), eta: fromDbDateOrNull(before.eta), ...input };
      if (next.etd && next.eta && next.eta < next.etd)
        throw new DomainError("The arrival date (ETA) cannot be before the departure date (ETD).");
      await tx.shipment.update({ where: { id: shipmentId }, data: this.shipmentData(input) });
      await this.log(
        tx,
        user,
        orderId,
        "shipment",
        `${o.refNo}: shipment changed${input.status ? ` (${input.status})` : ""}`,
        { status: before.status, blNo: before.blNo },
        input,
      );
      return this.shipped(
        tx,
        user,
        orderId,
        input.status ?? before.status,
        input.departedOn !== undefined ? input.departedOn : fromDbDateOrNull(before.departedOn),
        input.blNo !== undefined ? input.blNo : before.blNo,
      );
    });
    await this.orders.announce(event);
    return this.get(user, orderId);
  }

  async removeShipment(user: SessionUser, shipmentId: string) {
    await this.must(user, "shipping.manage", "shipping", "manage shipping");
    const orderId = await this.orderOf("shipment", shipmentId);
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, orderId);
      const before = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
      await tx.shipment.delete({ where: { id: shipmentId } });
      await this.log(
        tx,
        user,
        orderId,
        "shipment",
        `${o.refNo}: shipment removed${before.blNo ? ` (B/L ${before.blNo})` : ""}`,
        before,
        undefined,
      );
    });
    return this.get(user, orderId);
  }

  /** A shipment that has left moves the order to Shipped (its date and B/L with it). */
  private shipped(
    tx: Tx,
    user: SessionUser,
    orderId: string,
    status: ShipmentStatus,
    departedOn: string | null | undefined,
    blNo: string | null | undefined,
  ): Promise<DomainEvent | null> {
    if (status !== "departed" && status !== "arrived" && status !== "cleared") return Promise.resolve(null);
    return this.orders.followFlow(tx, user, orderId, "shipped", "a shipment left", { shippedOn: departedOn ?? null, blNo: blNo ?? null });
  }

  private shipmentData(input: Partial<ShipmentInput>) {
    const d: Prisma.ShipmentUncheckedUpdateInput = {};
    for (const k of [
      "mode",
      "status",
      "forwarder",
      "bookingNo",
      "blNo",
      "vessel",
      "portOfLoading",
      "portOfDischarge",
      "containerNo",
      "containerType",
      "sealNo",
      "vgmKg",
      "note",
    ] as const) {
      if (input[k] !== undefined) (d as Record<string, unknown>)[k] = input[k];
    }
    for (const k of ["loadedOn", "etd", "eta", "departedOn", "arrivedOn"] as const) if (input[k] !== undefined) d[k] = toDbDateOrNull(input[k]);
    return d as Prisma.ShipmentUncheckedCreateWithoutOrderInput;
  }

  /** The order a flow row belongs to (row-level security keeps it to this company); access is checked on the order. */
  private async orderOf(table: "shipment" | "orderDocument" | "orderClaim", rowId: string) {
    const r =
      table === "shipment"
        ? await this.prisma.db.shipment.findUnique({ where: { id: rowId }, select: { orderId: true } })
        : table === "orderDocument"
          ? await this.prisma.db.orderDocument.findUnique({ where: { id: rowId }, select: { orderId: true } })
          : await this.prisma.db.orderClaim.findUnique({ where: { id: rowId }, select: { orderId: true } });
    if (!r) throw new NotFoundError(table === "shipment" ? "Shipment" : table === "orderDocument" ? "Document" : "Claim");
    return r.orderId;
  }

  /* ---------------------------------------------------------------- documents and the bank chain */

  private async checkDocumentLinks(
    tx: Tx,
    order: { id: string; inquiryId: string },
    shipmentId: string | null | undefined,
    attachmentId: string | null | undefined,
  ) {
    if (shipmentId && !(await tx.shipment.findFirst({ where: { id: shipmentId, orderId: order.id } })))
      throw new DomainError("That shipment is not on this order.");
    if (attachmentId) {
      const a = await tx.attachment.findFirst({ where: { id: attachmentId, inquiryId: order.inquiryId, deletedAt: null } });
      if (!a) throw new DomainError("That file is not on this deal. Upload it to the deal's files first.");
      if (a.factoryQuoteId) throw new DomainError("That file is a factory offer's evidence; upload the document itself.");
    }
  }

  async addDocument(user: SessionUser, id: string, input: OrderDocumentInput) {
    await this.must(user, "documents.manage", "bank_documents", "manage the documents");
    if (appMakesDocument(input.kind)) throw new DomainError(madeByTheApp(input.kind));
    if (input.kind === "other" && !input.title) throw new DomainError("Say what the document is.");
    if (input.status === "elsewhere" && !input.keptWhere) throw new DomainError("Say where it is kept, so anyone can find it.");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      await this.checkDocumentLinks(tx, o, input.shipmentId, input.attachmentId);
      await tx.orderDocument.create({
        data: {
          orderId: id,
          kind: input.kind,
          title: input.title,
          number: input.number,
          issuedOn: toDbDateOrNull(input.issuedOn),
          status: input.status,
          shipmentId: input.shipmentId,
          attachmentId: input.attachmentId,
          note: input.note,
          keptWhere: input.status === "elsewhere" ? input.keptWhere : null,
        },
      });
      await this.log(
        tx,
        user,
        id,
        "document",
        `${o.refNo}: ${ORDER_DOCUMENT_LABEL[input.kind]} recorded (${input.status})`,
        undefined,
        input,
      );
    });
    return this.get(user, id);
  }

  async updateDocument(user: SessionUser, docId: string, input: OrderDocumentUpdateInput) {
    await this.must(user, "documents.manage", "bank_documents", "manage the documents");
    const orderId = await this.orderOf("orderDocument", docId);
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, orderId);
      await this.checkDocumentLinks(tx, o, input.shipmentId, input.attachmentId);
      const before = await tx.orderDocument.findUniqueOrThrow({ where: { id: docId } });
      // The app's own papers: their number and state are the paper's; only a file (a signed copy) or a note is added.
      if (
        appMakesDocument(before.kind) &&
        ((input.number !== undefined && input.number !== before.number) ||
          (input.status !== undefined && input.status !== before.status) ||
          (input.title !== undefined && input.title !== before.title) ||
          (input.issuedOn !== undefined && input.issuedOn !== fromDbDateOrNull(before.issuedOn)) ||
          (input.keptWhere !== undefined && input.keptWhere !== before.keptWhere))
      )
        throw new DomainError(madeByTheApp(before.kind));
      const status = input.status ?? before.status;
      if (status === "elsewhere" && !(input.keptWhere !== undefined ? input.keptWhere : before.keptWhere))
        throw new DomainError("Say where it is kept, so anyone can find it.");
      const data: Prisma.OrderDocumentUncheckedUpdateInput = {};
      for (const k of ["title", "number", "status", "shipmentId", "attachmentId", "note", "keptWhere"] as const)
        if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
      if (input.issuedOn !== undefined) data.issuedOn = toDbDateOrNull(input.issuedOn);
      await tx.orderDocument.update({ where: { id: docId }, data });
      await this.log(
        tx,
        user,
        orderId,
        "document",
        `${o.refNo}: ${ORDER_DOCUMENT_LABEL[before.kind]} changed${input.status ? ` (${input.status})` : ""}`,
        { status: before.status, number: before.number },
        input,
      );
    });
    return this.get(user, orderId);
  }

  async removeDocument(user: SessionUser, docId: string) {
    await this.must(user, "documents.manage", "bank_documents", "manage the documents");
    const orderId = await this.orderOf("orderDocument", docId);
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, orderId);
      const before = await tx.orderDocument.findUniqueOrThrow({ where: { id: docId } });
      await tx.orderDocument.delete({ where: { id: docId } });
      await this.log(tx, user, orderId, "document", `${o.refNo}: ${ORDER_DOCUMENT_LABEL[before.kind]} removed`, before, undefined);
    });
    return this.get(user, orderId);
  }

  async setBankStep(user: SessionUser, id: string, step: BankStepKind, input: BankStepInput) {
    await this.must(user, "documents.manage", "bank_documents", "manage the documents");
    if (input.doneOn > this.clock.today()) throw new DomainError("The date cannot be in the future.");
    // The last step is the payment itself: one entry, not two.
    if (step === "bank_paid_us") throw new DomainError("Record the payment for “Money reached us”: recording it ticks the step.");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      if (!bankStepsFor(o.paymentRoute).includes(step)) throw new DomainError("That step is not part of this order's payment route.");
      const data = { doneOn: toDbDate(input.doneOn), courier: input.courier, reference: input.reference, note: input.note };
      if (step === "customer_bank_received") await datePapers(tx, id, input.doneOn);
      await tx.orderBankStep.upsert({
        where: { orderId_step: { orderId: id, step } },
        create: { orderId: id, step, ...data },
        update: data,
      });
      await this.log(
        tx,
        user,
        id,
        "bank_step",
        `${o.refNo}: ${BANK_STEP_LABEL[step]} (${input.doneOn}${input.reference ? `, ${input.reference}` : ""})`,
        undefined,
        { step, ...input },
      );
    });
    return this.get(user, id);
  }

  async clearBankStep(user: SessionUser, id: string, step: BankStepKind) {
    await this.must(user, "documents.manage", "bank_documents", "manage the documents");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      const row = await tx.orderBankStep.findFirst({ where: { orderId: id, step } });
      if (row?.paymentId) throw new DomainError("This step was ticked by a payment. Remove the payment to undo it.");
      if (step === "customer_bank_received") await datePapers(tx, id, null);
      const n = await tx.orderBankStep.deleteMany({ where: { orderId: id, step } });
      if (n.count) await this.log(tx, user, id, "bank_step", `${o.refNo}: ${BANK_STEP_LABEL[step]} undone`, { step }, undefined);
    });
    return this.get(user, id);
  }

  /* ---------------------------------------------------------------- delivery, SAT, claims */

  async saveDelivery(user: SessionUser, id: string, input: DeliveryInput) {
    await this.must(user, "delivery.manage", "delivery_sat", "manage delivery and SAT");
    const today = this.clock.today();
    if ((input.deliveredOn && input.deliveredOn > today) || (input.satDoneOn && input.satDoneOn > today))
      throw new DomainError("A date that has happened cannot be in the future.");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      if (input.satEngineerId && !(await tx.user.findFirst({ where: { id: input.satEngineerId, isActive: true } })))
        throw new DomainError("Choose an active person as the engineer.");
      const delivered = input.deliveredOn !== undefined ? input.deliveredOn : fromDbDateOrNull(o.deliveredOn);
      const satDone = input.satDoneOn !== undefined ? input.satDoneOn : fromDbDateOrNull(o.satDoneOn);
      if (satDone && !delivered) throw new DomainError("Record the delivery before signing off the SAT.");
      if (satDone && delivered && satDone < delivered) throw new DomainError("The SAT cannot be signed off before the delivery.");
      if (satDone && input.satDoneOn) {
        const failed = await tx.satCheck.count({ where: { orderId: id, result: { in: ["fail", "pending"] } } });
        if (failed) throw new DomainError("Every SAT point must pass (or be N/A) before signing off.");
      }
      const data: Prisma.OrderUncheckedUpdateInput = {};
      if (input.deliveredOn !== undefined) data.deliveredOn = toDbDateOrNull(input.deliveredOn);
      if (input.deliveryCondition !== undefined) data.deliveryCondition = input.deliveryCondition;
      if (input.deliveryNote !== undefined) data.deliveryNote = input.deliveryNote;
      if (input.deliveryReceivedBy !== undefined) data.deliveryReceivedBy = input.deliveryReceivedBy;
      if (input.satEngineerId !== undefined) data.satEngineerId = input.satEngineerId;
      if (input.satPlannedOn !== undefined) data.satPlannedOn = toDbDateOrNull(input.satPlannedOn);
      if (input.satDoneOn !== undefined) data.satDoneOn = toDbDateOrNull(input.satDoneOn);
      if (input.satSignedBy !== undefined) data.satSignedBy = input.satSignedBy;
      await tx.order.update({ where: { id }, data });
      const what = input.satDoneOn
        ? "SAT signed off"
        : input.deliveredOn
          ? `delivered on ${input.deliveredOn}`
          : "delivery and SAT details changed";
      await this.log(
        tx,
        user,
        id,
        "delivery",
        `${o.refNo}: ${what}`,
        { deliveredOn: fromDbDateOrNull(o.deliveredOn), deliveryCondition: o.deliveryCondition, satDoneOn: fromDbDateOrNull(o.satDoneOn) },
        input,
      );
    });
    return this.get(user, id);
  }

  async saveSat(user: SessionUser, id: string, input: SatInput) {
    await this.must(user, "delivery.manage", "delivery_sat", "manage delivery and SAT");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      if (o.satDoneOn && input.checks.some((c) => c.result === "fail" || c.result === "pending"))
        throw new DomainError("The SAT is signed off. Clear the sign-off date before reopening a point.");
      const existing = await tx.satCheck.findMany({ where: { orderId: id } });
      await this.replaceList(
        tx,
        existing.map((e) => e.id),
        input.checks,
        (c, i) => ({ item: c.item, result: c.result, note: c.note, sortOrder: i }),
        {
          remove: (ids) => tx.satCheck.deleteMany({ where: { id: { in: ids }, orderId: id } }),
          update: (rowId, data) => tx.satCheck.update({ where: { id: rowId }, data }),
          create: (data) => tx.satCheck.create({ data: { ...data, orderId: id } }),
        },
        "SAT point",
      );
      const passed = input.checks.filter((c) => c.result === "pass").length;
      await this.log(tx, user, id, "sat", `${o.refNo}: SAT checklist saved (${passed} of ${input.checks.length} passed)`, undefined, input);
    });
    return this.get(user, id);
  }

  async addClaim(user: SessionUser, id: string, input: ClaimInput) {
    await this.must(user, "delivery.manage", "delivery_sat", "manage delivery and SAT");
    if (input.openedOn && input.openedOn > this.clock.today()) throw new DomainError("The date cannot be in the future.");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      await tx.orderClaim.create({
        data: { orderId: id, title: input.title, detail: input.detail, openedOn: toDbDate(input.openedOn ?? this.clock.today()) },
      });
      await this.log(tx, user, id, "claim", `${o.refNo}: claim opened: ${input.title}`, undefined, input);
    });
    return this.get(user, id);
  }

  async updateClaim(user: SessionUser, claimId: string, input: ClaimUpdateInput) {
    await this.must(user, "delivery.manage", "delivery_sat", "manage delivery and SAT");
    const orderId = await this.orderOf("orderClaim", claimId);
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, orderId);
      const before = await tx.orderClaim.findUniqueOrThrow({ where: { id: claimId } });
      const status = input.status ?? before.status;
      const closing = (status === "resolved" || status === "rejected") && before.status !== status;
      const resolution = input.resolution !== undefined ? input.resolution : before.resolution;
      if (closing && !resolution) throw new DomainError("Say how the claim was settled.");
      const resolvedOn =
        input.resolvedOn !== undefined
          ? input.resolvedOn
          : closing
            ? this.clock.today()
            : status === "open" || status === "with_factory"
              ? null
              : fromDbDateOrNull(before.resolvedOn);
      if (resolvedOn && resolvedOn < fromDbDate(before.openedOn)) throw new DomainError("A claim cannot be settled before it was opened.");
      await tx.orderClaim.update({
        where: { id: claimId },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.detail !== undefined && { detail: input.detail }),
          status,
          resolution,
          resolvedOn: toDbDateOrNull(resolvedOn),
        },
      });
      await this.log(
        tx,
        user,
        orderId,
        "claim",
        `${o.refNo}: claim "${before.title}" ${CLAIM_STATUS_LABEL[status].toLowerCase()}`,
        { status: before.status },
        input,
      );
    });
    return this.get(user, orderId);
  }
  /* ---------------------------------------------------------------- one tap */

  /**
   * POST /orders/:id/delivery/all-good — "All delivered OK": every goods line
   * delivered in full and in good condition, and the delivery dated (today
   * unless a day is sent; a date already recorded stays). One history entry.
   */
  async deliveryAllGood(user: SessionUser, id: string, input: DeliveryAllGoodInput) {
    await this.must(user, "delivery.manage", "delivery_sat", "manage delivery and SAT");
    const on = input.deliveredOn ?? this.clock.today();
    if (on > this.clock.today()) throw new DomainError("A date that has happened cannot be in the future.");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      const lines = await tx.orderLine.findMany({ where: { orderId: id, type: "goods" }, select: { id: true, quantity: true } });
      for (const l of lines)
        await tx.orderLine.update({ where: { id: l.id }, data: { deliveredQty: l.quantity, deliveredCondition: "good" } });
      const deliveredOn = fromDbDateOrNull(o.deliveredOn) ?? on;
      await tx.order.update({ where: { id }, data: { deliveredOn: toDbDate(deliveredOn), deliveryCondition: "good" } });
      await this.log(
        tx,
        user,
        id,
        "delivery",
        `${o.refNo}: all delivered in good condition on ${deliveredOn} (${lines.length} line${lines.length === 1 ? "" : "s"})`,
        { deliveredOn: fromDbDateOrNull(o.deliveredOn), deliveryCondition: o.deliveryCondition },
        { deliveredOn, deliveryCondition: "good", lines: lines.length, allGood: true },
      );
    });
    return this.get(user, id);
  }

  /**
   * POST /orders/:id/sat/all-passed — "All passed": every SAT point not marked
   * N/A passes (none yet: the usual points, passed) and the SAT is signed off
   * (today unless a day is sent) by the person named. Needs the delivery.
   */
  async satAllPassed(user: SessionUser, id: string, input: SatAllPassedInput) {
    await this.must(user, "delivery.manage", "delivery_sat", "manage delivery and SAT");
    const on = input.satDoneOn ?? this.clock.today();
    if (on > this.clock.today()) throw new DomainError("A date that has happened cannot be in the future.");
    await this.prisma.tx(async (tx) => {
      const o = await this.lockOrder(tx, user, id);
      const delivered = fromDbDateOrNull(o.deliveredOn);
      if (!delivered) throw new DomainError("Record the delivery before signing off the SAT.");
      if (on < delivered) throw new DomainError("The SAT cannot be signed off before the delivery.");
      const checks = await tx.satCheck.findMany({ where: { orderId: id } });
      if (checks.length)
        await tx.satCheck.updateMany({ where: { orderId: id, result: { in: ["pending", "fail"] } }, data: { result: "pass" } });
      else
        await tx.satCheck.createMany({
          data: DEFAULT_SAT_CHECKS.map((item, i) => ({ orderId: id, item, result: "pass" as const, sortOrder: i })),
        });
      const signedBy = input.satSignedBy !== undefined ? input.satSignedBy : o.satSignedBy;
      await tx.order.update({ where: { id }, data: { satDoneOn: toDbDate(on), satSignedBy: signedBy } });
      const points = checks.length || DEFAULT_SAT_CHECKS.length;
      await this.log(
        tx,
        user,
        id,
        "sat",
        `${o.refNo}: SAT all passed (${points} point${points === 1 ? "" : "s"}), signed off on ${on}${signedBy ? ` by ${signedBy}` : ""}`,
        { satDoneOn: fromDbDateOrNull(o.satDoneOn), satSignedBy: o.satSignedBy },
        { satDoneOn: on, satSignedBy: signedBy, allPassed: true },
      );
    });
    return this.get(user, id);
  }

  /* ---------------------------------------------------------------- what the light rows fill in */

  /**
   * GET /orders/:id/defaults — what a step's row can fill in for the person
   * from earlier orders and the quote: the forwarder of the last order on the
   * same route (same ports, else the same factory), the banks of this
   * customer's last LC or bank contract, the lead time of the accepted quote
   * (and the ready date it gives) and the factory's price basis. Only orders
   * the person may see are looked at; nothing is saved.
   */
  async defaults(user: SessionUser, id: string) {
    const o = await this.prisma.db.order.findFirst({
      where: { id, ...orderAccess(user) },
      select: {
        id: true,
        customerId: true,
        incotermPlace: true,
        portOfDischarge: true,
        factoryOrderedOn: true,
        revisionId: true,
        shipments: { orderBy: { createdAt: "asc" }, take: 1, select: { portOfLoading: true, portOfDischarge: true } },
        lines: { where: { factoryId: { not: null } }, select: { factoryId: true } },
      },
    });
    if (!o) throw new NotFoundError("Order");
    const features = await this.limits.features();
    const has = (f: PlanFeature) => !features || features.includes(f);
    const others = { id: { not: id }, ...orderAccess(user) };
    const ci = (v: string) => ({ equals: v.trim(), mode: "insensitive" as const });

    // The forwarder: same port pair first, then the same factory.
    let forwarder: { name: string; refNo: string; why: "route" | "factory" } | null = null;
    if (has("shipping")) {
      const pol = o.shipments[0]?.portOfLoading ?? o.incotermPlace;
      const pod = o.shipments[0]?.portOfDischarge ?? o.portOfDischarge;
      const pick = { forwarder: true, order: { select: { refNo: true } } } as const;
      const byRoute =
        pol && pod
          ? await this.prisma.db.shipment.findFirst({
              where: { forwarder: { not: null }, portOfLoading: ci(pol), portOfDischarge: ci(pod), order: others },
              orderBy: { createdAt: "desc" },
              select: pick,
            })
          : null;
      const factoryIds = [...new Set(o.lines.map((l) => l.factoryId!))];
      const byFactory =
        !byRoute && factoryIds.length
          ? await this.prisma.db.shipment.findFirst({
              where: { forwarder: { not: null }, order: { ...others, lines: { some: { factoryId: { in: factoryIds } } } } },
              orderBy: { createdAt: "desc" },
              select: pick,
            })
          : null;
      const hit = byRoute ?? byFactory;
      if (hit?.forwarder) forwarder = { name: hit.forwarder, refNo: hit.order.refNo, why: byRoute ? "route" : "factory" };
    }

    // The banks of this customer's last LC or bank contract.
    let banks: { customerBank: string | null; ourBank: string | null; refNo: string } | null = null;
    if (has("bank_contracts")) {
      const last = await this.prisma.db.orderBankContract.findFirst({
        where: { OR: [{ customerBank: { not: null } }, { ourBank: { not: null } }], order: { ...others, customerId: o.customerId } },
        orderBy: { createdAt: "desc" },
        select: { customerBank: true, ourBank: true, order: { select: { refNo: true } } },
      });
      if (last) banks = { customerBank: last.customerBank, ourBank: last.ourBank, refNo: last.order.refNo };
    }

    // The lead time of the accepted quote, and the ready date it gives from the day we ordered (or today).
    const rev = await this.prisma.db.quotationRevision.findUnique({
      where: { id: o.revisionId },
      select: {
        leadTime: true,
        options: {
          where: { status: "accepted" },
          take: 1,
          select: { leadTime: true, factoryBasis: true, factoryBasisPlace: true },
        },
      },
    });
    const option = rev?.options[0] ?? null;
    const text = option?.leadTime ?? rev?.leadTime ?? null;
    const days = leadDays(text);
    const from = fromDbDateOrNull(o.factoryOrderedOn) ?? this.clock.today();
    return {
      forwarder,
      banks,
      leadTime: text ? { text, days, from, readyOn: days ? addDays(from, days) : null } : null,
      priceBasis: can(user, "sourcing.manage") && option?.factoryBasis ? { basis: option.factoryBasis, place: option.factoryBasisPlace } : null,
    };
  }
}

/** "45 days", "8-10 weeks", "2 months after the deposit" → days (the longer end of a range); null when it says no number. */
export function leadDays(text: string | null): number | null {
  if (!text) return null;
  const m = /(\d+)(?:\s*(?:-|–|to)\s*(\d+))?\s*(working days?|days?|weeks?|wks?|months?)/i.exec(text);
  if (!m) return null;
  const n = Number(m[2] ?? m[1]);
  const unit = m[3]!.toLowerCase();
  const days = unit.startsWith("month") ? n * 30 : unit.startsWith("w") && !unit.startsWith("working") ? n * 7 : unit.startsWith("working") ? Math.ceil((n * 7) / 5) : n;
  return days > 0 && days <= 730 ? days : null;
}
