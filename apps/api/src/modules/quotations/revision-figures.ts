import { decimalToMinor, type Prisma } from "@kebo/database";
import { fromMinor, fxRate, type Rates } from "@kebo/money";
import { byLetter, dealQuotation, revisionOption, revisionWorth, type RevisionStatus } from "@kebo/shared";

/**
 * A revision keeps no figures of its own: its total, discount and lead time are read from its options
 * (the accepted one, else Option A), and what it is worth in reports is the accepted option's total, or
 * the lowest–highest of its options before the customer chooses. Select `optionFigures` on a revision,
 * then read it with `figuresOf` (one option's figures, labelled) or `worthOf` (a range, for sums).
 */
export const optionFigures = {
  options: {
    select: { letter: true, sortOrder: true, status: true, subtotal: true, discount: true, total: true, leadTime: true, leadDays: true, leadFrom: true },
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

/**
 * What a revision is worth (its lowest option) in the main currency, so a deal's quotations in different
 * currencies can be compared; null without a rate (it then counts after those that have one).
 */
export function worthInMain(main: string, rates: Rates) {
  return (r: { currency: string; options: FigureOption[] }) => {
    const rate = fxRate(r.currency, main, main, rates);
    return rate ? worthOf(r).lowMinor / rate : null;
  };
}

type QuotationWithRevisions = {
  letter: string;
  revisions: { number: number; status: RevisionStatus; currency: string; options: FigureOption[] }[];
};

/**
 * A deal's quotations for lists and its page: those with a revision, in their letters' order, and the one that
 * speaks for the deal (the accepted one, else the lowest still waiting, else the lowest answered; while all are
 * drafts, the first).
 */
export function dealQuotations<Q extends QuotationWithRevisions>(quotations: Q[], main: string, rates: Rates) {
  const worth = worthInMain(main, rates);
  // A quotation whose drafts were all deleted is not one of the deal's (its letter goes to the next new one).
  const shown = quotations.filter((q) => q.revisions.length > 0);
  return { all: byLetter(shown), deal: dealQuotation<Q>(shown, (r) => worth(r)) };
}
