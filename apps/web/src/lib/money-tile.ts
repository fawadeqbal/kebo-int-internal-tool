import { whole } from "./format";

type Sums = Map<string, number> | { currency: string; amount: number | string }[];

/**
 * Totals in several currencies as a tile (StatTile value and also): the largest is the value, and the others
 * are named under it ("and USD 12,400 · CNY 80,000"), never a bare "+2". Spread it: <StatTile {...moneyTile(x)} />.
 */
export function moneyTile(sums: Sums): { value: string; also?: string } {
  const list = (sums instanceof Map ? [...sums].map(([currency, amount]) => ({ currency, amount })) : sums)
    .map((s) => ({ currency: s.currency, amount: Number(s.amount) }))
    // Only what shows as at least 1 in whole units: never "and CNY 0".
    .filter((s) => Math.round(s.amount) > 0)
    .sort((a, b) => b.amount - a.amount);
  const [first, ...rest] = list;
  if (!first) return { value: "—" };
  if (!rest.length) return { value: whole(first.amount, first.currency) };
  const named = rest.slice(0, 2).map((s) => whole(s.amount, s.currency)).join(" · ");
  return { value: whole(first.amount, first.currency), also: `and ${named}${rest.length > 2 ? ` and ${rest.length - 2} more` : ""}` };
}
