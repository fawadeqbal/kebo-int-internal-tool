"use client";

import { useRouter } from "next/navigation";
import { toast } from "@kebo/ui/client";
import { SidePanel, useSidePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { CustomerDetail } from "@/lib/types-people";
import { CustomerForm } from "./customer-form";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * "New customer" and "Edit customer · name" in the side panel over the list
 * (?panel=new-customer, ?panel=edit-customer&id=…). After a save it closes,
 * the list updates in place with the row lit for 2 seconds, and a toast says
 * so — with Undo for a customer just added.
 */
export function CustomerPanel({
  action,
  undo,
  customer,
  currencies,
}: {
  action: Action;
  /** Removes a customer just added (the toast's Undo). */
  undo?: (id: string) => Promise<ActionState>;
  customer: CustomerDetail | null;
  currencies: string[];
}) {
  const router = useRouter();
  const panel = useSidePanel(customer ? "edit-customer" : "new-customer");
  const saved = (s: ActionState) => {
    const d = s.data as { id: string; name: string } | undefined;
    if (!d) return panel.close();
    toast({
      message: customer ? `Saved · ${d.name}` : `Customer added · ${d.name}`,
      undo:
        !customer && undo
          ? async () => {
              await undo(d.id);
              router.refresh();
            }
          : undefined,
    });
    panel.close({ saved: d.id });
  };
  return (
    <SidePanel
      title={customer ? `Edit customer · ${customer.name}` : "New customer"}
      description={customer ? "Removing a contact keeps them on past inquiries." : "The rest can be added later."}
      onClose={() => panel.close()}
    >
      <CustomerForm action={action} customer={customer} currencies={currencies} inPanel onSaved={saved} />
    </SidePanel>
  );
}
