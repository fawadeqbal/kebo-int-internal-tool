/**
 * Profit arithmetic for the executive reports, kept free of the database so it
 * can be tested on its own. Everything is in cents of one currency.
 *
 * Each line's revenue is its amount less its share of the document's discount
 * (the discount is spread over the lines by amount, the last line taking the
 * rounding). A line with a recorded cost (from a factory offer, or typed in)
 * counts towards profit; a line without one (freight, inspection, an item
 * priced by hand) is revenue with an unknown cost and is reported apart, so it
 * never inflates the profit.
 */

export interface ProfitLine {
  docId: string;
  docNo: string;
  /** YYYY-MM-DD */
  date: string;
  customer: string;
  category: string;
  person: string;
  /** The factory the cost came from; null when the cost was typed by hand or is unknown. */
  factory: string | null;
  quantity: number;
  lineTotalCents: number;
  docSubtotalCents: number;
  docDiscountCents: number;
  /** One unit's cost incl. VAT, in the document currency; null = no cost recorded. */
  unitCost: number | null;
}

export interface CostedLine extends ProfitLine {
  netCents: number;
  costCents: number | null;
  profitCents: number | null;
}

export interface ProfitTotals {
  /** Revenue after discounts, before tax. */
  revenueCents: number;
  /** Revenue on lines with a known cost. */
  costedRevenueCents: number;
  /** Revenue on lines without a cost (freight, hand-priced lines). */
  uncostedRevenueCents: number;
  costCents: number;
  profitCents: number;
  /** Profit ÷ costed revenue, one decimal; null when nothing is costed. */
  marginPercent: number | null;
  /** Share of revenue whose cost is known, 0–100. */
  coveragePercent: number | null;
  documents: number;
}

export interface ProfitGroup extends ProfitTotals {
  key: string;
}

const round1 = (n: number) => Math.sign(n) * Math.round(Math.abs(n) * 10) / 10;

/** Spread each document's discount over its lines and work out cost and profit per line. */
export function costLines(lines: ProfitLine[]): CostedLine[] {
  const byDoc = new Map<string, ProfitLine[]>();
  for (const l of lines) byDoc.set(l.docId, [...(byDoc.get(l.docId) ?? []), l]);
  const out: CostedLine[] = [];
  for (const docLines of byDoc.values()) {
    const discount = docLines[0].docDiscountCents;
    const subtotal = docLines[0].docSubtotalCents;
    let given = 0;
    docLines.forEach((l, i) => {
      const share = subtotal > 0 && discount > 0 ? (i === docLines.length - 1 ? discount - given : Math.round((l.lineTotalCents * discount) / subtotal)) : 0;
      given += share;
      const netCents = l.lineTotalCents - share;
      const costCents = l.unitCost === null ? null : Math.round(Math.round(l.unitCost * 100) * l.quantity);
      out.push({ ...l, netCents, costCents, profitCents: costCents === null ? null : netCents - costCents });
    });
  }
  return out;
}

export function totals(lines: CostedLine[]): ProfitTotals {
  let revenue = 0,
    costedRevenue = 0,
    cost = 0,
    profit = 0;
  const docs = new Set<string>();
  for (const l of lines) {
    docs.add(l.docId);
    revenue += l.netCents;
    if (l.costCents !== null) {
      costedRevenue += l.netCents;
      cost += l.costCents;
      profit += l.profitCents!;
    }
  }
  return {
    revenueCents: revenue,
    costedRevenueCents: costedRevenue,
    uncostedRevenueCents: revenue - costedRevenue,
    costCents: cost,
    profitCents: profit,
    marginPercent: costedRevenue > 0 ? round1((profit / costedRevenue) * 100) : null,
    coveragePercent: revenue > 0 ? Math.round((costedRevenue / revenue) * 100) : null,
    documents: docs.size,
  };
}

/** Totals per key, most profit first (groups with no costed revenue go last, by revenue). */
export function groupBy(lines: CostedLine[], key: (l: CostedLine) => string, limit = 8): ProfitGroup[] {
  const groups = new Map<string, CostedLine[]>();
  for (const l of lines) {
    const k = key(l);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return [...groups.entries()]
    .map(([k, ls]) => ({ key: k, ...totals(ls) }))
    .sort((a, b) => (b.costedRevenueCents > 0 ? 1 : 0) - (a.costedRevenueCents > 0 ? 1 : 0) || b.profitCents - a.profitCents || b.revenueCents - a.revenueCents)
    .slice(0, limit);
}

/** Per document (invoice), for the deal lists. */
export function deals(lines: CostedLine[]) {
  const byDoc = new Map<string, CostedLine[]>();
  for (const l of lines) byDoc.set(l.docId, [...(byDoc.get(l.docId) ?? []), l]);
  return [...byDoc.values()].map((ls) => ({ id: ls[0].docId, no: ls[0].docNo, date: ls[0].date, customer: ls[0].customer, ...totals(ls) }));
}
