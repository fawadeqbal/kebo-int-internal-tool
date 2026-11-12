import { Injectable } from "@nestjs/common";
import { decimalToMinor, fromDbDateOrNull, isSupplier, livePart, termsSelect, toDbDateOrNull, type Prisma } from "@kebo/database";
import { formatMinor, fromMinor, toMinor, type Minor } from "@kebo/money";
import {
  can,
  dueRuleWords,
  paperNumber,
  planStatus,
  routePaymentSentence,
  type FactoryPlanInput,
  type InvoiceSide,
  type PaymentPlanInput,
  type PlanDueRule,
  type RequestState,
} from "@kebo/shared";
import { dateIn, daysBetween, DomainError, ForbiddenError, NotFoundError, type ISODate } from "@kebo/utils";
import { LimitsService } from "../../common/company/limits.service";
import { PrismaService, type Tx } from "../../database/prisma.service";
import { AuditService } from "../../common/audit/audit.service";
import { requireReason } from "../../common/audit/reason";
import { orderAccess } from "../../common/auth/order-access";
import { Clock } from "../../common/time/clock.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { ordersOwingFactories, ordersWithMoneyDue } from "./due";
import { factoryPlansOf, owedByFactory } from "./factory-plan";
import { chargedExpenses, factoryBorneExpenses, factoryPositionOf, fxOf, positionOf, supplierPaidRelation } from "./position";
import { livePlanOf, livePlansOf } from "./plan-live";
import { termsOf } from "./route-plan";
import { requestsOf, requestViewOf } from "./requests";

const person = { select: { id: true, name: true } } as const;

/** Lines of an order with the factory price frozen on them when it was made (for what we owe each factory). */
const linesWithFactory = {
  orderBy: { sortOrder: "asc" },
  include: { factory: { select: { id: true, name: true, owner: person } } },
} satisfies Prisma.Order$linesArgs;

type FactoryRow = { id: string; name: string; owner: { id: string; name: string } | null };

/**
 * Billing (claude/billing-4-design.md): the invoices of each order, both sides. The customer's are the
 * instalments of its payment plan (each with its payment request number), a supplier's the parts we pay
 * it in. Only Billing writes them; paid, due and late are worked out from the order's payments.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly limits: LimitsService,
    private readonly clock: Clock,
  ) {}

  /** The order, if the person may see it (locked first by the caller), with what pays it. */
  private async orderFor(user: SessionUser, orderId: string, tx: Tx) {
    const o = await tx.order.findFirst({
      where: { id: orderId, ...orderAccess(user) },
      select: { id: true, refNo: true, status: true, total: true, currency: true, allocations: { where: livePart, select: { id: true } } },
    });
    if (!o) throw new NotFoundError("Order");
    return o;
  }

  /* ---------------------------------------------------------------- the plan */

  /**
   * Replace the order's instalments. They must add up to the order total. Once
   * the customer has paid something, changing the plan says why.
   */
  async setPlan(user: SessionUser, orderId: string, input: PaymentPlanInput) {
    if (!can(user, "orders.update")) throw new ForbiddenError("You cannot change orders.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orderFor(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const sum = input.items.reduce((t, i) => t + toMinor(i.amount), 0);
      const total = decimalToMinor(o.total);
      if (sum !== total)
        throw new DomainError(
          `The instalments add up to ${formatMinor(sum, o.currency)}, but the order is ${formatMinor(total, o.currency)}. Make them match.`,
        );
      const before = await tx.invoice.findMany({ where: { orderId }, orderBy: { sortOrder: "asc" } });
      const live = await livePlanOf(tx, orderId);
      const { reminders } = await this.settings.get();
      // Each row's due rule: as sent; else a date typed makes it fixed (unless it is the date its rule gives now),
      // and no date keeps the rule it had. Only a fixed row keeps a date; the others are worked out each time.
      const rows = input.items.map((i, n) => {
        const old = i.id ? before.find((b) => b.id === i.id) : undefined;
        const oldRule = old?.dueRule && old.dueRule !== "fixed" ? (old.dueRule as PlanDueRule) : null;
        const rule: PlanDueRule | null =
          i.dueRule !== undefined
            ? i.dueRule
            : i.dueOn
              ? oldRule && live.items.find((x) => x.id === old!.id)?.dueOn === i.dueOn
                ? oldRule
                : "fixed"
              : oldRule;
        if (rule === "fixed" && !i.dueOn) throw new DomainError(`Give “${i.label}” its date.`);
        const dueDays =
          rule === "on_ship_plus_days"
            ? (i.dueDays ?? old?.dueDays ?? reminders.balanceDays)
            : rule === "after_papers"
              ? (i.dueDays ?? old?.dueDays ?? 0)
              : null;
        return {
          id: i.id,
          label: i.label,
          amount: i.amount,
          dueOn: rule === "fixed" ? i.dueOn : null,
          dueRule: rule,
          dueDays,
          sortOrder: n,
        };
      });
      const describe = (rows: { label: string; amount: string; dueOn: string | null; dueRule: string | null; dueDays: number | null }[]) =>
        rows.map((r) => `${r.label} ${r.amount}${r.dueOn ? ` by ${r.dueOn}` : dueRuleWords(r) ? ` ${dueRuleWords(r)}` : ""}`).join("; ");
      const was = describe(
        before.map((b) => ({
          label: b.label,
          amount: b.amount.toFixed(2),
          dueOn: fromDbDateOrNull(b.dueOn),
          dueRule: b.dueRule,
          dueDays: b.dueDays,
        })),
      );
      const now = describe(rows.map((r) => ({ ...r, amount: fromMinor(toMinor(r.amount)) })));
      if (was === now) return;
      const paid = o.allocations.length > 0;
      const reason = paid
        ? requireReason(input.reason, "plan", "the payment plan changes after the customer has paid")
        : (input.reason ?? null);
      const keep = new Set(before.map((b) => b.id));
      await tx.invoice.deleteMany({
        where: { orderId, id: { notIn: rows.map((i) => i.id).filter((id): id is string => !!id && keep.has(id)) } },
      });
      for (const { id, ...r } of rows) {
        const row = {
          label: r.label,
          amount: r.amount,
          dueOn: toDbDateOrNull(r.dueOn),
          dueRule: r.dueRule,
          dueDays: r.dueDays,
          sortOrder: r.sortOrder,
        };
        if (id && keep.has(id)) await tx.invoice.update({ where: { id }, data: row });
        else await tx.invoice.create({ data: { ...row, orderId } });
      }
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_plan",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: payment plan changed`,
        oldValues: { plan: was },
        newValues: { plan: now },
        reason,
      });
    });
  }

  /**
   * The factory's payment plan on this order: its parts in order (they add up
   * to what we owe it on the order's lines), each due when we order, on the
   * ready date (it moves with it) or on a fixed day.
   */
  async setFactoryPlan(user: SessionUser, orderId: string, input: FactoryPlanInput) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot change what we pay the factories.");
    await this.prisma.tx(async (tx) => {
      await tx.$queryRaw`select id from orders where id = ${orderId}::uuid for update`;
      const o = await this.orderFor(user, orderId, tx);
      if (o.status === "cancelled") throw new DomainError("This order is cancelled.");
      const f = await tx.party.findFirst({ where: { ...isSupplier, id: input.factoryId } });
      if (!f) throw new DomainError("Choose a factory of this order.");
      const lines = await tx.orderLine.findMany({
        where: { orderId, factoryId: f.id },
        include: { factory: { select: { id: true, name: true } } },
      });
      const owed = [...owedByFactory(lines).values()][0];
      if (!owed) throw new DomainError(`${f.name} has no lines with a price on this order.`);
      const sum = input.items.reduce((t, i) => t + toMinor(i.amount), 0);
      if (sum !== owed.owedMinor)
        throw new DomainError(
          `The parts add up to ${formatMinor(sum, owed.currency)}, but we owe ${f.name} ${formatMinor(owed.owedMinor, owed.currency)}. Make them match.`,
        );
      for (const i of input.items) if (i.dueRule === "fixed" && !i.dueOn) throw new DomainError(`Give “${i.label}” its date.`);
      const before = await tx.invoice.findMany({ where: { purchaseOrderId: orderId, supplierId: f.id }, orderBy: { sortOrder: "asc" } });
      await tx.invoice.deleteMany({ where: { purchaseOrderId: orderId, supplierId: f.id } });
      await tx.invoice.createMany({
        data: input.items.map((i, n) => ({
          purchaseOrderId: orderId,
          supplierId: f.id,
          label: i.label,
          percent: i.percent,
          amount: i.amount,
          currency: owed.currency,
          dueRule: i.dueRule,
          dueOn: i.dueRule === "fixed" ? toDbDateOrNull(i.dueOn) : null,
          supplierRef: i.supplierRef ?? null,
          sortOrder: n,
        })),
      });
      const describe = (rows: { label: string; amount: string; dueRule: string | null; supplierRef: string | null }[]) =>
        rows.map((r) => `${r.label} ${r.amount} (${r.dueRule})${r.supplierRef ? ` inv. ${r.supplierRef}` : ""}`).join("; ");
      await this.audit.record(tx, {
        userId: user.id,
        action: "payment_out_plan",
        entityType: "order",
        entityId: orderId,
        summary: `${o.refNo}: plan for paying ${f.name} set`,
        oldValues: {
          plan: describe(
            before.map((b) => ({ label: b.label, amount: b.amount.toFixed(2), dueRule: b.dueRule, supplierRef: b.supplierRef })),
          ),
        },
        newValues: {
          plan: describe(
            input.items.map((i) => ({
              label: i.label,
              amount: fromMinor(toMinor(i.amount)),
              dueRule: i.dueRule,
              supplierRef: i.supplierRef ?? null,
            })),
          ),
        },
      });
    });
  }

  /** What we still owe each factory across all orders that are not cancelled (people who see costs). */
  async payables(user: SessionUser, mine: boolean) {
    if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factory costs.");
    // Only orders where a factory may still be owed (worked out in the database, the same rule), not every order ever.
    const s = await this.settings.get();
    const fx = fxOf(s, await this.limits.allows("expenses"));
    const owing = await ordersOwingFactories(this.prisma, fx);
    const orders = await this.prisma.db.order.findMany({
      where: { status: { not: "cancelled" }, id: { in: owing } },
      select: {
        id: true,
        refNo: true,
        stage: true,
        customer: { select: { name: true } },
        lines: linesWithFactory,
        supplierPaid: supplierPaidRelation,
        expenses: factoryBorneExpenses,
      },
      orderBy: { orderedOn: "asc" },
    });
    const byFactory = new Map<
      string,
      {
        factory: FactoryRow;
        currency: string;
        owedMinor: Minor;
        paidMinor: Minor;
        orders: {
          id: string;
          refNo: string;
          stage: string;
          customer: string;
          toPay: string;
          next: { label: string; due: string | null; open: string; status: string } | null;
        }[];
      }
    >();
    const today = this.clock.today();
    for (const o of orders) {
      const factoryOf = new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory] as const] : [])));
      // What we owe each factory here, less what we paid and what it bears: factoryPosition, as on the order.
      for (const f of factoryPositionOf(o, fx).filter((r) => r.lines > 0)) {
        // Only orders with something still to pay count, so "paid X of Y" is about those.
        if (f.toPayMinor <= 0) continue;
        const factory = factoryOf.get(f.factoryId)!;
        const row = byFactory.get(f.key) ?? { factory, currency: f.currency, owedMinor: 0, paidMinor: 0, orders: [] };
        row.owedMinor += f.owedMinor;
        row.paidMinor += f.settledMinor;
        // The next part of its payment plan (advance, balance on the ready date…): when it is due.
        const plan = (await factoryPlansOf(this.prisma.db, o.id, s.sales.factoryAdvancePercent, today, s.reminders.dueSoonDays, fx)).find(
          (p) => `${p.factory.id}:${p.currency}` === f.key,
        );
        row.orders.push({
          id: o.id,
          refNo: o.refNo,
          stage: o.stage,
          customer: o.customer.name,
          toPay: fromMinor(f.toPayMinor),
          next: plan?.next ?? null,
        });
        byFactory.set(f.key, row);
      }
    }
    return [...byFactory.values()]
      .filter((r) => r.orders.length && (!mine || r.factory.owner?.id === user.id))
      .map((r) => ({
        factory: { id: r.factory.id, name: r.factory.name },
        lookedAfterBy: r.factory.owner,
        currency: r.currency,
        owed: fromMinor(r.owedMinor),
        paid: fromMinor(r.paidMinor),
        toPay: fromMinor(r.orders.reduce((t, o) => t + toMinor(o.toPay), 0)),
        orders: r.orders,
      }))
      .sort((a, b) => Number(b.toPay) - Number(a.toPay));
  }

  /* ---------------------------------------------------------------- one payment request */

  /**
   * One payment request (a row of the order's plan, or a request that was sent and whose row is gone): what
   * it asks for, where it stands (not sent, sent, part paid, paid, cancelled), every copy kept when it was sent
   * (R1, R2…) and the payments that paid it. Seeing it follows the order.
   */
  async request(user: SessionUser, orderId: string, ref: string) {
    const o = await this.prisma.db.order.findFirst({
      where: { id: orderId, ...orderAccess(user) },
      select: {
        id: true,
        refNo: true,
        status: true,
        currency: true,
        mainCurrency: true,
        mainRate: true,
        depositPercent: true,
        total: true,
        expenses: chargedExpenses,
        customer: { select: { id: true, name: true } },
        allocations: { where: livePart, select: { amount: true, bankCharges: true } },
        receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
      },
    });
    if (!o) throw new NotFoundError("Order");
    const s = await this.settings.get();
    const fx = fxOf(s, await this.limits.allows("expenses"));
    const today = this.clock.today();
    const pos = positionOf(o, fx);
    const plan = planStatus((await livePlanOf(this.prisma.db, o.id)).items, pos.settledMinor, today, s.reminders.dueSoonDays);
    const requests = (await requestsOf(this.prisma.db, [o.id], this.clock.timeZone)).get(o.id);
    const row = plan.find((p) => p.id === ref) ?? null;
    const copies = row ? (requests?.copies.get(ref) ?? []) : (requests?.gone.filter((g) => g.ref === ref) ?? []);
    if (!row && !copies.length) throw new NotFoundError("Payment request");
    const last = copies.at(-1) ?? null;
    const canSend = (can(user, "orders.update") || can(user, "documents.manage")) && o.status !== "cancelled";
    const base = { orderId: o.id, refNo: o.refNo, orderStatus: o.status, customer: o.customer, currency: o.currency, ref, copies };
    if (!row)
      return {
        ...base,
        number: last!.number,
        label: last!.label ?? "Payment request",
        amount: last!.amount ?? fromMinor(0),
        dueOn: last!.dueOn,
        paid: fromMinor(0),
        open: fromMinor(0),
        late: 0,
        part: null,
        rule: null,
        /** Its row was taken out of the plan after it was sent: it stays as it was sent. */
        cancelled: true,
        request: null,
        canSend: false,
        canPay: false,
      };
    return {
      ...base,
      number: paperNumber(o.refNo, "payment-request", row.requestNo),
      label: row.label,
      amount: fromMinor(row.amountMinor),
      dueOn: row.dueOn,
      paid: fromMinor(row.paidMinor),
      open: fromMinor(row.openMinor),
      late: row.openMinor > 0 ? lateDays(row.dueOn, today) : 0,
      part: row.part,
      rule: dueRuleWords(row),
      cancelled: false,
      request: requestViewOf(row, requests),
      // A bank route's balance is asked for with the papers through the banks, not with a request.
      canSend: canSend && row.openMinor > 0 && !requests?.byBank.has(row.id),
      canPay: can(user, "payments.record") && o.status !== "cancelled" && row.openMinor > 0,
    };
  }

  /**
   * Payment requests, across the orders a person may see that still have money due: every row of their
   * plans (paid ones too, so an order reads whole) with where it stands, and the requests that were sent
   * and then cancelled. Late first, then by due date. `mine`: the orders I handle.
   */
  async requests(user: SessionUser, mine: boolean) {
    const today = this.clock.today();
    const s = await this.settings.get();
    const fx = fxOf(s, await this.limits.allows("expenses"));
    const orders = await this.prisma.db.order.findMany({
      where: {
        AND: [orderAccess(user), mine ? { inquiry: { assigneeId: user.id } } : {}],
        status: { in: ["open", "closed"] },
        id: { in: await ordersWithMoneyDue(this.prisma, fx) },
      },
      select: {
        id: true,
        refNo: true,
        currency: true,
        mainCurrency: true,
        mainRate: true,
        depositPercent: true,
        total: true,
        expenses: chargedExpenses,
        customer: { select: { id: true, name: true } },
        inquiry: { select: { assignee: person } },
        allocations: { where: livePart, select: { amount: true, bankCharges: true } },
        receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
      },
    });
    const ids = orders.map((o) => o.id);
    const [plans, requests] = await Promise.all([livePlansOf(this.prisma.db, ids), requestsOf(this.prisma.db, ids, this.clock.timeZone)]);
    const rows = orders.flatMap((o) => {
      const r = requests.get(o.id);
      const head = { order: { id: o.id, refNo: o.refNo }, customer: o.customer, lookedAfterBy: o.inquiry.assignee, currency: o.currency };
      const plan = planStatus(plans.get(o.id)?.items ?? [], positionOf(o, fx).settledMinor, today, s.reminders.dueSoonDays);
      return [
        ...plan.map((i) => {
          const v = requestViewOf(i, r);
          return {
            ...head,
            ref: i.id,
            number: paperNumber(o.refNo, "payment-request", i.requestNo),
            label: i.label,
            amount: fromMinor(i.amountMinor),
            paid: fromMinor(i.paidMinor),
            open: fromMinor(i.openMinor),
            dueOn: i.dueOn,
            late: i.openMinor > 0 ? lateDays(i.dueOn, today) : 0,
            soon: i.status === "due_soon",
            state: v.state as RequestState | "cancelled",
            with: v.with,
            sentOn: v.sentOn,
            revision: v.revision,
            changed: v.changed,
            through: v.through,
          };
        }),
        // Sent, then taken out of the plan: the last copy of each, as it was sent.
        ...[...new Map((r?.gone ?? []).map((g) => [g.ref, g])).values()].map((g) => ({
          ...head,
          ref: g.ref,
          number: g.number,
          label: g.label ?? "Payment request",
          amount: g.amount ?? fromMinor(0),
          paid: fromMinor(0),
          open: fromMinor(0),
          dueOn: g.dueOn,
          late: 0,
          soon: false,
          state: "cancelled" as RequestState | "cancelled",
          with: "request" as const,
          sentOn: g.sentOn,
          revision: g.revision,
          changed: false,
          through: "customer" as "customer" | "bank",
        })),
      ];
    });
    rows.sort(
      (a, b) => b.late - a.late || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.order.refNo.localeCompare(b.order.refNo) || a.number.localeCompare(b.number),
    );
    return { rows, canPay: can(user, "payments.record"), canSend: can(user, "orders.update") || can(user, "documents.manage") };
  }

  /* ---------------------------------------------------------------- customer invoices */

  /**
   * The invoice of an order as its customer knows it: the commercial invoice once it is made, the proforma
   * before that. One per order; paid is worked out from the order's payments, never typed.
   */
  private invoiceOf(o: {
    proformaNo: string | null;
    proformaIssuedOn: Date | null;
    papers: { kind: string; number: string; version: number; finalAt: Date | null; madeAt: Date }[];
  }) {
    const ci = o.papers.filter((p) => p.kind === "commercial-invoice").at(-1);
    if (ci) return { kind: "commercial" as const, number: ci.number, issuedOn: dateIn(ci.finalAt ?? ci.madeAt, this.clock.timeZone), version: ci.version };
    if (!o.proformaNo) return null;
    const pi = o.papers.filter((p) => p.kind === "proforma").at(-1);
    return {
      kind: "proforma" as const,
      number: o.proformaNo,
      issuedOn: fromDbDateOrNull(o.proformaIssuedOn) ?? (pi ? dateIn(pi.finalAt ?? pi.madeAt, this.clock.timeZone) : this.clock.today()),
      version: pi?.version ?? 1,
    };
  }

  private static readonly invoicePapers = {
    where: { kind: { in: ["proforma", "commercial-invoice"] }, status: "final" },
    orderBy: { version: "asc" },
    select: { kind: true, number: true, version: true, finalAt: true, madeAt: true },
  } satisfies Prisma.Order$papersArgs;

  /**
   * Invoices to customers across the orders a person may see (not cancelled, newest first): each order's
   * invoice with its total, what was paid and where it stands (unpaid, part paid, paid), and how late its
   * oldest open part is. `mine`: the orders I handle.
   */
  async customerInvoices(user: SessionUser, mine: boolean) {
    const today = this.clock.today();
    const s = await this.settings.get();
    const fx = fxOf(s, await this.limits.allows("expenses"));
    const orders = await this.prisma.db.order.findMany({
      where: {
        AND: [orderAccess(user), mine ? { inquiry: { assigneeId: user.id } } : {}],
        status: { in: ["open", "closed"] },
        OR: [{ proformaNo: { not: null } }, { papers: { some: { kind: "commercial-invoice", status: "final" } } }],
      },
      select: {
        id: true,
        refNo: true,
        currency: true,
        mainCurrency: true,
        mainRate: true,
        depositPercent: true,
        total: true,
        proformaNo: true,
        proformaIssuedOn: true,
        expenses: chargedExpenses,
        customer: { select: { id: true, name: true } },
        inquiry: { select: { assignee: person } },
        allocations: { where: livePart, select: { amount: true, bankCharges: true } },
        receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
        papers: BillingService.invoicePapers,
      },
      orderBy: [{ orderedOn: "desc" }, { refNo: "desc" }],
      take: 500,
    });
    const plans = await livePlansOf(
      this.prisma.db,
      orders.map((o) => o.id),
    );
    return {
      rows: orders.flatMap((o) => {
        const invoice = this.invoiceOf(o);
        if (!invoice) return [];
        const pos = positionOf(o, fx);
        const plan = planStatus(plans.get(o.id)?.items ?? [], pos.settledMinor, today, s.reminders.dueSoonDays);
        const next = plan.find((p) => p.openMinor > 0) ?? null;
        return [
          {
            invoice,
            order: { id: o.id, refNo: o.refNo },
            customer: o.customer,
            lookedAfterBy: o.inquiry.assignee,
            currency: o.currency,
            total: fromMinor(pos.owedMinor),
            paid: fromMinor(pos.settledMinor),
            due: fromMinor(pos.dueMinor),
            status: (pos.dueMinor <= 0 ? "paid" : pos.settledMinor > 0 ? "part_paid" : "unpaid") as "paid" | "part_paid" | "unpaid",
            /** The oldest open part: when it is due and how late it is. */
            nextDue: next?.dueOn ?? null,
            late: next ? lateDays(next.dueOn, today) : 0,
          },
        ];
      }),
    };
  }

  /**
   * One order's invoice, its own view: what it bills (the order's lines), how it is paid (the parts of the
   * plan, each a request with where it stands; payments and receipts are on the request) and its terms.
   */
  async customerInvoice(user: SessionUser, orderId: string) {
    const o = await this.prisma.db.order.findFirst({
      where: { id: orderId, ...orderAccess(user) },
      select: {
        id: true,
        refNo: true,
        status: true,
        currency: true,
        mainCurrency: true,
        mainRate: true,
        depositPercent: true,
        total: true,
        proformaNo: true,
        proformaIssuedOn: true,
        incoterm: true,
        incotermPlace: true,
        balanceTerms: true,
        ...termsSelect,
        expenses: chargedExpenses,
        customer: { select: { id: true, name: true } },
        inquiry: { select: { id: true, assignee: person } },
        revision: { select: { number: true, quotation: { select: { refNo: true } } } },
        allocations: { where: livePart, select: { amount: true, bankCharges: true } },
        receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
        papers: BillingService.invoicePapers,
        lines: { orderBy: { sortOrder: "asc" }, select: { id: true, type: true, description: true, model: true, quantity: true, unit: true, unitPrice: true, lineTotal: true } },
      },
    });
    if (!o) throw new NotFoundError("Order");
    // Null: no invoice issued yet (the proforma comes first); the view still shows what it will bill.
    const invoice = this.invoiceOf(o);
    const s = await this.settings.get();
    const fx = fxOf(s, await this.limits.allows("expenses"));
    const today = this.clock.today();
    const pos = positionOf(o, fx);
    const plan = planStatus((await livePlanOf(this.prisma.db, o.id)).items, pos.settledMinor, today, s.reminders.dueSoonDays);
    const requests = (await requestsOf(this.prisma.db, [o.id], this.clock.timeZone)).get(o.id);
    const linesMinor = o.lines.reduce((t, l) => t + decimalToMinor(l.lineTotal), 0);
    const proforma = o.papers.filter((p) => p.kind === "proforma");
    const commercial = o.papers.filter((p) => p.kind === "commercial-invoice");
    return {
      invoice,
      order: { id: o.id, refNo: o.refNo, status: o.status },
      customer: o.customer,
      lookedAfterBy: o.inquiry.assignee,
      currency: o.currency,
      lines: o.lines.map((l) => ({
        id: l.id,
        type: l.type,
        description: l.description,
        model: l.model,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: l.unitPrice.toFixed(2),
        amount: l.lineTotal.toFixed(2),
      })),
      /** The lines add up to more than the order total: the discount agreed on the quotation. */
      discount: linesMinor > decimalToMinor(o.total) ? fromMinor(linesMinor - decimalToMinor(o.total)) : null,
      orderTotal: o.total.toFixed(2),
      charged: fromMinor(pos.chargedMinor),
      total: fromMinor(pos.owedMinor),
      paid: fromMinor(pos.settledMinor),
      due: fromMinor(pos.dueMinor),
      status: (pos.dueMinor <= 0 ? "paid" : pos.settledMinor > 0 ? "part_paid" : "unpaid") as "paid" | "part_paid" | "unpaid",
      parts: plan.map((p) => {
        const v = requestViewOf(p, requests);
        return {
          ref: p.id,
          number: paperNumber(o.refNo, "payment-request", p.requestNo),
          label: p.label,
          dueOn: p.dueOn,
          rule: dueRuleWords(p),
          amount: fromMinor(p.amountMinor),
          paid: fromMinor(p.paidMinor),
          late: p.openMinor > 0 ? lateDays(p.dueOn, today) : 0,
          request: { state: v.state, with: v.with, sentOn: v.sentOn, revision: v.revision, changed: v.changed, through: v.through },
          /** When its last payment came (a paid part: "Paid 05 Oct"). */
          lastPaidOn: v.receipts.at(-1)?.paidOn ?? null,
        };
      }),
      terms: {
        priceBasis: [o.incoterm, o.incotermPlace].filter(Boolean).join(" "),
        payment: routePaymentSentence(pos.depositPercent, termsOf(o), o.balanceTerms),
      },
      linked: {
        quotation: o.revision.quotation ? { refNo: o.revision.quotation.refNo, revision: o.revision.number, inquiryId: o.inquiry.id } : null,
        proforma: o.proformaNo ? { number: o.proformaNo, versions: proforma.length } : null,
        commercial: commercial.length ? { number: commercial.at(-1)!.number, versions: commercial.length } : null,
      },
    };
  }

  /* ---------------------------------------------------------------- open invoices */

  /**
   * Every invoice still open on one side, instalment by instalment: the customer's (with its payment request
   * number) or the suppliers' (with their own number, if known). Late first (most days late), then by due date;
   * no date last. Each is paid in due order from the order's payments, as everywhere else. `mine`: the orders I
   * handle (receivable) or the suppliers I look after (payable).
   */
  async openInvoices(user: SessionUser, side: InvoiceSide, mine: boolean) {
    const today = this.clock.today();
    const s = await this.settings.get();
    const fx = fxOf(s, await this.limits.allows("expenses"));
    const rows: OpenInvoice[] = [];
    if (side === "receivable") {
      if (!can(user, "payments.record") && !can(user, "expenses.manage")) throw new ForbiddenError("You do not record money.");
      const orders = await this.prisma.db.order.findMany({
        where: {
          status: { in: ["open", "closed"] },
          id: { in: await ordersWithMoneyDue(this.prisma, fx) },
          ...(mine && { inquiry: { assigneeId: user.id } }),
        },
        select: {
          id: true,
          refNo: true,
          currency: true,
          mainCurrency: true,
          mainRate: true,
          depositPercent: true,
          total: true,
          expenses: chargedExpenses,
          customer: { select: { id: true, name: true } },
          inquiry: { select: { assignee: person } },
          allocations: { where: livePart, select: { amount: true, bankCharges: true } },
          receivables: { orderBy: { sortOrder: "asc" }, select: { amount: true, part: true } },
        },
      });
      const plans = await livePlansOf(
        this.prisma.db,
        orders.map((o) => o.id),
      );
      const requests = await requestsOf(
        this.prisma.db,
        orders.map((o) => o.id),
        this.clock.timeZone,
      );
      for (const o of orders) {
        const pos = positionOf(o, fx);
        const plan = planStatus(plans.get(o.id)?.items ?? [], pos.settledMinor, today, s.reminders.dueSoonDays);
        // What is due beyond the open instalments (expenses charged to the customer, or a total that grew after the
        // plan was made): listed too, without a number, so the list adds up to what the customer owes.
        const rest = pos.dueMinor - plan.reduce((t, i) => t + i.openMinor, 0);
        if (rest > 0)
          rows.push({
            id: null,
            number: null,
            label: pos.chargedMinor > 0 ? "Charged to the customer, not on a payment request yet" : "Not on a payment request yet",
            order: { id: o.id, refNo: o.refNo },
            party: o.customer,
            lookedAfterBy: o.inquiry.assignee,
            currency: o.currency,
            amount: fromMinor(rest),
            paid: fromMinor(0),
            open: fromMinor(rest),
            dueOn: null,
            late: 0,
            soon: false,
            request: null,
          });
        for (const i of plan) {
          if (i.openMinor <= 0) continue;
          const r = requestViewOf(i, requests.get(o.id));
          rows.push({
            id: i.id,
            number: paperNumber(o.refNo, "payment-request", i.requestNo),
            label: i.label,
            order: { id: o.id, refNo: o.refNo },
            party: o.customer,
            lookedAfterBy: o.inquiry.assignee,
            currency: o.currency,
            amount: fromMinor(i.amountMinor),
            paid: fromMinor(i.paidMinor),
            open: fromMinor(i.openMinor),
            dueOn: i.dueOn,
            late: lateDays(i.dueOn, today),
            soon: i.status === "due_soon",
            request: { state: r.state, with: r.with, sentOn: r.sentOn, revision: r.revision, changed: r.changed, through: r.through },
          });
        }
      }
    } else {
      if (!can(user, "sourcing.manage")) throw new ForbiddenError("You cannot see factory costs.");
      const orders = await this.prisma.db.order.findMany({
        where: { status: { not: "cancelled" }, id: { in: await ordersOwingFactories(this.prisma, fx) } },
        select: { id: true, refNo: true, lines: { select: { factory: { select: { id: true, owner: person } } } } },
      });
      for (const o of orders) {
        const owners = new Map(o.lines.flatMap((l) => (l.factory ? [[l.factory.id, l.factory.owner] as const] : [])));
        for (const f of await factoryPlansOf(this.prisma.db, o.id, s.sales.factoryAdvancePercent, today, s.reminders.dueSoonDays, fx)) {
          const owner = owners.get(f.factory.id) ?? null;
          if (mine && owner?.id !== user.id) continue;
          for (const r of f.rows) {
            if (Number(r.open) <= 0) continue;
            rows.push({
              id: r.id,
              number: r.supplierRef,
              label: r.label,
              order: { id: o.id, refNo: o.refNo },
              party: f.factory,
              lookedAfterBy: owner,
              currency: f.currency,
              amount: r.amount,
              paid: r.paid,
              open: r.open,
              dueOn: r.due,
              late: lateDays(r.due, today),
              soon: r.status === "due",
              request: null,
            });
          }
        }
      }
    }
    rows.sort(
      (a, b) => b.late - a.late || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.order.refNo.localeCompare(b.order.refNo),
    );
    const totals = new Map<string, { open: Minor; late: Minor; count: number }>();
    for (const r of rows) {
      const t = totals.get(r.currency) ?? { open: 0, late: 0, count: 0 };
      t.open += toMinor(r.open);
      if (r.late > 0) t.late += toMinor(r.open);
      t.count += 1;
      totals.set(r.currency, t);
    }
    return {
      side,
      rows,
      totals: [...totals.entries()].map(([currency, t]) => ({
        currency,
        open: fromMinor(t.open),
        late: fromMinor(t.late),
        count: t.count,
      })),
    };
  }
}

/** Days past its due date (0: not late, or no date yet). */
const lateDays = (dueOn: ISODate | null, today: ISODate) => (dueOn && dueOn < today ? daysBetween(dueOn, today) : 0);

/** One open invoice in the Receivables or Payables list. */
interface OpenInvoice {
  /** The invoice (null: a supplier's default plan not saved yet, or what is due beyond the customer's instalments). */
  id: string | null;
  /** The payment request's number (PR-2026-0031-2), or the supplier's own number if known. */
  number: string | null;
  label: string;
  order: { id: string; refNo: string };
  party: { id: string; name: string };
  lookedAfterBy: { id: string; name: string } | null;
  currency: string;
  amount: string;
  paid: string;
  open: string;
  dueOn: ISODate | null;
  /** Days late (0: not late). */
  late: number;
  /** Falls due within the reminder window. */
  soon: boolean;
  /** A customer's instalment as a payment request: not sent, sent (how, when, which revision), part paid. Null: a supplier's, or not on a request. */
  request: { state: RequestState; with: "request" | "proforma" | "bank" | null; sentOn: ISODate | null; revision: number | null; changed: boolean; through: "customer" | "bank" } | null;
}
