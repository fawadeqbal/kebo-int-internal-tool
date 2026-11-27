import type { SupplierQuoteView, SourcingView } from "@/lib/types-deals";

/**
 * What a supplier offer holds and still needs, worked out the same way on the
 * server (the step's header line, the offers table) and in the browser.
 */

type Items = SourcingView["items"];
/** The customer's top items and parts it answers, as "4 of 5 items" (null: no list to compare with). */
export function coverOf(q: SupplierQuoteView, items: Items) {
  if (!items.length) return null;
  // Items split into parts are priced in their parts: count what can be priced.
  const priceable = items.filter((i) => !i.hasParts);
  const missing = q.coverage.missing.filter((no) => priceable.some((i) => i.no === no)).length;
  return { all: missing === 0, n: priceable.length - missing, of: priceable.length };
}

/**
 * What an offer covers, in words, with what it still has no price for (review 24 Nov: an offer pricing 2 of 4 items
 * said "covers all 4 items"): "covers all 4 items · 2 without a price". `start`: "covers" in a sentence, or a cell's
 * own capital ("All 4 items").
 */
export function coverText(q: SupplierQuoteView, items: Items, start: "sentence" | "cell" = "sentence") {
  if (!q.lines.length) return start === "cell" ? "No items yet" : "no items yet";
  const c = coverOf(q, items);
  const what = c ? (c.all ? (c.of === 1 ? "the 1 item" : `all ${c.of} items`) : `${c.n} of ${c.of} items`) : `${q.lines.length} item${q.lines.length === 1 ? "" : "s"}`;
  const text = start === "cell" ? `${what.charAt(0).toUpperCase()}${what.slice(1)}` : `covers ${what}`;
  return q.unpriced > 0 ? `${text} · ${q.unpriced} without a price` : text;
}

/** The supplier's short name: "Ruian factory" → "Ruian". */
export const shortName = (name: string) => name.replace(/\s+(factory|machinery|co\.?,? ?ltd\.?|company)\b.*$/i, "").trim() || name;
