import { Prisma } from "@kebo/database";
import type { PrismaService } from "../../database/prisma.service";

/**
 * Orders with money still to come in from the customer: the order total less
 * what was received in its currency (amount plus bank charges). Done in the
 * database so the screens that list what is owed read only those orders, not
 * every order there ever was. The exact figure is still worked out in code
 * (settle); this only narrows which orders to read.
 */
export async function ordersWithMoneyDue(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.db.$queryRaw<{ id: string }[]>`
    select o.id
    from orders o
    left join payments p on p.order_id = o.id and p.voided_at is null and p.currency = o.currency
    where o.status <> 'cancelled'
    group by o.id, o.total
    having o.total - coalesce(sum(p.amount + p.bank_charges), 0) > 0`;
  return rows.map((r) => r.id);
}

/**
 * What one order line owes its factory, in minor units of the factory's
 * currency: its frozen price with tax on top, rounded to the cent, times the
 * quantity, rounded again. Exact numeric arithmetic and round() (half away from
 * zero), the same as withTaxMinor and multiplyMinor in @kebo/money, so the
 * database and the app agree to the cent.
 */
export const owedLineSql = (price: Prisma.Sql, tax: Prisma.Sql, quantity: Prisma.Sql) =>
  Prisma.sql`round(round(${price} * (100 + greatest(${tax}, 0))) * ${quantity})`;

/**
 * Orders where we still owe a factory: what the factory lines cost (their
 * prices frozen on the order, with tax, in the factory's currency) against
 * what we paid that factory in that currency.
 */
export async function ordersOwingFactories(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.db.$queryRaw<{ id: string }[]>`
    with owed as (
      select ol.order_id, ol.factory_id, ol.factory_currency as currency,
             sum(${owedLineSql(Prisma.sql`ol.factory_unit_price`, Prisma.sql`ol.factory_tax_rate`, Prisma.sql`ol.quantity`)}) as owed
      from order_lines ol
      join orders o on o.id = ol.order_id and o.status <> 'cancelled'
      where ol.factory_id is not null and ol.factory_unit_price is not null
      group by 1, 2, 3
    ),
    paid as (
      select order_id, factory_id, currency, sum(amount * 100) as paid
      from factory_payments
      where voided_at is null
      group by 1, 2, 3
    )
    select distinct owed.order_id as id
    from owed
    left join paid on paid.order_id = owed.order_id and paid.factory_id = owed.factory_id and paid.currency = owed.currency
    where owed.owed - coalesce(paid.paid, 0) > 0`;
  return rows.map((r) => r.id);
}
