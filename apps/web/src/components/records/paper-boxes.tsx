import type { ReactNode } from "react";
import { PAPER, type PaperTerms, type PaperTermsBox, type PaperTermsKind } from "@kebo/shared";
import { BoxFacts } from "@/components/common/record-box";

/** Rows typed at length are clamped in a box (their window holds the whole text). */
const CLAMP: Record<string, string> = { paymentNote: "line-clamp-3", notes: "line-clamp-4" };

/**
 * A paper box's facts (canvas "RFQ Desk — the pieces", board "Papers"): the rows this kind of paper shows, in
 * order, each said the same way on every paper (PAPER in @kebo/shared); nothing said is —.
 */
export function PaperFacts({ terms, kind, box }: { terms: PaperTerms; kind: PaperTermsKind; box: PaperTermsBox }) {
  const labels = PAPER.rows[box] as Record<string, string>;
  const rows = (PAPER.kinds[kind][box] as readonly string[]).map((r): [string, ReactNode] => {
    const words = PAPER.text(terms, r as Parameters<typeof PAPER.text>[1]);
    return [labels[r]!, words && CLAMP[r] ? <span className={`${CLAMP[r]} whitespace-pre-line`}>{words}</span> : words];
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
