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
 * Orders where we still owe a factory: what the factory lines cost (with tax,
 * in the factory's currency) against what we paid that factory in that
 * currency. The arithmetic is the app's own (owedByFactory with withTaxMinor
 * and roundHalfAway), in double precision like JavaScript, so it agrees to the
 * cent: exact decimals would round some half cents the other way and keep
 * nearly every paid order.
 */
export async function ordersOwingFactories(prisma: PrismaService): Promise<string[]> {
  const rows = await prisma.db.$queryRaw<{ id: string }[]>`
    with owed as (
      select ol.order_id, fq.factory_id, fq.currency,
             sum(floor(u.unit * ol.quantity::float8 + 0.5)) as owed
      from order_lines ol
      join orders o on o.id = ol.order_id and o.status <> 'cancelled'
      join quote_lines ql on ql.id = ol.quote_line_id
      join factory_quote_lines fql on fql.id = ql.factory_quote_line_id
      join factory_quotes fq on fq.id = fql.factory_quote_id
      cross join lateral (select floor((fql.unit_price * 100)::float8 * (1 + greatest(fql.tax_rate, 0)::float8 / 100) + 0.5) as unit) u
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
