import { allocate, divideHalfAway, exactDecimal, multiplyMinor, roundHalfAway, type Minor } from "./core";

/**
 * Costing for a trading company: what a factory line costs us in the quotation
 * currency, and the margin we add on top.
 */

/** Exchange rates as "1 unit of the main currency buys N units of X" (USD → { CNY: 7.1 }). */
export type Rates = Record<string, number>;

/**
 * Units of `from` per 1 unit of `to`, using rates against the main currency.
 * null when a rate is missing, so a cost is never silently converted at 1:1.
 */
export function fxRate(from: string, to: string, main: string, rates: Rates): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return 1;
  const per = (c: string) => (c === main.toUpperCase() ? 1 : (rates[c] ?? null));
  const rf = per(f);
  const rt = per(t);
  if (!rf || !rt) return null;
  return rf / rt;
}

/**
 * An amount in one currency → another at the Settings rates, to 2 decimals
 * (CNY 7,100.00 → USD 1,000.00 at 7.10). null when a rate is missing.
 */
export function convertAmount(amount: number, from: string, to: string, main: string, rates: Rates): number | null {
  const r = fxRate(from, to, main, rates);
  if (r === null || !Number.isFinite(amount)) return null;
  return roundHalfAway((amount * 100) / r) / 100;
}

/**
 * The same rates said against another main currency: { CNY: 7.1, PKR: 280 }
 * against USD → { USD: 0.003571…, CNY: 0.025357… } against PKR. Rates that
 * cannot be restated (missing) are left out.
 */
export function restateRates(rates: Rates, oldMain: string, newMain: string): Rates {
  const o = oldMain.toUpperCase();
  const n = newMain.toUpperCase();
  if (o === n) return { ...rates };
  const base = rates[n];
  if (!base) return {};
  const out: Rates = { [o]: 1 / base };
  for (const [c, r] of Object.entries(rates)) if (c !== n && c !== o) out[c] = r / base;
  return out;
}

/** An amount in the factory's currency → the document currency, given rate = factory units per document unit. */
export const convertMinor = (minor: Minor, rate: number): Minor => {
  if (!(rate > 0)) throw new Error("Exchange rate must be more than 0");
  return roundHalfAway(minor / rate);
};

/**
 * A factory price with its tax % added on top: 100.00 + 13% → 113.00 (what one
 * unit costs Kebo); 100.50 + 13% → 113.57. Exact integer arithmetic, rounded
 * half away from zero, the same as round(price × (100 + tax)) in the database.
 */
export function withTaxMinor(unitPriceMinor: Minor, taxRate: number | string): Minor {
  const rate = exactDecimal(Math.max(Number(taxRate) || 0, 0));
  if (!rate) return roundHalfAway(unitPriceMinor);
  const s = 10n ** BigInt(rate.scale);
  return Number(divideHalfAway(BigInt(roundHalfAway(unitPriceMinor)) * (100n * s + rate.n), 100n * s));
}

/** Margin as a share of the selling price, in % with one decimal: (price − cost) / price. */
export function marginPercent(unitPriceMinor: Minor, unitCost: Minor): number | null {
  if (!(unitPriceMinor > 0)) return null;
  return roundHalfAway(((unitPriceMinor - unitCost) / unitPriceMinor) * 1000) / 10;
}

/** The selling price that leaves `margin`% on a unit cost. */
export function priceForMargin(unitCost: Minor, margin: number): Minor {
  if (margin >= 100) throw new Error("Margin must be under 100%");
  return roundHalfAway(unitCost / (1 - margin / 100));
}

export interface CostedLine {
  quantity: number | string;
  unitPriceMinor: Minor;
  unitCostMinor: Minor | null;
}

/**
 * The costing box on a quotation: cost, sales and profit of the lines that have
 * a cost; lines without one are counted apart. The document discount is spread
 * over all lines by amount (as on the invoice), so it lowers the profit shown.
 */
export function costSummary(lines: CostedLine[], discountMinor: Minor = 0, extraCostMinor: Minor = 0) {
  const gross = lines.map((l) => multiplyMinor(l.unitPriceMinor, l.quantity));
  const subtotal = gross.reduce((s, g) => s + g, 0);
  const shares = allocate(Math.min(Math.max(discountMinor, 0), Math.max(subtotal, 0)), gross);
  let cost = 0;
  let sales = 0;
  let uncosted = 0;
  lines.forEach((l, i) => {
    if (l.unitCostMinor === null) {
      uncosted += 1;
      return;
    }
    const afterDiscount = gross[i] - shares[i];
    sales += afterDiscount;
    cost += multiplyMinor(l.unitCostMinor, l.quantity);
  });
  // Costs that are not lines (freight to reach the basis we sell on…) are part of the cost too.
  cost += Math.max(Math.round(extraCostMinor), 0);
  return {
    costMinor: cost,
    salesMinor: sales,
    profitMinor: sales - cost,
    marginPercent: sales > 0 ? roundHalfAway(((sales - cost) / sales) * 1000) / 10 : null,
    uncostedLines: uncosted,
    extraCostMinor: Math.max(Math.round(extraCostMinor), 0),
  };
}

/**
 * Each line's cost per unit with a share of costs that are not lines (freight,
 * transport to the port…), shared by what each line costs: what prices must
 * cover. Lines without a cost stay null and take no share.
 */
export function landedUnitCosts(lines: { unitCostMinor: Minor | null; quantity: number | string }[], extraMinor: Minor): (Minor | null)[] {
  const weights = lines.map((l) => (l.unitCostMinor === null ? 0 : Math.max(multiplyMinor(l.unitCostMinor, l.quantity), 0)));
  const total = weights.reduce((t, w) => t + w, 0);
  const shares = total > 0 && extraMinor > 0 ? allocate(Math.round(extraMinor), weights) : weights.map(() => 0);
  return lines.map((l, i) => {
    if (l.unitCostMinor === null) return null;
    const qty = Number(l.quantity) || 0;
    return qty > 0 ? l.unitCostMinor + roundHalfAway(shares[i]! / qty) : l.unitCostMinor;
  });
}
