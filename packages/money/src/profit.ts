import { allocate, multiplyMinor, roundHalfAway, type Minor } from "./core";

/**
 * Profit maths for reports, free of the database so it can be tested on its
 * own. Two views:
 *
 * - Estimated (from documents): each sold line's revenue (after its share of
 *   the discount) less its recorded unit cost. Lines with no
 *   cost (freight, hand-priced) are revenue with unknown cost, reported apart
 *   so they never inflate profit.
 * - Actual (from cash): money received from the customer less money paid to
 *   factories and other costs on the order.
 */

export interface SoldLine {
  docId: string;
  lineTotalMinor: Minor;
  quantity: number | string;
  /** One unit's cost in the document currency; null = no cost recorded. */
  unitCostMinor: Minor | null;
  /** Grouping keys for reports. */
  keys?: Record<string, string>;
}

export interface SoldDoc {
  id: string;
  discountMinor: Minor;
  lines: SoldLine[];
  /**
   * Costs that are not lines (freight and the like to reach the basis we sell
   * on): part of the cost, counted against the revenue that has a cost.
   */
  extraCostMinor?: Minor;
}

export interface CostedSoldLine extends SoldLine {
  revenueMinor: Minor;
  costMinor: Minor | null;
  profitMinor: Minor | null;
}

export function costDocLines(doc: SoldDoc): CostedSoldLine[] {
  const shares = allocate(
    doc.discountMinor,
    doc.lines.map((l) => l.lineTotalMinor),
  );
  const lines = doc.lines.map((l, i) => {
    const revenue = l.lineTotalMinor - shares[i]!;
    const cost = l.unitCostMinor === null ? null : multiplyMinor(l.unitCostMinor, l.quantity);
    return { ...l, revenueMinor: revenue, costMinor: cost, profitMinor: cost === null ? null : revenue - cost };
  });
  const extra = Math.max(Math.round(doc.extraCostMinor ?? 0), 0);
  // The extra cost as a line of its own with no revenue, grouped like the document's first line.
  if (extra > 0)
    lines.push({
      docId: doc.id,
      lineTotalMinor: 0,
      quantity: 1,
      unitCostMinor: extra,
      keys: doc.lines[0]?.keys,
      revenueMinor: 0,
      costMinor: extra,
      profitMinor: -extra,
    });
  return lines;
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
    .sort(
      (a, b) =>
        Number(b.costedRevenueMinor > 0) - Number(a.costedRevenueMinor > 0) ||
        b.profitMinor - a.profitMinor ||
        b.revenueMinor - a.revenueMinor,
    )
    .slice(0, limit);
}
