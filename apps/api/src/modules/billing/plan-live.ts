import { decimalToMinor, fromDbDateOrNull, type Prisma, termsSelect } from "@kebo/database";
import { livePlan, shippedOnOf, type PlanDates } from "@kebo/shared";
import type { PrismaService, Tx } from "../../database/prisma.service";
import { readyOnOf, readySelect } from "@kebo/database";
import { termsOf } from "./route-plan";

type Db = PrismaService["db"] | Tx;

/**
 * Single source of truth, PR 4: the customer's plan follows the dates. Each instalment's date is worked out
 * from its rule and the order's dates as they are now (the ready date: the latest factory's; shipped on: the
 * earliest departure; the day the papers reached the customer's bank), and each part is named from its
 * amount. Every screen, paper and reminder reads the plan through here; nothing re-dates stored rows.
 */

/** What an order's plan dates are worked out from. */
export const planDatesSelect = {
  ...readySelect,
  shipments: { select: { departedOn: true } },
  bankSteps: { where: { step: "customer_bank_received" }, select: { doneOn: true }, orderBy: { doneOn: "asc" } },
} satisfies Prisma.OrderSelect;

type DatesOrder = {
  factories: { factoryId: string | null; readyOn: Date | null }[];
  lines: { factoryId: string | null }[];
  shipments: { departedOn: Date | null }[];
  bankSteps: { doneOn: Date }[];
};

/** The order's dates the plan's rules read. */
export function planDatesOf(o: DatesOrder): PlanDates {
  return {
    readyOn: readyOnOf(o),
    shippedOn: shippedOnOf(o.shipments.map((s) => ({ departedOn: fromDbDateOrNull(s.departedOn) }))),
    papersOn: fromDbDateOrNull(o.bankSteps[0]?.doneOn ?? null),
  };
}

const liveSelect = {
  id: true,
  total: true,
  ...termsSelect,
  receivables: { orderBy: { sortOrder: "asc" } },
  lines: { select: { factoryId: true } },
  ...planDatesSelect,
} satisfies Prisma.OrderSelect;

type LiveOrder = Prisma.OrderGetPayload<{ select: typeof liveSelect }>;

/** One order's plan as it stands now (live dates and names). */
export function livePlanOfOrder(o: LiveOrder) {
  const dates = planDatesOf(o);
  return {
    dates,
    items: livePlan(
      o.receivables.map((p) => ({
        id: p.id,
        label: p.label,
        amountMinor: decimalToMinor(p.amount),
        dueOn: fromDbDateOrNull(p.dueOn),
        part: p.part,
        dueRule: p.dueRule,
        dueDays: p.dueDays,
        requestNo: p.requestNo,
      })),
      decimalToMinor(o.total),
      termsOf(o),
      dates,
    ),
  };
}

export type LiveItem = ReturnType<typeof livePlanOfOrder>["items"][number];

/** The plans of several orders, live, by order id. */
export async function livePlansOf(db: Db, orderIds: string[]) {
  if (!orderIds.length) return new Map<string, ReturnType<typeof livePlanOfOrder>>();
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, select: liveSelect });
  return new Map(orders.map((o) => [o.id, livePlanOfOrder(o)]));
}

/** One order's plan, live. */
export async function livePlanOf(db: Db, orderId: string) {
  return (await livePlansOf(db, [orderId])).get(orderId) ?? { dates: { readyOn: null, shippedOn: null, papersOn: null }, items: [] };
}
