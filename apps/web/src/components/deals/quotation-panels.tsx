"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FilePlus2 } from "lucide-react";
import { Button, ButtonLink, Card, cn, EmptyState } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import type { QuoteOffers, RevisionDraft } from "@/lib/types-deals";
import { SidePanel } from "@/components/common/panel";
import { TermsPanel } from "./quotation-step";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * "Start a new revision": opens the editor with the API's starting values (a
 * copy of the latest, or R1 from factory costs). With `empty` it is the whole
 * "No quotation yet" card, which the editor replaces when it opens.
 */
export function StartRevision({
  action,
  draft,
  offers,
  loadOffers,
  allowed,
  whyNot,
  showCosts,
  first,
  defaultOpen = false,
  label: labelAs,
  note,
  empty,
  openHref,
  variant: variantAs,
}: {
  /** The button's look, when not the usual (primary for R1, secondary after). */
  variant?: "primary" | "secondary";
  action: Action;
  draft: RevisionDraft | null;
  offers: QuoteOffers | null;
  loadOffers: (currency: string) => Promise<QuoteOffers | null>;
  allowed: boolean;
  whyNot: string | null;
  showCosts: boolean;
  first: boolean;
  /** Open the editor at once (Make the quotation from Factory prices, "Asked for changes…"). */
  defaultOpen?: boolean;
  /** The button's words, when not "Make the quotation (R1)" / "Start a new revision (Rn)". */
  label?: string;
  /** What the new revision starts with (the factory, its cost, the margin): under the title. */
  note?: ReactNode;
  /** The card shown while the editor is closed ("No quotation yet"). */
  empty?: { title: string; description: string };
  /** Open by going to this address (the page then gives the editor its full width); Cancel comes back. */
  openHref?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen && allowed);
  const label = labelAs ?? (first ? "Make the quotation (R1)" : `Start a new revision${draft ? ` (R${draft.number})` : ""}`);
  // Nothing made yet: an empty state with the one way to start (design system); the page header has the primary.
  const frame = (body: ReactNode, description?: ReactNode) =>
    empty ? (
      <Card>
        <EmptyState framed title={empty.title} description={description ?? empty.description} action={body} />
      </Card>
    ) : (
      body
    );
  // Nothing to offer yet: no factory offer with lines, and no list from the customer to price by hand.
  const nothing = !!offers && offers.offers.length === 0 && offers.items.length === 0;
  if (nothing)
    return empty ? (
      frame(null, "Add a factory offer with its lines on the Factory offers tab first; each offer becomes an option the customer can choose.")
    ) : (
      <p className="text-sm text-muted">
        Add a factory offer with its lines on the Factory offers tab first; each offer becomes an option the customer can choose.
      </p>
    );
  if (!open || !draft || !offers) {
    const can = allowed && !!draft && !!offers;
    // In an empty card the header already has the primary: this is its secondary twin.
    const variant = variantAs ?? (first && !empty ? "primary" : "secondary");
    return frame(
      <div className={cn("flex flex-col gap-1.5", empty ? "items-center" : "items-start")}>
        {openHref && can ? (
          <ButtonLink href={openHref} variant={variant}>
            <FilePlus2 aria-hidden /> {label}
          </ButtonLink>
        ) : (
          <Button variant={variant} onClick={() => setOpen(true)} disabled={!can} aria-describedby={!allowed && whyNot ? "why-not-start" : undefined}>
            <FilePlus2 aria-hidden /> {label}
          </Button>
        )}
        {!allowed && whyNot && (
          <p id="why-not-start" className="text-xs text-muted">
            {whyNot}
          </p>
        )}
      </div>,
      empty && note && can ? (
        <>
          {empty.description} {note}
        </>
      ) : undefined,
    );
  }
  const close = () => {
    setOpen(false);
    // Opened by the address (?start=1): take it out, so a reload does not open the window again.
    if (openHref || defaultOpen) router.replace(pathname, { scroll: false });
  };
  // The window: which offers to quote and the terms. The same window, filled, is "Edit quotation".
  return (
    <SidePanel
      title={`New quotation R${draft.number}`}
      description={first ? "Which offers to quote, and the terms. The number is given on save." : `Starts as a copy of R${draft.number - 1}. Change what is different, then save the draft.`}
      className="md:w-[860px]"
      onClose={close}
    >
      <TermsPanel number={draft.number} initial={draft} offers={offers} loadOffers={loadOffers} showCosts={showCosts} action={action} create tickAll={first} onSaved={close} />
    </SidePanel>
  );
}
