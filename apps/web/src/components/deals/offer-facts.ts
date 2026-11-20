import type { FactoryQuoteView, SourcingView } from "@/lib/types-deals";

/**
 * What a factory offer holds and still needs, worked out the same way on the
 * server (the step's header line, the offers table) and in the browser.
 */

type Items = SourcingView["items"];
/** The customer's top items and parts it answers, as "4 of 5 items" (null: no list to compare with). */
export function coverOf(q: FactoryQuoteView, items: Items) {
  if (!items.length) return null;
  // Items split into parts are priced in their parts: count what can be priced.
  const priceable = items.filter((i) => !i.hasParts);
  const missing = q.coverage.missing.filter((no) => priceable.some((i) => i.no === no)).length;
  return { all: missing === 0, n: priceable.length - missing, of: priceable.length };
}

/** The factory's short name: "Ruian factory" → "Ruian". */
export const shortName = (name: string) => name.replace(/\s+(factory|machinery|co\.?,? ?ltd\.?|company)\b.*$/i, "").trim() || name;
