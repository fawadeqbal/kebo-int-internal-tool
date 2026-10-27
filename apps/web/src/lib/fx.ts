import { convertAmount, fxRate } from "@kebo/money";

const numberText = (v: string) => v.replace(/,/g, "").trim();

/** The Settings exchange rates as the screens use them: "1 main buys N of each other currency". */
export interface Fx {
  main: string;
  rates: Record<string, number>;
}

/** Units of `currency` per 1 unit of `per` (7.1 CNY per 1 USD), or null when a rate is missing. */
export const rateOf = (fx: Fx, currency: string, per: string) => fxRate(currency, per, fx.main, fx.rates);

/** A typed amount turned into another currency, as text with 2 decimals; null when it is blank, not a number, or a rate is missing. */
export function convertText(text: string, from: string, to: string, fx: Fx): string | null {
  const raw = numberText(text ?? "");
  if (String(text ?? "").trim() === "" || !Number.isFinite(Number(raw))) return null;
  const v = convertAmount(Number(raw), from, to, fx.main, fx.rates);
  return v === null ? null : v.toFixed(2);
}

/** "1 USD = 7.10 CNY" (or the other way round when the other currency is the bigger one). */
export function rateSentence(fx: Fx, a: string, b: string): string | null {
  if (a === b) return null;
  const r = rateOf(fx, b, a);
  if (r === null) return null;
  const nice = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 4 });
  return r >= 1 ? `1 ${a} = ${nice(r)} ${b}` : `1 ${b} = ${nice(1 / r)} ${a}`;
}
