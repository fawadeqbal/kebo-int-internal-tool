import { caseTotals, caseVolume, type CaseRow } from "@kebo/shared";
import type { Tx } from "../../database/prisma.service";

/** The rows as they are kept, for the screens and the packing list (sizes in mm, weights in kg, volume in m³). */
export const caseRowsSelect = { orderBy: { sortOrder: "asc" } } as const;

type Stored = {
  caseNo: string | null;
  count: number;
  packageType: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  netWeightKg: { toString(): string } | null;
  grossWeightKg: { toString(): string } | null;
  cbm: { toString(): string } | null;
};

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** A stored row as a CaseRow (numbers, not decimals). */
export const caseRowOf = (r: Stored): CaseRow => ({
  caseNo: r.caseNo,
  count: r.count,
  packageType: r.packageType,
  lengthMm: r.lengthMm,
  widthMm: r.widthMm,
  heightMm: r.heightMm,
  netWeightKg: num(r.netWeightKg),
  grossWeightKg: num(r.grossWeightKg),
  cbm: num(r.cbm),
});

/** A row for the screens and papers: weights to 2 places, volume to 3, as the line's own packing. */
export const caseView = (r: Stored) => {
  const c = caseRowOf(r);
  return {
    caseNo: c.caseNo,
    count: c.count,
    packageType: c.packageType,
    lengthMm: c.lengthMm,
    widthMm: c.widthMm,
    heightMm: c.heightMm,
    netWeightKg: c.netWeightKg === null ? null : c.netWeightKg.toFixed(2),
    grossWeightKg: c.grossWeightKg === null ? null : c.grossWeightKg.toFixed(2),
    cbm: c.cbm === null ? null : c.cbm.toFixed(3),
  };
};
export type CaseView = ReturnType<typeof caseView>;

/**
 * Replaces a goods line's rows and keeps its totals (packages, packed in, weights, volume) in step: the rows are
 * how it is packed, the totals what every other screen adds up. The volume of a row with a size is worked out.
 */
export async function setLineCases(tx: Tx, lineId: string, rows: CaseRow[]) {
  await tx.orderLineCase.deleteMany({ where: { lineId } });
  if (rows.length)
    await tx.orderLineCase.createMany({
      data: rows.map((r, i) => ({
        lineId,
        sortOrder: i,
        caseNo: r.caseNo,
        count: r.count,
        packageType: r.packageType,
        lengthMm: r.lengthMm,
        widthMm: r.widthMm,
        heightMm: r.heightMm,
        netWeightKg: r.netWeightKg,
        grossWeightKg: r.grossWeightKg,
        cbm: caseVolume(r),
      })),
    });
  const t = caseTotals(rows);
  await tx.orderLine.update({
    where: { id: lineId },
    data: { packages: t.packages, packageType: t.packageType, netWeightKg: t.netWeightKg, grossWeightKg: t.grossWeightKg, cbm: t.cbm },
  });
  return t;
}

/**
 * A line's packing given as totals (the Excel file, a line's cells): one row with them, unless they are what
 * its rows already add up to (then the rows, with their sizes, stay).
 */
export function rowsFromTotals(
  current: CaseRow[],
  p: { packages: number | null; packageType: string | null; netWeightKg: number | null; grossWeightKg: number | null; cbm: number | null },
): CaseRow[] | null {
  const t = caseTotals(current);
  const same =
    (p.packages ?? null) === t.packages &&
    (p.netWeightKg ?? null) === t.netWeightKg &&
    (p.grossWeightKg ?? null) === t.grossWeightKg &&
    (p.cbm ?? null) === t.cbm &&
    (!p.packageType || p.packageType === t.packageType);
  if (same) return null;
  const empty = p.packages === null && p.netWeightKg === null && p.grossWeightKg === null && p.cbm === null;
  if (empty) return [];
  return [
    {
      caseNo: current.length === 1 ? current[0]!.caseNo : null,
      // Not counted yet stays not counted (0): the item is not packed until its packages are.
      count: p.packages ?? 0,
      packageType: p.packageType || "Carton",
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      netWeightKg: p.netWeightKg,
      grossWeightKg: p.grossWeightKg,
      cbm: p.cbm,
    },
  ];
}
