import "server-only";
import { cache } from "react";
import { can } from "@kebo/shared";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { orderCostsOf, orderMoneyOf, orderStepsOf } from "@/lib/order-data";
import type { Person } from "@/lib/types";
import { optional } from "@/components/print/data";
import { today } from "./today";
import type { ExpenseSetup } from "./expense-form";

const settingsOf = cache(() => api.get<{ sales: { currency: string; exchangeRates: Record<string, number> } }>("/settings"));
const peopleOf = cache(() => api.get<Person[]>("/users/people"));

/**
 * The order's costs and what its expense form needs, for managers with the
 * expenses feature; null for everyone else (no Costs page, no costs cards).
 */
export const orderCostsSetup = cache(async (id: string) => {
  const me = await requireUser();
  if (!can(me, "expenses.manage")) return null;
  const costs = await optional(() => orderCostsOf(id));
  if (!costs) return null;
  const [settings, people, steps, m] = await Promise.all([
    settingsOf(),
    optional(peopleOf),
    optional(() => orderStepsOf(id)),
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
    steps: (steps?.steps ?? []).map((s) => ({ key: s.key, number: s.number, label: s.label })),
    factories: [...factories].map(([fid, name]) => ({ id: fid, name })),
    plan: costs.planned.map((r) => ({ label: r.label, categories: r.categories, planned: r.planned, difference: r.difference })),
    expected: costs.profit?.expected ?? null,
    canEdit: costs.canEdit,
  };
  return { costs, setup, money: m };
});
