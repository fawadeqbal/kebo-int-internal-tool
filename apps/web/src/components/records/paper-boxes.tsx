import type { ReactNode } from "react";
import { PAPER, type PaperTerms, type PaperTermsBox, type PaperTermsKind, type PaperTermsRow } from "@kebo/shared";
import { BoxFacts } from "@/components/common/record-box";
import { Dash } from "@kebo/ui";

/** Rows typed at length are clamped in a box (their window holds the whole text). */
const CLAMP: Record<string, string> = { paymentNote: "line-clamp-3", notes: "line-clamp-4" };

/**
 * A paper box's facts (canvas "RFQ Desk — the pieces", board "Papers"): the rows this kind of paper shows, in
 * order, each said the same way on every paper (PAPER in @kebo/shared); nothing said is — (a row only some papers
 * have, like the port of discharge, is left out). `values` says a row its own way (a quotation's payment, with
 * each part's amount); `after` adds under a row's words (how it compares with the supplier's offer).
 */
export function PaperFacts({
  terms,
  kind,
  box,
  values,
  after,
}: {
  terms: PaperTerms;
  kind: PaperTermsKind;
  box: PaperTermsBox;
  values?: Partial<Record<PaperTermsRow, ReactNode>>;
  after?: Partial<Record<PaperTermsRow, ReactNode>>;
}) {
  const labels = PAPER.rows[box] as Record<string, string>;
  const rows = (PAPER.kinds[kind][box] as readonly PaperTermsRow[]).flatMap((r): [string, ReactNode][] => {
    const words = PAPER.text(terms, r);
    if (!words && PAPER.optional.includes(r)) return [];
    const said = values?.[r] ?? (words && CLAMP[r] ? <span className={`${CLAMP[r]} whitespace-pre-line`}>{words}</span> : words);
    const more = after?.[r];
    return [[labels[r]!, more ? <span className="flex flex-col items-start gap-0.5">{said ?? <Dash />}{more}</span> : said]];
  });
  return <BoxFacts rows={rows} />;
}

/**
 * A paper's boxes in their places: who it is from (or for) beside Delivery & payment, then the prices, then
 * Warranty & conditions — the same on an offer, a quotation, an order and a purchase order.
 */
export function PaperLayout({
  party,
  terms,
  prices,
  conditions,
}: {
  party: ReactNode;
  terms: ReactNode;
  prices: ReactNode;
  conditions: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {party}
        {terms}
      </div>
      {prices}
      <div className="grid items-start gap-4 lg:grid-cols-2">{conditions}</div>
    </div>
  );
}
