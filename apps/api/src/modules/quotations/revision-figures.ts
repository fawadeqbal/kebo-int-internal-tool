import { decimalToMinor, type Prisma } from "@kebo/database";
import { fromMinor } from "@kebo/money";
import { revisionOption, revisionWorth } from "@kebo/shared";

/**
 * A revision keeps no figures of its own: its total, discount and lead time are read from its options
 * (the accepted one, else Option A), and what it is worth in reports is the accepted option's total, or
 * the lowest–highest of its options before the customer chooses. Select `optionFigures` on a revision,
 * then read it with `figuresOf` (one option's figures, labelled) or `worthOf` (a range, for sums).
 */
export const optionFigures = {
  options: {
    select: { letter: true, sortOrder: true, status: true, subtotal: true, discount: true, total: true, leadTime: true },
    orderBy: [{ sortOrder: "asc" }, { letter: "asc" }],
  },
} as const satisfies Prisma.QuotationRevisionSelect;

type FigureOption = {
  letter: string;
  sortOrder: number;
  status: string;
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  total: Prisma.Decimal;
  leadTime: string | null;
};

/** The figures of the option that speaks for the revision (accepted, else Option A), with which one it is. */
export function figuresOf(rev: { options: FigureOption[] }) {
  const pick = revisionOption(rev.options);
  const o = pick?.option;
  return {
    subtotal: o ? o.subtotal.toFixed(2) : "0.00",
    discount: o ? o.discount.toFixed(2) : "0.00",
    total: o ? o.total.toFixed(2) : "0.00",
    leadTime: o?.leadTime ?? null,
    /** Which option the figures are ("Option A of 3", "Option B, accepted"); empty with one option. */
    figuresOf: pick?.label ?? "",
  };
}

/** What the revision is worth, in minor units: the accepted option, else the lowest and highest option. */
export function worthOf(rev: { options: FigureOption[] }) {
  return revisionWorth(rev.options, (o) => decimalToMinor(o.total)) ?? { lowMinor: 0, highMinor: 0, accepted: false, label: "" };
}

/** The same as text, for API answers: `upTo` only when the options differ. */
export function worthView(rev: { options: FigureOption[] }) {
  const w = worthOf(rev);
  return { total: fromMinor(w.lowMinor), totalUpTo: w.highMinor !== w.lowMinor ? fromMinor(w.highMinor) : null, totalOf: w.label };
}

/** A revision for lists: without its options, with what it is worth (`total`, `totalUpTo`, `totalOf`). */
export function revisionRow<R extends { options: FigureOption[] }>(r: R): Omit<R, "options"> & ReturnType<typeof worthView> {
  const { options: _options, ...rest } = r;
  return { ...rest, ...worthView(r) };
}
