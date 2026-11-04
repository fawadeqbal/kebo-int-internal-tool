import { Injectable } from "@nestjs/common";
import { fromDbDate } from "@kebo/database";
import { fromMinor, toMinor } from "@kebo/money";
import { NotFoundError } from "@kebo/utils";
import { PrismaService } from "../../database/prisma.service";
import { Clock } from "../../common/time/clock.service";
import { LimitsService } from "../../common/company/limits.service";
import type { SessionUser } from "../../common/auth/session-user";
import { SettingsService } from "../settings/settings.service";
import { factsCtxOf, orderFactsOf } from "../insights/facts/compute";
import { factoryPlansOf } from "../money/factory-plan";
import { orderAccess } from "../orders/orders.service";

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/**
 * A factory's purchase orders (our orders to it, one per sales order with its lines), each with what we owe it,
 * paid and the balance due, worked out live with the same functions as Insights' factory rows (orderFactsOf),
 * its production state, and the instalments still open. With every payment made to it, and how often it was
 * ready on time. Only the sales orders the person may see.
 */
@Injectable()
export class FactoryPurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly limits: LimitsService,
    private readonly settings: SettingsService,
  ) {}

  async purchases(user: SessionUser, factoryId: string) {
    const db = this.prisma.db;
    const factory = await db.factory.findFirst({ where: { id: factoryId, deletedAt: null }, select: { id: true } });
    if (!factory) throw new NotFoundError("Factory");
    const today = this.clock.today();
    const orders = await db.order.findMany({
      where: { lines: { some: { factoryId } }, ...orderAccess(user) },
      select: { id: true, refNo: true, stage: true, status: true, customer: { select: { id: true, name: true } } },
      orderBy: [{ orderedOn: "desc" }, { refNo: "desc" }],
      take: 200,
    });
    const ids = orders.map((o) => o.id);
    const ctx = await factsCtxOf(db, this.clock.timeZone, today, await this.limits.allows("expenses"));
    const [facts, lateItems, payments, waiting] = await Promise.all([
      orderFactsOf(db, ids, ctx),
      db.orderChecklistItem.findMany({
        where: { orderId: { in: ids }, factoryId, step: "production", doneAt: null, skippedAt: null, dueOn: { lt: new Date(`${today}T00:00:00Z`) }, order: { status: "open" } },
        select: { orderId: true, title: true, key: true, dueOn: true },
        orderBy: { dueOn: "asc" },
      }),
      db.factoryPayment.findMany({
        where: { factoryId, orderId: { in: ids } },
        select: { id: true, orderId: true, kind: true, amount: true, currency: true, paidOn: true, method: true, reference: true, voidedAt: true, fileKey: true },
        orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }],
      }),
      // Quote requests it has not answered yet, on inquiries still looking for prices.
      db.factoryRequest.findMany({
        where: { factoryId, status: "sent", factoryQuoteId: null, inquiry: { deletedAt: null, stage: { in: ["new", "sourcing", "quoted"] } } },
        select: { id: true, sentOn: true, replyBy: true, inquiry: { select: { id: true, refNo: true, title: true } } },
        orderBy: { sentOn: "asc" },
      }),
    ]);
    const soon = (await this.settings.get()).reminders.dueSoonDays;
    const rowOf = new Map(facts.factories.filter((r) => r.factory_id === factoryId).map((r) => [String(r.order_id), r]));
    const out = [];
    for (const o of orders) {
      const r = rowOf.get(o.id);
      if (!r) continue;
      const late = lateItems.filter((i) => i.orderId === o.id);
      const toPay = toMinor(String(r.to_pay_main));
      // The instalments still open, with their names and due dates (only where something is still to pay).
      const plans = o.status !== "cancelled" && toPay > 0 ? (await factoryPlansOf(db, o.id, ctx.factoryAdvancePercent, today, soon, ctx.fx)).filter((p) => p.factory.id === factoryId) : [];
      const open = plans.flatMap((p) =>
        p.rows.filter((x) => toMinor(x.open) > 0).map((x) => ({ label: x.label, due: x.due, open: x.open, currency: p.currency, status: x.status })),
      );
      const readyOn = str(r.ready_promised);
      const readyActual = str(r.ready_actual);
      const production =
        o.status === "cancelled"
          ? "cancelled"
          : readyActual
            ? "delivered"
            : late.length
              ? "overdue_step"
              : readyOn && readyOn <= today
                ? "ready"
                : "on_track";
      out.push({
        id: o.id,
        refNo: o.refNo,
        customer: o.customer,
        stage: o.stage,
        status: o.status,
        orderedOn: String(r.ordered_on),
        production,
        readyOn,
        readyActual,
        onTime: r.on_time as boolean | null,
        daysLate: r.days_late as number | null,
        /** In the factory's currency; null when the order owes it in more than one (then only the main figures). */
        currency: str(r.currency),
        total: str(r.owed),
        paid: str(r.paid),
        balanceDue: str(r.to_pay),
        mainCurrency: String(r.main_currency),
        totalMain: String(r.owed_main),
        paidMain: String(r.paid_main),
        balanceDueMain: String(r.to_pay_main),
        lateSteps: late.map((i) => ({ title: i.title ?? i.key ?? "Production step", dueOn: i.dueOn ? fromDbDate(i.dueOn) : null })),
        open,
      });
    }
    const known = out.filter((o) => o.onTime !== null);
    const lateOnes = known.filter((o) => o.onTime === false && o.daysLate !== null);
    const refOf = new Map(orders.map((o) => [o.id, o.refNo]));
    return {
      today,
      mainCurrency: ctx.fx.main,
      orders: out,
      payments: payments.map((p) => ({
        id: p.id,
        order: { id: p.orderId, refNo: refOf.get(p.orderId)! },
        kind: p.kind,
        amount: p.amount.toFixed(2),
        currency: p.currency,
        paidOn: fromDbDate(p.paidOn),
        method: p.method,
        reference: p.reference,
        voided: !!p.voidedAt,
        hasFile: !!p.fileKey,
      })),
      readiness: {
        onTime: known.filter((o) => o.onTime).length,
        known: known.length,
        avgDaysLate: lateOnes.length ? Math.round((lateOnes.reduce((t, o) => t + (o.daysLate ?? 0), 0) / lateOnes.length) * 10) / 10 : null,
      },
      totals: totalsOf(out),
      waiting: waiting.map((w) => ({ id: w.id, inquiry: w.inquiry, sentOn: fromDbDate(w.sentOn), replyBy: w.replyBy ? fromDbDate(w.replyBy) : null })),
    };
  }
}

/** Total, paid and balance due per currency (orders not cancelled). */
function totalsOf(rows: { status: string; currency: string | null; mainCurrency: string; total: string | null; paid: string | null; balanceDue: string | null; totalMain: string; paidMain: string; balanceDueMain: string }[]) {
  const by = new Map<string, { total: number; paid: number; balanceDue: number; orders: number }>();
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    const own = r.currency !== null;
    const cur = own ? r.currency! : r.mainCurrency;
    const t = by.get(cur) ?? { total: 0, paid: 0, balanceDue: 0, orders: 0 };
    t.total += toMinor(own ? r.total! : r.totalMain);
    t.paid += toMinor(own ? r.paid! : r.paidMain);
    t.balanceDue += toMinor(own ? r.balanceDue! : r.balanceDueMain);
    t.orders += 1;
    by.set(cur, t);
  }
  return [...by.entries()].map(([currency, t]) => ({ currency, orders: t.orders, total: fromMinor(t.total), paid: fromMinor(t.paid), balanceDue: fromMinor(t.balanceDue) }));
}
