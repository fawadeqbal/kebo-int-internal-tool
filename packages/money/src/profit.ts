import { allocate, roundHalfAway, type Minor } from "./core";

/**
 * Profit maths for reports, free of the database so it can be tested on its
 * own. Two views:
 *
 * - Estimated (from documents): each sold line's revenue (after its share of
 *   the discount, without our VAT) less its recorded unit cost. Lines with no
 *   cost (freight, hand-priced) are revenue with unknown cost, reported apart
 *   so they never inflate profit.
 * - Actual (from cash): money received from the customer less money paid to
 *   factories and other costs on the order.
 */

export interface SoldLine {
  docId: string;
  lineTotalMinor: Minor;
  quantity: number;
  /** One unit's cost in the document currency; null = no cost recorded. */
  unitCostMinor: Minor | null;
  /** Grouping keys for reports. */
  keys?: Record<string, string>;
}

export interface SoldDoc {
  id: string;
  discountMinor: Minor;
  vatRate: number;
  pricesIncludeVat: boolean;
  lines: SoldLine[];
}

export interface CostedSoldLine extends SoldLine {
  revenueMinor: Minor;
  costMinor: Minor | null;
  profitMinor: Minor | null;
}

export function costDocLines(doc: SoldDoc): CostedSoldLine[] {
  const shares = allocate(doc.discountMinor, doc.lines.map((l) => l.lineTotalMinor));
  return doc.lines.map((l, i) => {
    const after = l.lineTotalMinor - shares[i];
    const revenue = doc.pricesIncludeVat && doc.vatRate > 0 ? roundHalfAway(after / (1 + doc.vatRate / 100)) : after;
    const cost = l.unitCostMinor === null ? null : roundHalfAway(l.unitCostMinor * l.quantity);
    return { ...l, revenueMinor: revenue, costMinor: cost, profitMinor: cost === null ? null : revenue - cost };
  });
}

export interface ProfitTotals {
  revenueMinor: Minor;
  costedRevenueMinor: Minor;
  uncostedRevenueMinor: Minor;
  costMinor: Minor;
  profitMinor: Minor;
  /** Profit ÷ costed revenue, one decimal; null when nothing has a cost. */
  marginPercent: number | null;
  /** Share of revenue whose cost is known, 0–100. */
  coveragePercent: number | null;
  documents: number;
}

export function profitTotals(lines: CostedSoldLine[]): ProfitTotals {
  let revenue = 0;
  let costedRevenue = 0;
  let cost = 0;
  const docs = new Set<string>();
  for (const l of lines) {
    docs.add(l.docId);
    revenue += l.revenueMinor;
    if (l.costMinor !== null) {
      costedRevenue += l.revenueMinor;
      cost += l.costMinor;
    }
  }
  const profit = costedRevenue - cost;
  return {
    revenueMinor: revenue,
    costedRevenueMinor: costedRevenue,
    uncostedRevenueMinor: revenue - costedRevenue,
    costMinor: cost,
    profitMinor: profit,
    marginPercent: costedRevenue > 0 ? roundHalfAway((profit / costedRevenue) * 1000) / 10 : null,
    coveragePercent: revenue > 0 ? Math.round((costedRevenue / revenue) * 100) : null,
    documents: docs.size,
  };
}

/** Totals per group key (customer, category, factory…), most profit first. */
export function profitBy(lines: CostedSoldLine[], key: string, limit = 8) {
  const groups = new Map<string, CostedSoldLine[]>();
  for (const l of lines) {
    const k = l.keys?.[key] ?? "—";
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return [...groups.entries()]
    .map(([k, ls]) => ({ key: k, ...profitTotals(ls) }))
    .sort((a, b) => Number(b.costedRevenueMinor > 0) - Number(a.costedRevenueMinor > 0) || b.profitMinor - a.profitMinor || b.revenueMinor - a.revenueMinor)
    .slice(0, limit);
}
