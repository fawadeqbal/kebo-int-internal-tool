"use client";

import type { ComponentProps } from "react";
import { RULES } from "@kebo/ui";
import { PanelBody, UrlWindow, useSidePanel } from "@/components/common/panel";
import { useTime } from "@/lib/time-client";
import type { Fx } from "@/lib/fx";
import type { Person } from "@/lib/types";
import type { ExpenseView } from "@/lib/types-money";
import { EditCustomerPayment, FactoryPaymentForm } from "./forms";
import { CostPanel } from "./cost-window";
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
