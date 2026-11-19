"use client";
import { RULES } from "@kebo/ui";

import { PanelBody, UrlWindow } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { QuoteOffers, RevisionDraft } from "@/lib/types-deals";
import { QuoteStepsPanel, TermsPanel } from "./quotation-step";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A window kept in the address (?panel=name), so an action in ⋯ can open it (canvas board "Actions: one list per
 * record type"): Back closes it, a link opens it again.
 */
/** "Edit all" from ⋯ on a draft: the quotation's steps (Prices · Delivery · Payment · Warranty & conditions), one Save. */
export function EditAllWindow({
  quoteRef,
  ...editor
}: {
  quoteRef: string;
  number: number;
  initial: RevisionDraft;
  offers: QuoteOffers;
  loadOffers: (currency: string) => Promise<QuoteOffers | null>;
  showCosts: boolean;
  action: Action;
}) {
  return (
    <UrlWindow name="edit-quote" title={`Edit · ${quoteRef}`} description="Draft" className={RULES.window.items}>
      <QuoteStepsPanel {...editor} step="lines" />
    </UrlWindow>
  );
}

/**
 * "New revision" from ⋯ on a sent quotation: the window that starts the next revision as a copy of this one (which
 * offers, the terms), or why one cannot start yet.
 */
export function NewRevisionWindow({
  draft,
  offers,
  loadOffers,
  showCosts,
  action,
  whyNot,
}: {
  draft: RevisionDraft | null;
  offers: QuoteOffers | null;
  loadOffers: (currency: string) => Promise<QuoteOffers | null>;
  showCosts: boolean;
  action: Action;
  whyNot: string | null;
}) {
  if (!draft || !offers)
    return (
      <UrlWindow name="new-revision" title="New revision" className={RULES.window.part}>
        <PanelBody>
          <p className="text-sm text-text-2">{whyNot ?? "A new revision cannot start yet."}</p>
        </PanelBody>
      </UrlWindow>
    );
  return (
    <UrlWindow
      name="new-revision"
      title={`New quotation R${draft.number}`}
      description={`Starts as a copy of R${draft.number - 1}. Change what is different, then save the draft.`}
      className={RULES.window.wideRows}
    >
      <TermsPanel
        number={draft.number}
        initial={draft}
        offers={offers}
        loadOffers={loadOffers}
        showCosts={showCosts}
        action={action}
        create
      />
    </UrlWindow>
  );
}
