import { whole } from "./format";

type Sums = Map<string, number> | { currency: string; amount: number | string }[];

/**
 * Totals in several currencies as a tile (StatTile value and also): the company's currency (`main`) or else the
 * largest is the value, and the others
 * are named under it ("and USD 12,400 · CNY 80,000"), never a bare "+2". Spread it: <StatTile {...moneyTile(x)} />.
 */
export function moneyTile(sums: Sums, main?: string): { value: string; also?: string } {
  const list = (sums instanceof Map ? [...sums].map(([currency, amount]) => ({ currency, amount })) : sums)
    .map((s) => ({ currency: s.currency, amount: Number(s.amount) }))
    // Only what shows as at least 1 in whole units: never "and CNY 0".
    .filter((s) => Math.round(s.amount) > 0)
    // The company's own currency first when given: PKR 9,018,000 is not more than USD 1,093,317.
    .sort((a, b) => Number(b.currency === main) - Number(a.currency === main) || b.amount - a.amount);
  const [first, ...rest] = list;
  if (!first) return { value: "—" };
  if (!rest.length) return { value: whole(first.amount, first.currency) };
  const named = rest.slice(0, 2).map((s) => whole(s.amount, s.currency)).join(" · ");
  return { value: whole(first.amount, first.currency), also: `and ${named}${rest.length > 2 ? ` and ${rest.length - 2} more` : ""}` };
}
