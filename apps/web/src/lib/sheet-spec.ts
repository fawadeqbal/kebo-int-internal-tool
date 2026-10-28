/** Excel files: what the browser sends to make one, and what it gets back from reading one. */

/** One column of a sheet to download. */
export interface SheetCol {
  header: string;
  /** Width in characters (Excel's unit). */
  width?: number;
  /** Numbers are written as numbers, so Excel can add them up. */
  kind?: "text" | "number";
  /** A dropdown in the file. Without `strict`, other values can still be typed. */
  choices?: string[];
  strict?: boolean;
  /** Must be filled in (said on the "How to fill" sheet). */
  required?: boolean;
  /** Said about the column on the "How to fill" sheet. */
  note?: string;
}

/** A sheet to download: a template to fill in, or an export of what is on screen. */
export interface SheetSpec {
  /** The file's name, without ".xlsx". */
  name: string;
  /** The tab's name. */
  title: string;
  columns: SheetCol[];
  rows: (string | number | null)[][];
  /** A total row under the rows (an export). */
  foot?: (string | number | null)[];
  /** A template: dropdowns run past the rows, and these lines go on a "How to fill" sheet. */
  template?: { help: string[] };
}

/** A sheet read from an uploaded file: its headings and its rows, every cell as text. */
export interface ReadSheet {
  sheet: string;
  headers: string[];
  rows: string[][];
}

export const SHEET_LIMITS = { bytes: 5 * 1024 * 1024, rows: 2000, columns: 60 } as const;

/** A heading reduced for matching: "Price CNY (per unit)" and "price cny" are the same column. */
export const headerKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9%]+/g, "");

/** A number typed in a sheet ("1,200.50", "USD 300", " 12 ") as plain digits, or null when it is not one. */
export function sheetNumber(text: string): string | null {
  const t = text.replace(/[\s,]/g, "").replace(/^[A-Za-z¥$€£]{1,4}(?=-?\d)/, "").replace(/%$/, "");
  if (!t) return "";
  return /^-?\d+(\.\d+)?$/.test(t) ? String(Number(t)) : null;
}
