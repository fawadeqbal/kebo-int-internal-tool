"use client";

import { Button, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelActions, PanelBody, SidePanel, useClosePanel, useSidePanel } from "@/components/common/panel";
import { Check } from "lucide-react";
import type { ActionState } from "@/lib/actions";
import type { Person } from "@/lib/types";
import type { Factory } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A factory's details in the side panel's titled groups: Who, Contact, For
 * paying them, For the team. After an error the typed values stay
 * (s.values), otherwise the saved ones show.
 */
function FactoryForm({
  action,
  factory,
  people,
  meId,
  onSaved,
}: {
  action: Action;
  factory: Factory | null;
  people: Person[];
  meId: string;
  onSaved: (s: ActionState) => void;
}) {
  const close = useClosePanel();
  return (
    <ActionForm action={action} onDone={onSaved} showSuccess={false} className="flex min-h-0 flex-1 flex-col">
      {(s) => {
        const val = (k: keyof Factory) => s.values?.[k] ?? (factory?.[k] === null || factory?.[k] === undefined ? "" : String(factory[k]));
        const invalid = (k: string) => (s.errors?.[k] ? { "aria-invalid": true } : {});
        return (
          <PanelBody className={PANEL_FORM}>
            {/* Board "New supplier window": three columns. */}
            <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
              <Field label="Factory name" required htmlFor="name" error={s.errors?.name} className="sm:col-span-2">
                <Input id="name" name="name" defaultValue={val("name")} autoComplete="organization" {...invalid("name")} />
              </Field>
              <Field label="Owner" htmlFor="ownerId" error={s.errors?.ownerId}>
                <Select id="ownerId" name="ownerId" defaultValue={s.values?.ownerId ?? (factory ? (factory.ownerId ?? "") : meId)}>
                  <option value="">Nobody yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Contact person" htmlFor="contactPerson" error={s.errors?.contactPerson}>
                <Input id="contactPerson" name="contactPerson" defaultValue={val("contactPerson")} />
              </Field>
              <Field label="Phone" htmlFor="phone" error={s.errors?.phone}>
                <Input id="phone" name="phone" type="tel" defaultValue={val("phone")} {...invalid("phone")} />
              </Field>
              <Field label="WeChat" htmlFor="wechat" error={s.errors?.wechat}>
                <Input id="wechat" name="wechat" defaultValue={val("wechat")} />
              </Field>
              <Field label="Email" htmlFor="email" error={s.errors?.email}>
                <Input id="email" name="email" type="email" defaultValue={val("email")} {...invalid("email")} />
              </Field>
              <Field label="Address" htmlFor="address" error={s.errors?.address} className="sm:col-span-2">
                <Input id="address" name="address" defaultValue={val("address")} />
              </Field>
              <Field label="Bank details" htmlFor="bankDetails" error={s.errors?.bankDetails} className="sm:col-span-3">
                <Textarea
                  id="bankDetails"
                  name="bankDetails"
                  rows={3}
                  placeholder="Bank, account no., SWIFT — printed on the purchase order"
                  defaultValue={val("bankDetails")}
                />
              </Field>
              <Field label="Notes" htmlFor="notes" error={s.errors?.notes} className="sm:col-span-3">
                <Textarea id="notes" name="notes" rows={3} defaultValue={val("notes")} />
              </Field>
            </div>
            <PanelActions className="justify-end">
              <Button variant="ghost" onClick={close} className="max-md:hidden">
                Cancel
              </Button>
              <SubmitButton pendingText="Saving…">
                <Check aria-hidden /> {factory ? "Save changes" : "Save supplier"}
              </SubmitButton>
            </PanelActions>
          </PanelBody>
        );
      }}
    </ActionForm>
  );
}

/**
 * "New factory" (over the list, ?panel=new-factory) and "Edit factory · name"
 * (over the list or the factory's page, ?panel=edit-factory&id=…) in the side
 * panel. After a save it closes, the page updates in place with the row or
 * the Details card lit for 2 seconds, and a toast says so.
 */
export function FactoryPanel({
  action,
  factory,
  people,
  meId,
  onRecord,
}: {
  action: Action;
  factory: Factory | null;
  people: Person[];
  meId: string;
  /** Opened on the factory's own page (no "Open" in the toast). */
  onRecord?: boolean;
}) {
  const panel = useSidePanel(factory ? "edit-factory" : "new-factory");
  const saved = (s: ActionState) => {
    const d = s.data as { id: string; name: string } | undefined;
    if (!d) return panel.close();
    toast({
      message: factory ? `Saved · ${d.name}` : `Supplier added · ${d.name}`,
      action: onRecord ? undefined : { label: "Open", href: `/factories/${d.id}` },
    });
    panel.close({ saved: d.id });
  };
  return (
    <SidePanel
      title={factory ? `Edit supplier · ${factory.name}` : "New supplier"}
      description={
        factory
          ? "Changes apply to new prices and orders; past ones keep what was agreed."
          : "Opens from Suppliers, from “Ask factories”, and from “Factory → + New” when entering an offer"
      }
      onClose={() => panel.close()}
      className="md:w-[900px]"
    >
      <FactoryForm action={action} factory={factory} people={people} meId={meId} onSaved={saved} />
    </SidePanel>
  );
}
