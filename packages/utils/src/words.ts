/**
 * Amounts in words, as printed on export quotations and invoices
 * ("US Dollars Nine Thousand Nine Hundred Fifty Only").
 */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

const CURRENCY_NAMES: Record<string, [major: string, minor: string]> = {
  USD: ["US Dollars", "Cents"],
  EUR: ["Euros", "Cents"],
  GBP: ["Pounds Sterling", "Pence"],
  CNY: ["Chinese Yuan", "Fen"],
  RMB: ["Chinese Yuan", "Fen"],
  AED: ["UAE Dirhams", "Fils"],
  SAR: ["Saudi Riyals", "Halalas"],
  PKR: ["Pakistani Rupees", "Paisa"],
  INR: ["Indian Rupees", "Paise"],
  NGN: ["Nigerian Naira", "Kobo"],
  KES: ["Kenyan Shillings", "Cents"],
  BDT: ["Bangladeshi Taka", "Poisha"],
};

function belowThousand(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) parts.push(n % 10 ? `${TENS[Math.floor(n / 10)]}-${ONES[n % 10]}` : TENS[Math.floor(n / 10)]);
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}

/** 1234567 → "One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven". */
export function numberToWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";
  const groups: string[] = [];
  let scale = 0;
  while (n > 0 && scale < SCALES.length) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(`${belowThousand(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ""}`);
    n = Math.floor(n / 1000);
    scale++;
  }
  return groups.join(" ");
}

/** Minor units and a currency → words, e.g. (995020, "USD") → "US Dollars Nine Thousand Nine Hundred Fifty and Cents Twenty Only". */
export function amountInWords(minor: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  const [major, minorName] = CURRENCY_NAMES[code] ?? [code, "Cents"];
  const abs = Math.abs(Math.round(minor));
  const whole = Math.floor(abs / 100);
  const fraction = abs % 100;
  return `${major} ${numberToWords(whole)}${fraction ? ` and ${minorName} ${numberToWords(fraction)}` : ""} Only`;
}
