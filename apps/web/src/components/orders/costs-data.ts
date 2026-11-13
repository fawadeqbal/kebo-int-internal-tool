import "server-only";
import { cache } from "react";
import { can, FLOW_STEPS, ORDER_TAB_LABEL } from "@kebo/shared";
import { requireUser } from "@/lib/session";
import { orderCostsOf, orderMoneyOf, orderSectionsOf } from "@/lib/order-data";
import { optional } from "@/components/print/data";
import { today } from "./today";
import type { ExpenseSetup } from "./expense-form";
import { getSettings, getPeople } from "@/lib/loaders";

/**
 * The order's costs and what its expense form needs, for managers with the
 * expenses feature; null for everyone else (no Costs page, no costs cards).
 */
export const orderCostsSetup = cache(async (id: string) => {
  const me = await requireUser();
  if (!can(me, "expenses.manage")) return null;
  const costs = await optional(() => orderCostsOf(id));
  if (!costs) return null;
  const [settings, people, sections, m] = await Promise.all([
    getSettings(),
    optional(getPeople),
    optional(() => orderSectionsOf(id)),
    optional(() => orderMoneyOf(id)),
  ]);
  const factories = new Map<string, string>();
  for (const r of m?.factories?.rows ?? []) factories.set(r.factory.id, r.factory.name);
  const setup: ExpenseSetup = {
    orderId: id,
    refNo: costs.refNo,
    orderCurrency: costs.currency,
    mainCurrency: settings.sales.currency,
    fx: { main: settings.sales.currency, rates: settings.sales.exchangeRates },
    today: today(),
    people: (people ?? []).map((p) => ({ id: p.id, name: p.name })),
    me: (people ?? []).some((p) => p.id === me.id) ? me.id : null,
    // The stages the company uses, named as the order's tabs.
    steps: (sections?.stages ?? [...FLOW_STEPS]).map((key, i) => ({ key, number: i + 1, label: ORDER_TAB_LABEL[key] })),
    factories: [...factories].map(([fid, name]) => ({ id: fid, name })),
    canEdit: costs.canEdit,
  };
  return { costs, setup, money: m };
});
