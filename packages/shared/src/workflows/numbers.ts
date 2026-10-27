import type { ISODate } from "@kebo/utils";

/** Words that do not name the customer: left out of their letters ("Al-Shifa Pharma Ltd" → "AP"). */
const FILLER = new Set([
  "ltd",
  "limited",
  "co",
  "company",
  "inc",
  "llc",
  "plc",
  "corp",
  "corporation",
  "group",
  "the",
  "and",
  "of",
  "for",
  "sarl",
  "gmbh",
  "sa",
  "pvt",
  "private",
  "fze",
  "fzco",
  "est",
  "establishment",
  "trading",
  "enterprises",
  "international",
  "industries",
  "industry",
  "llp",
  "bv",
  "srl",
]);

/**
 * The customer's letters on documents when none are set: the first letter of
 * the first two words that name them ("Tanzania Nuts Ltd" → "TN"), or the
 * first two letters of a one-word name ("Nile" → "NI"). Latin letters only.
 */
export function customerLetters(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s&/,.()]+/)
    .map((w) => w.replace(/[^A-Za-z-]/g, ""))
    .filter((w) => w && !FILLER.has(w.toLowerCase().replace(/-/g, "")));
  if (!words.length) return "XX";
  if (words.length === 1) return (words[0]!.replace(/-/g, "").slice(0, 2) || "XX").toUpperCase().padEnd(2, "X");
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/**
 * Kebo's proforma number: prefix, the day it is issued (YYMMDD), the
 * customer's letters and the handler's count this year, at least two digits:
 * KEB + 2026-09-16 + TN + 7 → KEB260916TN07.
 */
export function proformaNumber(prefix: string, issuedOn: ISODate, letters: string, count: number): string {
  const [y, m, d] = issuedOn.split("-");
  return `${prefix}${y!.slice(2)}${m}${d}${letters.toUpperCase()}${String(count).padStart(2, "0")}`;
}
