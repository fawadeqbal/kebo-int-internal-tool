/** Lines (a LineTable's rows) to and from Excel: the template, the export, and the rows read from a filled file. */

import { headerKey, sheetNumber, type ReadSheet, type SheetCol, type SheetSpec } from "@/lib/sheet-spec";
import type { LineColumn, LineRow, LineValues } from "@/components/lines/line-table";

/** The units offered in the file's Unit dropdown (others can still be typed). */
const SHEET_UNITS = ["pcs", "sets", "units", "kg", "tons", "m", "m²", "m³", "rolls", "cartons", "boxes", "bags", "pairs", "litres", "drums", "lot"];

/** Other headings a customer's or factory's own sheet may use for a column. */
const ALIASES: Record<string, string[]> = {
  no: ["no", "#", "sn", "sno", "srno", "serial", "line", "lineno", "itemno", "pos", "position"],
  description: ["description", "item", "items", "product", "productname", "name", "goods", "itemdescription", "descriptionofgoods", "commodity"],
  model: ["model", "modelno", "partno", "partnumber", "type", "spec", "specification", "modelpartno", "code"],
  quantity: ["qty", "quantity", "qnty", "pcs"],
  unit: ["unit", "uom", "units"],
  unitPrice: ["price", "unitprice", "fobprice", "exwprice", "rate"],
  taxRate: ["tax", "taxrate", "vat", "tax%", "vat%"],
  targetPrice: ["target", "targetprice"],
  requestedItemId: ["foritem", "customeritem", "itemref"],
};

/** The choices a column takes in a file: as written there, and the value each stands for. */
export function sheetChoicesOf(c: LineColumn): { value: string; text: string }[] | null {
  if (c.sheetChoices) return c.sheetChoices;
  if (c.input === "select") return (c.options ?? []).map((o) => ({ value: o.value, text: o.label }));
  return null;
}

function sheetCol(c: LineColumn): SheetCol {
  const choices = sheetChoicesOf(c);
  return {
    header: c.label,
    kind: c.input === "number" ? "number" : "text",
    width: c.input === "textarea" ? 48 : c.input === "number" ? 12 : 16,
    choices: choices ? choices.map((o) => o.text) : c.input === "unit" ? SHEET_UNITS : undefined,
    strict: !!choices,
    required: !!c.required,
    note: c.input === "unit" ? "pick one or type your own" : choices ? "pick one from the list" : undefined,
  };
}

const NO_COL: SheetCol = { header: "No.", width: 7, note: "1, 2, 3 for lines; 1.1, 1.2 for the parts of line 1" };
const valueText = (c: LineColumn, v: string) => {
  const choices = sheetChoicesOf(c);
  return choices ? (choices.find((o) => o.value === v)?.text ?? v) : v;
};

/** A template: No. and the columns that are typed, with any rows to start from (the customer's items for a factory). */
export function lineTemplate(opts: { name: string; columns: LineColumn[]; noun: string; flat?: boolean; rows?: { no: string; values: LineValues }[] }): SheetSpec {
  const cols = opts.columns.filter((c) => c.input);
  return {
    name: opts.name,
    title: opts.name,
    columns: [NO_COL, ...cols.map(sheetCol)],
    rows: (opts.rows ?? []).map((r) => [r.no, ...cols.map((c) => valueText(c, r.values[c.key] ?? "") || null)]),
    template: {
      help: [
        `${opts.name}: one ${opts.noun} per row.`,
        opts.flat
          ? "Fill in the rows under the headings; the No. column can stay empty."
          : `Write 1, 2, 3 in the No. column for each ${opts.noun}, and 1.1, 1.2 for the parts of ${opts.noun} 1. Empty No.: a ${opts.noun} of its own.`,
        "Then upload the file with Excel › Upload a filled file. The rows are shown to check; nothing is saved until you add them.",
        `Uploading adds ${opts.noun}s; it never changes or removes the ${opts.noun}s already there.`,
      ],
    },
  };
}

/** The lines as they are now: No., every column (typed values as typed; totals as shown). */
export function lineExport(opts: { name: string; columns: LineColumn[]; rows: LineRow[]; numbers: string[] }): SheetSpec {
  const shown = (c: LineColumn, r: LineRow): string | number | null => {
    if (c.input) return valueText(c, r.values[c.key] ?? "") || null;
    const f = c.format?.(r.values, r);
    return typeof f === "string" || typeof f === "number" ? f : null;
  };
  // Columns only shown (a total) go in when they give text for at least one row.
  const cols = opts.columns.filter((c) => c.input || opts.rows.some((r) => ["string", "number"].includes(typeof c.format?.(r.values, r))));
  return {
    name: opts.name,
    title: opts.name,
    columns: [NO_COL, ...cols.map((c) => ({ ...sheetCol(c), choices: undefined }))],
    rows: opts.rows.map((r, i) => [opts.numbers[i] ?? "", ...cols.map((c) => shown(c, r))]),
  };
}

/** One row of an uploaded file, ready to add (or why it cannot be). */
export interface SheetLine {
  /** Its row in the file (the heading is row 1). */
  fileRow: number;
  /** The No. it will get: 1, 1.1, 2 … */
  no: string;
  values: LineValues;
  partOf: number | null;
  problem: string | null;
}

export interface SheetLines {
  lines: SheetLine[];
  /** Headings in the file that match no column (left out). */
  unused: string[];
  /** A message instead of lines (no column could be matched, no rows). */
  error: string | null;
}

/** Matches each heading of the file to a column (by its label, its key or a usual other name). */
function matchHeaders(headers: string[], columns: LineColumn[]) {
  const byKey = new Map<string, string>(); // header key -> column key ("no" for the number)
  for (const c of columns.filter((c) => c.input)) {
    byKey.set(headerKey(c.label), c.key);
    byKey.set(headerKey(c.key), c.key);
  }
  byKey.set("no", "no");
  const at: Record<string, number> = {};
  const unused: string[] = [];
  headers.forEach((h, i) => {
    const k = headerKey(h);
    if (!k) return;
    let col = byKey.get(k);
    if (!col)
      for (const [key, names] of Object.entries(ALIASES))
        if ((key === "no" || columns.some((c) => c.input && c.key === key)) && names.includes(k)) {
          col = key;
          break;
        }
    if (col && at[col] === undefined) at[col] = i;
    else unused.push(h);
  });
  return { at, unused };
}

/** The rows of an uploaded file as lines to add, each checked as the table checks a typed line. */
export function linesFromSheet(
  sheet: ReadSheet,
  opts: { columns: LineColumn[]; flat?: boolean; initial: (parentKey: string | null) => LineValues },
): SheetLines {
  const { at, unused } = matchHeaders(sheet.headers, opts.columns);
  const first = opts.columns.find((c) => c.input);
  if (!first || at[first.key] === undefined)
    return {
      lines: [],
      unused,
      error: `No “${first?.label ?? "Description"}” column in the file. Download the template from Excel › Download a template, or rename the column.`,
    };

  const lines: SheetLine[] = [];
  let top = 0;
  let sub = 0;
  let lastTop: number | null = null;
  sheet.rows.forEach((cells, r) => {
    const cellOf = (key: string) => (at[key] === undefined ? "" : (cells[at[key]!] ?? "").trim());
    const mapped = opts.columns.filter((c) => c.input && at[c.key] !== undefined);
    if (mapped.every((c) => !cellOf(c.key))) return; // an empty row, or only a number

    const isPart = !opts.flat && /^\d+\s*[.-]\s*\d+/.test(cellOf("no")) && lastTop !== null;
    const values = opts.initial(isPart ? "part" : null);
    const problems: string[] = [];
    for (const c of mapped) {
      const t = cellOf(c.key);
      if (!t) continue;
      const choices = sheetChoicesOf(c);
      if (choices) {
        const low = t.toLowerCase();
        const hit =
          choices.find((o) => o.text.toLowerCase() === low || o.value.toLowerCase() === low) ??
          // A short code (an item's number) followed by more words: "1 Ball valve DN50".
          choices.find((o) => o.text && !/\s/.test(o.text) && low.split(/\s+/)[0] === o.text.toLowerCase());
        if (hit) values[c.key] = hit.value;
        else problems.push(`${c.label} “${t}” is not one of the choices`);
      } else if (c.input === "number") {
        const n = sheetNumber(t);
        if (n === null) problems.push(`${c.label} “${t}” is not a number`);
        else values[c.key] = n;
      } else values[c.key] = c.maxLength ? t.slice(0, c.maxLength) : t;
    }
    for (const c of opts.columns) if (c.required && !values[c.key]?.trim()) problems.push(c.required);

    const parentProblem = isPart && lastTop !== null && lines[lastTop]!.problem !== null;
    if (parentProblem) problems.push(`its ${lines[lastTop!]!.no} has a problem`);
    let no: string;
    if (isPart) no = `${top}.${++sub}`;
    else {
      sub = 0;
      no = String(++top);
    }
    lines.push({ fileRow: r + 2, no, values, partOf: isPart ? lastTop : null, problem: problems.length ? problems.join("; ") : null });
    if (!isPart) lastTop = lines.length - 1;
  });
  if (!lines.length) return { lines, unused, error: "The file has headings but no rows to add." };
  return { lines, unused, error: null };
}
