/**
 * Money helpers. All arithmetic is done in integer paisa/cents to avoid
 * floating-point rounding errors; values are stored as exact decimals in the DB.
 */
export type Cents = number;

export function toCents(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

export interface LineInput {
  quantity: string | number;
  unitPrice: string | number;
}

export interface Totals {
  lines: { lineTotal: Cents }[];
  subtotal: Cents;
  discount: Cents;
  /** Subtotal less discount (incl. VAT when the prices include it). */
  taxable: Cents;
  taxRate: number;
  /** The VAT: added on top, or the part of the total that is VAT when prices include it. */
  taxAmount: Cents;
  total: Cents;
  pricesIncludeVat: boolean;
}

/**
 * Single place where quotation and invoice totals are calculated.
 * VAT exclusive (default): total = subtotal − discount + VAT.
 * VAT inclusive: total = subtotal − discount, and taxAmount is the VAT inside it.
 */
export function calculateTotals(items: LineInput[], discountInput: string | number, taxRateInput: string | number, pricesIncludeVat = false): Totals {
  const lines = items.map((item) => {
    const qty = Number(item.quantity) || 0;
    return { lineTotal: Math.round(qty * toCents(item.unitPrice)) };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const discount = Math.min(Math.max(toCents(discountInput), 0), subtotal);
  const taxable = subtotal - discount;
  const taxRate = Math.max(Number(taxRateInput) || 0, 0);
  if (pricesIncludeVat) {
    const taxAmount = Math.round((taxable * taxRate) / (100 + taxRate));
    return { lines, subtotal, discount, taxable, taxRate, taxAmount, total: taxable, pricesIncludeVat };
  }
  const taxAmount = Math.round((taxable * taxRate) / 100);
  return { lines, subtotal, discount, taxable, taxRate, taxAmount, total: taxable + taxAmount, pricesIncludeVat };
}

/** An amount without its VAT (unchanged when VAT is added on top). */
export function withoutVat(amount: number, taxRate: number, pricesIncludeVat: boolean): number {
  return pricesIncludeVat && taxRate > 0 ? amount / (1 + taxRate / 100) : amount;
}

/** Format a decimal amount (as stored in the DB) for display. */
export function formatMoney(value: string | number | null | undefined, currency = "PKR"): string {
  return formatCents(toCents(value), currency);
}

export function formatCents(cents: Cents, currency = "PKR"): string {
  const amount = cents / 100;
  return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
