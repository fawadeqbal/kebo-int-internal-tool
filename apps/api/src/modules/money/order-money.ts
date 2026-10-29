import type { PrismaClient } from "@kebo/database";
import { fxRate, orderCosting, roundHalfAway, toMinor, type Minor, type Rates } from "@kebo/money";
import { BASIS_COST_CATEGORIES } from "@kebo/shared";
import type { Tx } from "../../database/prisma.service";

/**
 * The one way an order's money is read on every screen (order page, profit &
 * loss, Insights, reports, where we lose money, the customer's account):
 * - its own rate to the main currency, stored when it was made, so changing the
 *   rates in Settings never moves past months (Settings only for old orders without one);
 * - profit only from the revenue that has a cost; the rest is shown apart;
 * - the costs to reach the basis it was sold on (freight…) as part of its cost;
 * - freight, transport and customs paid later pay for those planned costs first,
 *   so they are not counted twice.
 */

type Db = PrismaClient | Tx;
type Decimalish = { toString(): string } | number | string | null;

/** Amount ÷ rate (units of its currency per one unit of the target), rounded to cents. */
export const convert = (minor: Minor, rate: number) => roundHalfAway(minor / rate);

/** The order fields its rate needs. */
export interface RatedOrder {
  currency: string;
  mainCurrency: string | null;
  mainRate: Decimalish;
}

/**
 * Units of the order's currency per one unit of the main currency: the rate
 * stored on the order, else today's Settings rate; null when neither is known.
 */
export function orderRate(o: RatedOrder, main: string, rates: Rates): number | null {
  if (o.currency === main) return 1;
  if (o.mainRate !== null && o.mainCurrency === main && Number(o.mainRate) > 0) return Number(o.mainRate);
  return fxRate(o.currency, main, main, rates);
}

/** Turns amounts into the main currency and remembers the currencies without a rate (never silently 0). */
export class MainMoney {
  readonly missing = new Set<string>();
  constructor(
    readonly main: string,
    private readonly rates: Rates,
  ) {}

  /** At today's Settings rate (quotations, targets, account balances: things that have no rate of their own). */
  live(minor: Minor, currency: string): Minor {
    const r = fxRate(currency, this.main, this.main, this.rates);
    if (r === null) {
      this.missing.add(currency);
      return 0;
    }
    return convert(minor, r);
  }

  /** An amount in an order's currency, at the order's own rate. */
  order(minor: Minor, o: RatedOrder): Minor {
    const r = orderRate(o, this.main, this.rates);
    if (r === null) {
      this.missing.add(o.currency);
      return 0;
    }
    return convert(minor, r);
  }

  /** Whether an order's amounts can be turned into the main currency. */
  known(o: RatedOrder) {
    return orderRate(o, this.main, this.rates) !== null;
  }

  get missingRates() {
    return [...this.missing];
  }
}

export type OrderCosting = ReturnType<typeof orderCosting>;

/**
 * Each order's costing in its own currency (lines with and without a cost, the
 * discount spread over them, the costs to reach the basis it was sold on),
 * read straight from the database for many orders at once.
 */
export async function costingsOf(db: Db, orders: { id: string; totalMinor: Minor }[]): Promise<Map<string, OrderCosting>> {
  const out = new Map<string, OrderCosting>();
  if (!orders.length) return out;
  const ids = orders.map((o) => o.id);
  const [lines, costs] = await Promise.all([
    db.$queryRaw<{ orderId: string; lineTotal: string; quantity: string; unitCost: string | null }[]>`
      select order_id as "orderId", line_total::text as "lineTotal", quantity::text as quantity, unit_cost::text as "unitCost"
      from order_lines where order_id = any(${ids}::uuid[]) order by order_id, sort_order, id`,
    db.$queryRaw<{ orderId: string; cost: string }[]>`
      select order_id as "orderId", sum(cost)::text as cost from order_costs where order_id = any(${ids}::uuid[]) group by 1`,
  ]);
  const byOrder = new Map<string, typeof lines>();
  for (const l of lines) byOrder.set(l.orderId, [...(byOrder.get(l.orderId) ?? []), l]);
  const basis = new Map(costs.map((c) => [c.orderId, toMinor(c.cost)]));
  for (const o of orders)
    out.set(
      o.id,
      orderCosting(
        (byOrder.get(o.id) ?? []).map((l) => ({
          lineTotalMinor: toMinor(l.lineTotal),
          quantity: l.quantity,
          unitCostMinor: l.unitCost === null ? null : toMinor(l.unitCost),
        })),
        o.totalMinor,
        basis.get(o.id) ?? 0,
      ),
    );
  return out;
}

/** The planned costs to reach the basis (in the main currency) of orders that are not cancelled. */
export async function basisOfOrders(db: Db, ids: string[], money: MainMoney): Promise<Map<string, Minor>> {
  const out = new Map<string, Minor>();
  if (!ids.length) return out;
  const rows = await db.$queryRaw<{ id: string; currency: string; mainCurrency: string | null; mainRate: string | null; cost: string }[]>`
    select o.id, o.currency, o.main_currency as "mainCurrency", o.main_rate::text as "mainRate", sum(c.cost)::text as cost
    from orders o join order_costs c on c.order_id = o.id
    where o.id = any(${[...new Set(ids)]}::uuid[]) and o.status <> 'cancelled'
    group by o.id`;
  for (const r of rows) out.set(r.id, money.order(toMinor(r.cost), r));
  return out;
}

/** An expense as `countedExpenses` reads it. */
export interface CountableExpense {
  id: string;
  orderId: string | null;
  category: string;
  /** In the main currency. */
  mainMinor: Minor;
  spentOn: string;
}

const PAYS_BASIS = new Set<string>(BASIS_COST_CATEGORIES);

/**
 * How much of each expense counts as a cost of its own. On an order with
 * planned costs to reach its basis (`basisByOrder`, main currency), freight,
 * transport and customs pay for those first, oldest first: that part is
 * already in the order's cost. Everything else counts in full.
 */
export function countedExpenses<T extends CountableExpense>(expenses: T[], basisByOrder: Map<string, Minor>): Map<string, Minor> {
  const left = new Map(basisByOrder);
  const out = new Map<string, Minor>();
  const sorted = [...expenses].sort((a, b) => a.spentOn.localeCompare(b.spentOn) || a.id.localeCompare(b.id));
  for (const e of sorted) {
    const room = e.orderId && PAYS_BASIS.has(e.category) ? Math.max(left.get(e.orderId) ?? 0, 0) : 0;
    const covered = Math.min(room, Math.max(e.mainMinor, 0));
    if (covered) left.set(e.orderId!, room - covered);
    out.set(e.id, e.mainMinor - covered);
  }
  return out;
}

/** The order's expenses that pay for the planned basis costs (freight, transport, customs). */
export const paysBasis = (category: string) => PAYS_BASIS.has(category);
