/**
 * Money is always handled as an integer number of minor units (cents, fen,
 * paisa) plus a currency code. Integers add up exactly, so totals, taxes and
 * balances match on every screen, PDF and report. Decimal strings ("1234.50")
 * are only used at the edges: the database (NUMERIC columns) and forms.
 *
 * Plain numbers are safe up to 9,007,199,254,740,991 minor units
 * (≈ 90 trillion USD), far beyond any single deal.
 */
export type Minor = number;

/** ISO 4217 code, upper case: "USD", "CNY". */
export type Currency = string;

export interface Money {
  readonly amount: Minor;
  readonly currency: Currency;
}

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) {
    super(`Cannot combine ${a} and ${b} amounts without converting first`);
    this.name = "CurrencyMismatchError";
  }
}

const CURRENCY = /^[A-Z]{3}$/;

export function normalizeCurrency(code: string): Currency {
  const c = code.trim().toUpperCase();
  if (!CURRENCY.test(c)) throw new Error(`"${code}" is not a currency code (use three letters, e.g. USD)`);
  return c;
}

/** Anything a decimal can arrive as: number, "1,234.56", or a Prisma Decimal (has toString). */
export type DecimalLike = number | string | { toString(): string } | null | undefined;

/** A decimal amount → minor units, rounded half away from zero. Empty/invalid → 0. */
export function toMinor(value: DecimalLike): Minor {
  if (value === null || value === undefined) return 0;
  const text = typeof value === "number" ? String(value) : value.toString().replace(/,/g, "").trim();
  if (text === "") return 0;
  const n = Number(text);
  if (!Number.isFinite(n)) return 0;
  // Work on the decimal text so 1.005 becomes 101, not 100 (1.005 * 100 = 100.49999… in floating point).
  const m = /^(-)?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!m || m[4]) return Math.sign(n) * Math.round(Math.abs(n) * 100);
  const sign = m[1] ? -1 : 1;
  const whole = Number(m[2] || "0");
  const frac = (m[3] ?? "").padEnd(3, "0");
  const cents = Number(frac.slice(0, 2));
  const roundUp = Number(frac[2]) >= 5 ? 1 : 0;
  return sign * (whole * 100 + cents + roundUp);
}

/** Minor units → the decimal string the database stores ("1234.50"). */
export function fromMinor(minor: Minor): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export const money = (amount: DecimalLike, currency: string): Money => ({ amount: toMinor(amount), currency: normalizeCurrency(currency) });
export const moneyOfMinor = (amount: Minor, currency: string): Money => ({ amount: Math.round(amount), currency: normalizeCurrency(currency) });
export const zero = (currency: string): Money => moneyOfMinor(0, currency);

function same(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
}

export const add = (a: Money, b: Money): Money => (same(a, b), { amount: a.amount + b.amount, currency: a.currency });
export const sum = (items: Money[], currency: string): Money => items.reduce(add, zero(currency));
export const compare = (a: Money, b: Money): -1 | 0 | 1 => (same(a, b), a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0);
export const max = (a: Money, b: Money): Money => (compare(a, b) >= 0 ? a : b);
export const min = (a: Money, b: Money): Money => (compare(a, b) <= 0 ? a : b);

/** Minor units × a decimal quantity (e.g. 2.5 m), rounded to the nearest minor unit. */
export const multiplyMinor = (minor: Minor, factor: number | string): Minor => roundHalfAway(minor * Number(factor || 0));

/** `percent`% of an amount (15 → 15%), rounded to the nearest minor unit. */
export const percentOfMinor = (minor: Minor, percent: number): Minor => roundHalfAway((minor * percent) / 100);

/** Rounds .5 away from zero, as accountants expect (−6.25 → −6.3 at one decimal). */
export function roundHalfAway(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/**
 * Split an amount by weights so the parts add up exactly to the amount
 * (largest-remainder method). Used to spread a document discount over its
 * lines, or a payment over several invoices.
 */
export function allocate(totalInput: Minor, weightsInput: number[]): Minor[] {
  if (weightsInput.length === 0) return [];
  // Whole minor units and finite, non-negative weights only, so the loop below always ends.
  const total = Math.round(totalInput);
  const weights = weightsInput.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) {
    const even = weights.map(() => 0);
    even[even.length - 1] = total;
    return even;
  }
  const raw = weights.map((w) => (total * w) / totalWeight);
  const parts = raw.map((r) => Math.trunc(r));
  let remainder = total - parts.reduce((s, p) => s + p, 0);
  const step = Math.sign(remainder);
  const order = raw
    .map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder !== 0; k = (k + 1) % order.length) {
    parts[order[k].i] += step;
    remainder -= step;
  }
  return parts;
}

export function formatMinor(minor: Minor, currency: string, locale = "en-US"): string {
  const amount = (minor / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency} ${amount}`;
}

