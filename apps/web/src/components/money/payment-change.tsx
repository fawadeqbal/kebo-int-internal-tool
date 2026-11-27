"use client";

import type { ComponentProps } from "react";
import { RULES } from "@kebo/ui";
import { PanelBody, UrlWindow, useSidePanel } from "@/components/common/panel";
import { useTime } from "@/lib/time-client";
import type { Fx } from "@/lib/fx";
import type { Person } from "@/lib/types";
import type { ExpenseView } from "@/lib/types-money";
import { EditCustomerPayment, FactoryPaymentForm } from "./forms";
import { CostPanel, subOf } from "./cost-window";
import { costForOf } from "./cost-kinds";

/**
 * "Change" from a payment page's ⋯ (?panel=change): the same form the order or the costs list changes it with,
 * in a window, for each kind of payment. One URL name, so the page's ⋯ item is the same for every kind.
 */
export function ChangeCustomerPayment(props: Omit<ComponentProps<typeof EditCustomerPayment>, "onClose">) {
  return (
    <UrlWindow name="change" title="Change the payment" className={RULES.window.part}>
      {(close) => (
        <PanelBody>
          <EditCustomerPayment {...props} onClose={close} />
        </PanelBody>
      )}
    </UrlWindow>
  );
}

export function ChangeSupplierPayment(props: Omit<ComponentProps<typeof FactoryPaymentForm>, "onClose" | "bare">) {
  return (
    <UrlWindow name="change" title="Change the payment" className={RULES.window.part}>
      {(close) => (
        <PanelBody>
          <FactoryPaymentForm {...props} bare onClose={close} />
        </PanelBody>
      )}
    </UrlWindow>
  );
}

/**
 * "Add again" from a cost's ⋯ (?panel=again): a new cost filled in like this one (what for, the kind, the amount,
 * who paid), dated today, in the same window as every new cost. It was a button in the old fold-open row of
 * Expenses; the row now opens this page (review 26 Nov).
 */
export function AgainExpense({ e, people, fx, today }: { e: ExpenseView; people: Person[]; fx: Fx; today: string }) {
  const panel = useSidePanel("again");
  if (!panel.open) return null;
  const setup = { mainCurrency: fx.main, fx, today, people, for: costForOf(e) };
  return (
    <CostPanel
      title="New cost"
      sub={subOf(setup.for)}
      setup={setup}
      mode={{ kind: "new", template: { ...e, for: setup.for ?? undefined } }}
      onClose={() => panel.close()}
      onFileError={() => {}}
    />
  );
}

export function ChangeExpense({ e, people, fx, today }: { e: ExpenseView; people: Person[]; fx: Fx; today: string }) {
  const panel = useSidePanel("change");
  const { date } = useTime();
  if (!panel.open) return null;
  const setup = { mainCurrency: fx.main, fx, today, people, for: costForOf(e) };
  return (
    <CostPanel
      title="Change the cost"
      sub={`${setup.for?.label ?? "The company"} · ${date(e.spentOn)}`}
      setup={setup}
      mode={{ kind: "change", expense: e }}
      onClose={() => panel.close()}
      onFileError={() => {}}
    />
  );
}
