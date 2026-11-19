"use client";
import { RULES } from "@kebo/ui";

import { useRouter } from "next/navigation";
import { toast } from "@kebo/ui/client";
import { SidePanel, useSidePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { CustomerDetail } from "@/lib/types-people";
import { CustomerForm } from "./customer-form";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * "New customer" and "Edit customer · name" in the side panel over the list
 * or the customer's page (?panel=new-customer, ?panel=edit-customer&id=…).
 * After a save it closes, the page updates in place with the row (list) or
 * the Details card (`onRecord`) lit for 2 seconds, and a toast says so — with
 * Undo for a customer just added.
 */
export function CustomerPanel({
  action,
  undo,
  customer,
  currencies,
  onRecord,
}: {
  action: Action;
  /** Removes a customer just added (the toast's Undo). */
  undo?: (id: string) => Promise<ActionState>;
  customer: CustomerDetail | null;
  currencies: string[];
  /** Opened on the customer's own page (no "Open" in the toast). */
  onRecord?: boolean;
}) {
  const router = useRouter();
  const panel = useSidePanel(customer ? "edit-customer" : "new-customer");
  const saved = (s: ActionState) => {
    const d = s.data as { id: string; name: string } | undefined;
    if (!d) return panel.close();
    toast({
      message: customer ? `${d.name} saved` : `Customer ${d.name} added`,
      undo:
        !customer && undo
          ? async () => {
              await undo(d.id);
              router.refresh();
            }
          : undefined,
      // The list is by name: a new customer may be on another page. A new one's likely next step: an inquiry for them.
      actions: [
        ...(customer ? [] : [{ label: "New inquiry for them", href: `/inquiries?panel=new-inquiry&for=${d.id}` }]),
        ...(onRecord ? [] : [{ label: "Open", href: `/customers/${d.id}` }]),
      ],
    });
    panel.close({ saved: d.id });
  };
  return (
    <SidePanel
      title={customer ? `Edit customer · ${customer.name}` : "New customer"}
      description={
        customer ? "Removing a contact keeps them on past inquiries." : "Opens from Customers, and from “Customer → + New” on a new inquiry"
      }
      onClose={() => panel.close()}
      className={RULES.window.wideRows}
    >
      <CustomerForm action={action} customer={customer} currencies={currencies} inPanel onSaved={saved} />
    </SidePanel>
  );
}
