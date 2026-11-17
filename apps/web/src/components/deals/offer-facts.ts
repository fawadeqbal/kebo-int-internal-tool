import { toMinor } from "@kebo/money";
import type { FactoryQuoteView, SourcingView } from "@/lib/types-deals";

/**
 * What a factory offer holds and still needs, worked out the same way on the
 * server (the step's header line, the offers table) and in the browser.
 */

type Items = SourcingView["items"];

/** Their total: the factory's prices × quantities (without tax, or tax included, as the offer says), in their currency (minor units). */
export const theirTotalMinor = (q: FactoryQuoteView) =>
  q.lines.reduce((t, l) => t + Math.round(toMinor(l.unitPrice) * Number(l.quantity)), 0);
/** The customer's top items and parts it answers, as "4 of 5 items" (null: no list to compare with). */
export function coverOf(q: FactoryQuoteView, items: Items) {
  if (!items.length) return null;
  // Items split into parts are priced in their parts: count what can be priced.
  const priceable = items.filter((i) => !i.hasParts);
  const missing = q.coverage.missing.filter((no) => priceable.some((i) => i.no === no)).length;
  return { all: missing === 0, n: priceable.length - missing, of: priceable.length };
}

/** The offer that costs us least and covers every item (null: none does). */
export function cheapestComplete(quotes: FactoryQuoteView[]) {
  return (
    quotes
      .filter((q) => q.lines.length && q.totalCost !== null && Number(q.totalCost) > 0 && !q.coverage.missing.length && !q.unpriced)
      .sort((a, b) => Number(a.totalCost) - Number(b.totalCost))[0] ?? null
  );
}

/** The factory's short name: "Ruian factory" → "Ruian". */
export const shortName = (name: string) => name.replace(/\s+(factory|machinery|co\.?,? ?ltd\.?|company)\b.*$/i, "").trim() || name;
