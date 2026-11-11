import { Prisma } from "@kebo/database";
import type { MoneyCtx } from "./position";
import type { PrismaService, Tx } from "../../database/prisma.service";

type Db = PrismaService["db"] | Tx;

/*
 * The money rules of position.ts (orderPosition, factoryPosition) said in SQL,
 * so the screens that list what is owed read only those orders, not every
 * order there ever was. The figures agree with the TypeScript to the cent
 * (test/single-truth.test.ts checks it): exact numeric arithmetic and round()
 * (half away from zero) at the same steps as multiplyMinor / divideMinor.
 */

/** Units of the order's currency per one unit of the main currency, as orderRate: 1, the order's own rate, else Settings'. */
const orderPerMainSql = (fx: MoneyCtx) =>
  Prisma.sql`(case when o.currency = ${fx.main} then 1::numeric
                   when o.main_currency = ${fx.main} and o.main_rate > 0 then o.main_rate
                   else nullif((${JSON.stringify(fx.rates)}::jsonb ->> o.currency::text)::numeric, 0) end)`;

/**
 * An expense in the currency `to` (minor units): its own amount when it is in
 * that currency, else at its own rate into the main currency and at `perMain`
 * on (null without a rate), as expenseIn.
 */
const expenseInSql = (to: Prisma.Sql, perMain: Prisma.Sql) =>
  Prisma.sql`(case when e.currency = ${to} then round(e.amount * 100) else round(round(e.amount * 100 / e.rate) * ${perMain}) end)`;

/** Expenses charged to the customer on order `o`, in its currency (minor units); none without the expenses module. */
const chargedSql = (fx: MoneyCtx) =>
  !fx.expensesOn
    ? Prisma.sql`0`
    : Prisma.sql`coalesce((select sum(${expenseInSql(Prisma.sql`o.currency`, orderPerMainSql(fx))})
                       from expenses e where e.order_id = o.id and e.voided_at is null and e.borne_by = 'customer'), 0)`;

/** What came in on order `o` in its currency, with the bank charges (minor units). */
const settledSql = Prisma.sql`coalesce((select sum((p.amount + p.bank_charges) * 100) from allocations p
                                         where p.order_id = o.id and p.target = 'order' and p.voided_at is null), 0)`;

export interface PositionRow {
  id: string;
  totalMinor: number;
  chargedMinor: number;
  settledMinor: number;
  /** total + charged − settled, never below 0. */
  dueMinor: number;
}

/** Each order's total, charged, settled and due, worked out in the database (cancelled orders left out). */
export async function positionsSql(db: Db, fx: MoneyCtx, ids?: string[]): Promise<PositionRow[]> {
  return db.$queryRaw<PositionRow[]>`
    select id, "totalMinor", "chargedMinor", "settledMinor", greatest("totalMinor" + "chargedMinor" - "settledMinor", 0) as "dueMinor"
    from (
      select o.id, (o.total * 100)::float8 as "totalMinor", ${chargedSql(fx)}::float8 as "chargedMinor", ${settledSql}::float8 as "settledMinor"
      from orders o
      where o.status <> 'cancelled' ${ids ? Prisma.sql`and o.id = any(${ids}::uuid[])` : Prisma.empty}
    ) x`;
}

/**
 * Orders with money still to come in from the customer: the order total and
 * what was charged to them, less what was received in its currency (amount
 * plus bank charges).
 */
export async function ordersWithMoneyDue(prisma: PrismaService, fx: MoneyCtx): Promise<string[]> {
  return (await positionsSql(prisma.db, fx)).filter((r) => r.dueMinor > 0).map((r) => r.id);
}

/**
 * What one order line owes its factory, in minor units of the factory's
 * currency: its frozen price with tax on top (or as it is, when the price had
 * the tax included), rounded to the cent, times the quantity, rounded again.
 * Exact numeric arithmetic and round() (half away from zero), the same as
 * factoryUnitCostMinor and multiplyMinor in @kebo/money, so the database and
 * the app agree to the cent.
 */
export const owedLineSql = (price: Prisma.Sql, tax: Prisma.Sql, included: Prisma.Sql, quantity: Prisma.Sql) =>
  Prisma.sql`round(round(${price} * (case when ${included} then 100 else 100 + greatest(coalesce(${tax}, 0), 0) end)) * ${quantity})`;

export interface FactoryPositionRow {
  orderId: string;
  factoryId: string;
  currency: string;
  owedMinor: number;
  paidMinor: number;
  takenOffMinor: number;
  toPayMinor: number;
}

/**
 * What we owe each factory on each order (not cancelled), as factoryPosition:
 * its lines' prices with tax, less what we paid it in that currency and the
 * expenses it bears (in the expense's currency when it owes in it, else its
 * first currency A→Z, turned at the expense's rate and the Settings rate).
 */
export async function factoryPositionsSql(db: Db, fx: MoneyCtx, orderIds?: string[]): Promise<FactoryPositionRow[]> {
  const perMain = Prisma.sql`(case when t.currency = ${fx.main} then 1::numeric else nullif((${JSON.stringify(fx.rates)}::jsonb ->> t.currency::text)::numeric, 0) end)`;
  return db.$queryRaw<FactoryPositionRow[]>`
    with owed as (
      select ol.order_id, ol.factory_id, ol.factory_currency as currency,
             sum(${owedLineSql(Prisma.sql`ol.factory_unit_price`, Prisma.sql`ol.factory_tax_rate`, Prisma.sql`ol.factory_tax_included`, Prisma.sql`ol.quantity`)}) as owed
      from order_lines ol
      join orders o on o.id = ol.order_id and o.status <> 'cancelled'
      where ol.factory_id is not null and ol.factory_unit_price is not null and ol.factory_currency is not null
        ${orderIds ? Prisma.sql`and ol.order_id = any(${orderIds}::uuid[])` : Prisma.empty}
      group by 1, 2, 3
    ),
    paid as (
      select order_id, factory_id, currency, sum(amount * 100) as paid
      from factory_payments
      where voided_at is null
      group by 1, 2, 3
    ),
    target as (
      select e.order_id, e.factory_id, e.currency as from_currency, e.amount, e.rate,
             coalesce(
               (select w.currency from owed w where w.order_id = e.order_id and w.factory_id = e.factory_id and w.currency = e.currency),
               (select min(w.currency) from owed w where w.order_id = e.order_id and w.factory_id = e.factory_id)
             ) as currency
      from expenses e
      where e.voided_at is null and e.borne_by = 'factory' and e.factory_id is not null and e.order_id is not null and ${fx.expensesOn}
    ),
    taken as (
      select t.order_id, t.factory_id, t.currency,
             sum(case when t.from_currency = t.currency then round(t.amount * 100) else round(round(t.amount * 100 / t.rate) * ${perMain}) end) as taken
      from target t
      where t.currency is not null
      group by 1, 2, 3
    )
    select owed.order_id as "orderId", owed.factory_id as "factoryId", owed.currency::text as currency,
           owed.owed::float8 as "owedMinor", coalesce(paid.paid, 0)::float8 as "paidMinor", coalesce(taken.taken, 0)::float8 as "takenOffMinor",
           greatest(owed.owed - coalesce(paid.paid, 0) - coalesce(taken.taken, 0), 0)::float8 as "toPayMinor"
    from owed
    left join paid on paid.order_id = owed.order_id and paid.factory_id = owed.factory_id and paid.currency = owed.currency
    left join taken on taken.order_id = owed.order_id and taken.factory_id = owed.factory_id and taken.currency = owed.currency`;
}

/**
 * Orders where we still owe a factory: what the factory lines cost (their
 * prices frozen on the order, with tax, in the factory's currency) against
 * what we paid that factory in that currency and the expenses it bears.
 */
export async function ordersOwingFactories(prisma: PrismaService, fx: MoneyCtx): Promise<string[]> {
  return [...new Set((await factoryPositionsSql(prisma.db, fx)).filter((r) => r.toPayMinor > 0).map((r) => r.orderId))];
}
