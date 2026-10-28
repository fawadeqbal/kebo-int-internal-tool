import "server-only";
import ExcelJS from "exceljs";
import { SHEET_LIMITS, type ReadSheet, type SheetCol, type SheetSpec } from "./sheet-spec";

const HELP = "How to fill";
const LISTS = "Lists";
/** Dark header, as in the app. */
const HEAD_FILL = "FF1B1033";

/** Excel refuses some characters in a tab's name and cuts it at 31. */
const tabName = (s: string) => s.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";

/** A value as it goes into a cell. Text stays text (never a formula), numbers become numbers. */
function cellValue(v: string | number | null | undefined, col: SheetCol): string | number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (col.kind === "number") {
    const t = v.replace(/,/g, "").trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  }
  return v;
}

/** The workbook for a template or an export. */
export async function writeSheet(spec: SheetSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RFQ Desk";
  wb.created = new Date();
  const ws = wb.addWorksheet(tabName(spec.title), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = spec.columns.map((c) => ({ header: c.header, width: c.width ?? Math.max(10, Math.min(48, c.header.length + 4)) }));

  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });

  const style = (row: ExcelJS.Row) =>
    spec.columns.forEach((c, i) => {
      row.getCell(i + 1).alignment = c.kind === "number" ? { horizontal: "right", vertical: "top" } : { vertical: "top", wrapText: true };
    });

  for (const r of spec.rows) style(ws.addRow(spec.columns.map((c, i) => cellValue(r[i], c))));
  if (spec.foot) {
    const f = ws.addRow(spec.columns.map((c, i) => cellValue(spec.foot![i], c)));
    style(f);
    f.font = { bold: true };
    f.eachCell((cell) => (cell.border = { top: { style: "thin" } }));
  }

  if (spec.template) {
    // Dropdowns: the choices sit on a hidden sheet, so long lists work too.
    const listed = spec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.choices?.length);
    if (listed.length) {
      const lists = wb.addWorksheet(LISTS, { state: "hidden" });
      const last = Math.min(SHEET_LIMITS.rows + 1, spec.rows.length + 300);
      listed.forEach(({ c, i }, n) => {
        const letter = lists.getColumn(n + 1).letter;
        c.choices!.forEach((v, k) => (lists.getCell(k + 1, n + 1).value = v));
        const range = `'${LISTS}'!$${letter}$1:$${letter}$${c.choices!.length}`;
        for (let r = 2; r <= last; r++)
          ws.getCell(r, i + 1).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: [range],
            showErrorMessage: !!c.strict,
            errorStyle: "stop",
            errorTitle: c.header,
            error: `Choose one of the list for ${c.header}.`,
          };
      });
    }
    const help = wb.addWorksheet(HELP);
    help.getColumn(1).width = 110;
    const lines = [
      ...spec.template.help,
      "",
      "Columns:",
      ...spec.columns.map(
        (c) =>
          `• ${c.header}${c.required ? " (needed)" : ""}${c.note ? `: ${c.note}` : ""}${c.choices?.length && c.choices.length <= 12 ? ` — ${c.choices.join(", ")}` : ""}`,
      ),
      "",
      "Keep the headings in the first row as they are. Empty rows are skipped.",
    ];
    lines.forEach((l, n) => {
      const cell = help.getCell(n + 1, 1);
      cell.value = l;
      cell.alignment = { wrapText: true, vertical: "top" };
      if (n === 0) cell.font = { bold: true, size: 13 };
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------------------------------------------------------- reading */

/** A cell as text: numbers without float noise, dates as 2026-10-28, formulas as their result. */
function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Number(v.toPrecision(15))) : "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("formula" in v || "sharedFormula" in v) return text((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ("text" in v) return String((v as { text: unknown }).text ?? "");
    if ("error" in v) return "";
  }
  return String(v);
}

/** Splits CSV (or tab- or semicolon-separated) text into rows of cells. */
function parseDelimited(src: string): string[][] {
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const sep = [",", "\t", ";"].sort((a, b) => count(b) - count(a))[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export class SheetError extends Error {}

/** The headings and rows of an uploaded .xlsx or .csv file. */
export async function readSheet(data: ArrayBuffer, fileName: string): Promise<ReadSheet> {
  const bytes = new Uint8Array(data);
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK": an .xlsx is a zip
  let grid: string[][];
  let sheet = fileName;
  if (zip) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(data);
    } catch {
      throw new SheetError("This file could not be read. Save it as an Excel workbook (.xlsx) or CSV and try again.");
    }
    const ws = wb.worksheets.find((w) => w.state === "visible" && w.name !== HELP && w.name !== LISTS && w.actualRowCount > 0);
    if (!ws) throw new SheetError("The file has no rows.");
    sheet = ws.name;
    grid = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(row.cellCount, SHEET_LIMITS.columns); c++) cells.push(text(row.getCell(c).value).trim());
      grid.push(cells);
    });
  } else if (/\.(csv|txt|tsv)$/i.test(fileName)) {
    grid = parseDelimited(new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "")).map((r) => r.slice(0, SHEET_LIMITS.columns).map((c) => c.trim()));
  } else {
    throw new SheetError("Upload an Excel workbook (.xlsx) or a CSV file. Old .xls files: open in Excel and save as .xlsx.");
  }

  const filled = grid.filter((r) => r.some((c) => c !== ""));
  const [headers, ...rows] = filled;
  if (!headers) throw new SheetError("The file has no rows.");
  if (rows.length > SHEET_LIMITS.rows) throw new SheetError(`The file has ${rows.length} rows; up to ${SHEET_LIMITS.rows} can be uploaded at once.`);
  return { sheet, headers, rows: rows.map((r) => headers.map((_, i) => r[i] ?? "")) };
}
