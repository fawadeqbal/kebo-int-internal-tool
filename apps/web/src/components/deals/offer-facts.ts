import { formatMinor, toMinor } from "@kebo/money";
import type { FactoryQuoteView, SourcingView } from "@/lib/types-deals";

/**
 * What a factory offer holds and still needs, worked out the same way on the
 * server (the step's header line, the offers table) and in the browser.
 */

type Items = SourcingView["items"];

/** Their total: the factory's prices × quantities (without tax, or tax included, as the offer says), in their currency (minor units). */
export const theirTotalMinor = (q: FactoryQuoteView) =>
  q.lines.reduce((t, l) => t + Math.round(toMinor(l.unitPrice) * Number(l.quantity)), 0);
export const theirTotal = (q: FactoryQuoteView) => formatMinor(theirTotalMinor(q), q.currency);

/** The offer's eight details (basis, currency, lead time, valid until, payment terms, minimum order, their ref., their file): how many are filled. */
export function detailsFilled(q: FactoryQuoteView) {
  const v = [q.basis, q.currency, q.leadTime, q.validUntil, q.paymentTerms, q.moq, q.reference, q.files.length ? "x" : null];
  return { n: v.filter((x) => x !== null && x !== undefined && x !== "").length, of: v.length };
}

/** The customer's top items and parts it answers, as "4 of 5 items" (null: no list to compare with). */
export function coverOf(q: FactoryQuoteView, items: Items) {
  if (!items.length) return null;
  // Items split into parts are priced in their parts: count what can be priced.
  const priceable = items.filter((i) => !i.hasParts);
  const missing = q.coverage.missing.filter((no) => priceable.some((i) => i.no === no)).length;
  return { all: missing === 0, n: priceable.length - missing, of: priceable.length };
}

/** What the offer still needs before it can be quoted with confidence, in a few words each ("its lead time", "a price for 1.2"). */
export function offerNeeds(q: FactoryQuoteView, items: Items): string[] {
  const out: string[] = [];
  if (!q.lines.length) return ["its lines"];
  if (q.unpriced) out.push(q.unpriced === 1 ? "one price" : `${q.unpriced} prices`);
  if (items.length && q.coverage.missing.length) out.push(`item ${q.coverage.missing.join(", ")}`);
  if (!q.basis) out.push("its price basis");
  if (!q.leadTime) out.push("its lead time");
  if (q.fxRate === null) out.push(`a ${q.currency} rate in Settings`);
  if (!q.files.length) out.push("their quotation file");
  return out;
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
