import type { LineCase, OrderDocument } from "@/lib/types-orders";
import { zhTerm } from "@kebo/shared";
import { docFootCell, docItem, docQty, overZh, type DocColumn } from "./kebo-doc";
import type { DocLang } from "./zh";

/**
 * The packing list case by case, in the customer's own format (25 Nov 2026): Case No. · Description of goods ·
 * Qty · Package · L · W · H (mm) · CBM · N.W. · G.W. (kg), a row per case with each item's description and
 * quantity over its cases, and a total row (how many cases, the volume and the weights).
 */

type Line = OrderDocument["lines"][number];

/** Weights with up to 2 decimals and volume with up to 3; blank when not recorded. */
export const kg = (v: string | null | undefined) =>
  v === null || v === undefined ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const m3 = (v: string | null | undefined) =>
  v === null || v === undefined ? "" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const mm = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** A row of the table: one case row of an item (or the item alone, not packed yet). */
export interface CaseLine {
  line: Line;
  c: LineCase | null;
  /** The case number as marked, else the item's number. */
  caseNo: string;
  /** Rows the item's description and quantity cover (0: covered by the row above). */
  lineSpan: number;
  /** Rows this case number covers (the same number on the next rows of the item: one cell, as the customer writes it). */
  caseSpan: number;
}

export function casesOf(lines: Line[]): CaseLine[] {
  const rows: CaseLine[] = [];
  for (const line of lines) {
    const cases: (LineCase | null)[] = line.packing?.cases?.length ? line.packing.cases : [null];
    const numbers = cases.map((c) => c?.caseNo?.trim() || line.no);
    numbers.forEach((n, i) => {
      let span = 0;
      if (i === 0 || numbers[i - 1] !== n) {
        span = 1;
        while (numbers[i + span] === n) span++;
      }
      rows.push({ line, c: cases[i]!, caseNo: n, lineSpan: i === 0 ? cases.length : 0, caseSpan: span });
    });
  }
  return rows;
}

const size = (label: string, pick: (c: LineCase) => number | null): DocColumn<CaseLine> => ({
  label,
  width: 34,
  align: "right",
  wrap: true,
  render: (r) => (r.c ? mm(pick(r.c)) : ""),
});

/**
 * Widths in pt, as every paper's (the description takes what is left: about 155 pt). With Chinese: the item's
 * Chinese under its name, the unit's and the package's after them.
 */
export const caseColumns = (lang: DocLang): DocColumn<CaseLine>[] => [
  { label: "Case No.", width: 34, wrap: true, render: (r) => r.caseNo, span: (r) => r.caseSpan },
  { label: "Description of goods", render: (r) => docItem(r.line.description, r.line.model, r.line.descriptionZh, lang), span: (r) => r.lineSpan },
  { label: "Qty", width: 40, wrap: true, render: (r) => docQty(r.line.quantity, r.line.unit, lang), span: (r) => r.lineSpan },
  {
    label: "Package",
    width: 70,
    wrap: true,
    render: (r) => {
      if (!r.c) return "";
      const zh = lang === "zh" ? zhTerm(r.c.packageType) : null;
      const many = r.c.count > 1 ? `${r.c.count} × ` : "";
      return overZh(`${many}${r.c.packageType}`, zh && `${many}${zh}`);
    },
  },
  size("L (mm)", (c) => c.lengthMm),
  size("W (mm)", (c) => c.widthMm),
  size("H (mm)", (c) => c.heightMm),
  { label: "CBM", width: 36, align: "right", wrap: true, render: (r) => m3(r.c?.cbm) },
  { label: "N.W. (kg)", width: 40, align: "right", wrap: true, render: (r) => kg(r.c?.netWeightKg) },
  { label: "G.W. (kg)", width: 40, align: "right", wrap: true, render: (r) => kg(r.c?.grossWeightKg) },
];

/** The total row: "2 cases" (or packages, when not all are cases), the volume and the weights. */
export function CaseTotals({
  rows,
  totals,
  lang,
}: {
  rows: CaseLine[];
  totals: { packages: number; netWeightKg: string; grossWeightKg: string; cbm: string };
  lang: DocLang;
}) {
  const n = totals.packages;
  const cases = rows.every((r) => !r.c || /\b(case|crate|box)/i.test(r.c.packageType));
  const word = cases ? (n === 1 ? "case" : "cases") : n === 1 ? "package" : "packages";
  return (
    <tr style={{ breakInside: "avoid" }}>
      <td colSpan={3} style={{ ...docFootCell(), paddingLeft: 0 }}>
        {overZh("Total", lang === "zh" ? "合计" : null)}
      </td>
      <td style={docFootCell()}>{n > 0 ? overZh(`${n} ${word}`, lang === "zh" ? `${n}${cases ? "箱" : "件"}` : null) : ""}</td>
      <td colSpan={3} style={docFootCell()} />
      <td style={docFootCell("right")}>{Number(totals.cbm) ? m3(totals.cbm) : ""}</td>
      <td style={docFootCell("right")}>{Number(totals.netWeightKg) ? kg(totals.netWeightKg) : ""}</td>
      <td style={{ ...docFootCell("right"), paddingRight: 0 }}>{Number(totals.grossWeightKg) ? kg(totals.grossWeightKg) : ""}</td>
    </tr>
  );
}
