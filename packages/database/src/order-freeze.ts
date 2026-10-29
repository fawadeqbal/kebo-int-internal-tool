import type { Db } from "./client";

/**
 * For orders made outside the API (the demo seed, data loads, the old app's
 * import): copy onto them what the API freezes when a quotation is accepted —
 * the factory price, tax and currency of each line, the costs to reach the
 * basis it was sold on (from its option), and its main currency and rate.
 * Only fills what is still empty; the same as the money migration does for
 * orders made before it.
 */
export async function freezeOrderMoney(db: Db, orderIds: string[]): Promise<void> {
  if (!orderIds.length) return;
  await db.$executeRaw`
    update order_lines ol
       set factory_id = fq.factory_id, factory_unit_price = fql.unit_price, factory_tax_rate = fql.tax_rate, factory_currency = fq.currency
      from quote_lines ql
      join factory_quote_lines fql on fql.id = ql.factory_quote_line_id
      join factory_quotes fq on fq.id = fql.factory_quote_id
     where ql.id = ol.quote_line_id and ol.factory_unit_price is null and ol.order_id = any(${orderIds}::uuid[])`;
  await db.$executeRaw`
    insert into order_costs (id, company_id, order_id, step, amount, currency, cost, fx_rate, note)
    select gen_random_uuid(), oc.company_id, x.order_id, oc.step, oc.amount, oc.currency, oc.cost, oc.fx_rate, oc.note
      from (select ol.order_id, min(ql.option_id::text)::uuid as option_id
              from order_lines ol join quote_lines ql on ql.id = ol.quote_line_id
             where ol.order_id = any(${orderIds}::uuid[])
             group by ol.order_id having count(distinct ql.option_id) = 1) x
      join option_costs oc on oc.option_id = x.option_id
     where oc.cost > 0
    on conflict (order_id, step) do nothing`;
  await db.$executeRaw`
    update orders o
       set main_currency = s.main,
           main_rate = case when o.currency = s.main then 1
                            when jsonb_typeof(s.rates -> o.currency) = 'number' and (s.rates ->> o.currency)::numeric > 0
                              then round((s.rates ->> o.currency)::numeric, 14) end
      from (select upper(coalesce((select value ->> 'currency' from settings where key = 'sales'), 'USD')) as main,
                   coalesce((select case when jsonb_typeof(value -> 'exchangeRates') = 'object' then value -> 'exchangeRates' end
                               from settings where key = 'sales'), '{"CNY": 7.1}'::jsonb) as rates) s
     where o.main_currency is null and o.id = any(${orderIds}::uuid[])`;
}
