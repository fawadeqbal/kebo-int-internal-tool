"use client";

import type { PaymentRoute } from "@kebo/shared";
import type { ActionState } from "@/lib/actions";
import type { BankContract, BankStepView, DeliveryView, FlowDocument, SatCheckView } from "@/lib/types-flow";
import { BankContractForm, RouteForm, SatEditor, type RouteTermsValue } from "./flow-forms";
import { BankChainPanel, PaperSetPanel } from "./flow-panels";
import { PanelBody, useClosePanel } from "./step-view";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * The Edit panels whose body is a section's existing forms (the route's three
 * cards, the LC, the paper set, the bank chain, the SAT points): the same
 * forms as before, in the side panel; saving closes it.
 */

const h = "mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase";

/** How they pay: the route and its terms, then the LC or bank contract. */
export function PaymentEdit({
  routeAction,
  contractAction,
  route,
  contract,
  bankRoutes,
  currency,
  terms,
}: {
  routeAction: Action;
  contractAction: Action;
  route: PaymentRoute | null;
  contract: BankContract | null;
  bankRoutes: boolean;
  currency: string;
  terms?: RouteTermsValue;
}) {
  const close = useClosePanel();
  const bank = route === "bank_contract" || route === "letter_of_credit";
  return (
    <PanelBody className="flex flex-col gap-6">
      <section>
        <h3 className={h}>The route</h3>
        <RouteForm action={routeAction} route={route} bankRoutes={bankRoutes} terms={terms} onDone={close} />
      </section>
      {bank && bankRoutes && (
        <section>
          <h3 className={h}>{route === "letter_of_credit" ? "The LC" : "The bank contract"}</h3>
          <BankContractForm action={contractAction} contract={contract} lc={route === "letter_of_credit"} currency={currency} onDone={close} />
        </section>
      )}
      <p className="text-xs text-muted">Changes show in &ldquo;Changes in this step&rdquo;.</p>
    </PanelBody>
  );
}

/** The paper set: record, change or remove each paper. */
export function PaperSetEdit(props: {
  addAction: Action;
  updateActions: Record<string, Action>;
  removeActions: Record<string, Action>;
  set: FlowDocument[];
  files: { id: string; name: string; href: string }[];
  shipments: { id: string; label: string }[];
}) {
  return (
    <PanelBody>
      <PaperSetPanel {...props} printButtons={{}} canEdit />
    </PanelBody>
  );
}

/** The bank chain: each step's date, courier and reference. */
export function BankChainEdit(props: {
  stepActions: Record<string, Action>;
  clearActions: Record<string, Action>;
  steps: BankStepView[];
  today: string;
}) {
  return (
    <PanelBody>
      <BankChainPanel {...props} canEdit />
    </PanelBody>
  );
}

/** The SAT points: Pass / Fail / N/A and a note each. */
export function SatEdit({ action, checks, suggested, locked }: { action: Action; checks: SatCheckView[]; suggested: string[]; locked: boolean }) {
  return (
    <PanelBody>
      {locked && <p className="mb-3 text-xs text-muted">Signed off: clear the sign-off date (Delivery · Edit) to reopen a point.</p>}
      <SatEditor action={action} checks={checks} suggested={suggested} locked={locked} />
    </PanelBody>
  );
}

export type { DeliveryView };
