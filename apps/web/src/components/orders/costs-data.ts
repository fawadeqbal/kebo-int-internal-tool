import "server-only";
import { cache } from "react";
import { can } from "@kebo/shared";
import { requireUser } from "@/lib/session";
import { orderCostsOf, orderMoneyOf, orderOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import type { CostSetup } from "@/components/money/cost-window";
import { today } from "./today";
import { getSettings, getPeople } from "@/lib/loaders";

/**
 * The order's costs and what its cost window needs, for managers with the
 * expenses feature; null for everyone else (no Costs page, no costs cards).
 */
export const orderCostsSetup = cache(async (id: string) => {
  const me = await requireUser();
  if (!can(me, "expenses.manage")) return null;
  const costs = await optional(() => orderCostsOf(id));
  if (!costs) return null;
  const [settings, people, m, o] = await Promise.all([getSettings(), optional(getPeople), optional(() => orderMoneyOf(id)), optional(() => orderOf(id))]);
  const factories = new Map<string, string>();
  for (const r of m?.factories?.rows ?? []) factories.set(r.factory.id, r.factory.name);
  const setup: CostSetup = {
    mainCurrency: settings.sales.currency,
    fx: { main: settings.sales.currency, rates: settings.sales.exchangeRates },
    today: today(),
    people: (people ?? []).map((p) => ({ id: p.id, name: p.name })),
    for: { place: "order", id, customerId: o?.customer.id ?? null, label: `Order ${costs.refNo}${o ? ` · ${o.customer.name}` : ""}` },
    order: { currency: costs.currency, factories: [...factories].map(([fid, name]) => ({ id: fid, name })) },
  };
  return { costs, setup, canEdit: costs.canEdit, money: m };
});
