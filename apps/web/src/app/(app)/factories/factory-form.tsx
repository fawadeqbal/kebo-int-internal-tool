"use client";

import { Button, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelActions, PanelBody, PanelKeys, PanelSection, SidePanel, useClosePanel, useSidePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { Person } from "@/lib/types";
import type { Factory } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * A factory's details in the side panel's titled groups: Who, Contact, For
 * paying them, For the team. After an error the typed values stay
 * (s.values), otherwise the saved ones show.
 */
function FactoryForm({ action, factory, people, meId, onSaved }: { action: Action; factory: Factory | null; people: Person[]; meId: string; onSaved: (s: ActionState) => void }) {
  const close = useClosePanel();
  return (
    <ActionForm action={action} onDone={onSaved} showSuccess={false} className="flex min-h-0 flex-1 flex-col">
      {(s) => {
        const val = (k: keyof Factory) => s.values?.[k] ?? (factory?.[k] === null || factory?.[k] === undefined ? "" : String(factory[k]));
        const invalid = (k: string) => (s.errors?.[k] ? { "aria-invalid": true } : {});
        return (
          <PanelBody className={PANEL_FORM}>
            <PanelSection title="Who" first>
              <Field label="Factory name" htmlFor="name" error={s.errors?.name} hint="As it appears on their quotations and contracts">
                <Input id="name" name="name" defaultValue={val("name")} autoComplete="organization" {...invalid("name")} />
              </Field>
              <Field label="Looked after by" htmlFor="ownerId" optional error={s.errors?.ownerId} hint="Who in our team talks to this factory and pays it">
                <Select id="ownerId" name="ownerId" defaultValue={s.values?.ownerId ?? (factory ? (factory.ownerId ?? "") : meId)}>
                  <option value="">Nobody yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === meId ? `${p.name} (me)` : p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </PanelSection>
            <PanelSection title="Contact">
              <Field label="Contact person" htmlFor="contactPerson" optional error={s.errors?.contactPerson}>
                <Input id="contactPerson" name="contactPerson" defaultValue={val("contactPerson")} />
              </Field>
              <Field label="Phone" htmlFor="phone" optional error={s.errors?.phone} hint="With country code, e.g. +86 138 0000 0000">
                <Input id="phone" name="phone" type="tel" defaultValue={val("phone")} {...invalid("phone")} />
              </Field>
              <Field label="WeChat" htmlFor="wechat" optional error={s.errors?.wechat}>
                <Input id="wechat" name="wechat" defaultValue={val("wechat")} />
              </Field>
              <Field label="Email" htmlFor="email" optional error={s.errors?.email}>
                <Input id="email" name="email" type="email" defaultValue={val("email")} {...invalid("email")} />
              </Field>
            </PanelSection>
            <PanelSection title="For paying them" className="sm:grid-cols-1">
              <Field label="Address" htmlFor="address" optional error={s.errors?.address}>
                <Textarea id="address" name="address" rows={2} className="min-h-0" defaultValue={val("address")} />
              </Field>
              <Field label="Bank details" htmlFor="bankDetails" optional error={s.errors?.bankDetails} hint="Account name, bank, account number, for paying them">
                <Textarea id="bankDetails" name="bankDetails" rows={3} defaultValue={val("bankDetails")} />
              </Field>
            </PanelSection>
            <PanelSection title="For the team" className="sm:grid-cols-1">
              <Field label="Notes" htmlFor="notes" optional error={s.errors?.notes} hint="What they are good at, lead times, minimum orders…">
                <Textarea id="notes" name="notes" rows={3} defaultValue={val("notes")} />
              </Field>
            </PanelSection>
            <PanelActions className="max-md:[&>button:first-child]:flex-1">
              <SubmitButton pendingText="Saving…">{factory ? "Save changes" : "Add the factory"}</SubmitButton>
              <Button variant="ghost" onClick={close} className="max-md:hidden">
                Cancel
              </Button>
              <PanelKeys />
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
    toast({ message: factory ? `Saved · ${d.name}` : `Factory added · ${d.name}`, action: onRecord ? undefined : { label: "Open", href: `/factories/${d.id}` } });
    panel.close({ saved: d.id });
  };
  return (
    <SidePanel
      title={factory ? `Edit factory · ${factory.name}` : "New factory"}
      description={factory ? "Changes apply to new prices and orders; past ones keep what was agreed." : "Only the name is needed now; add the rest when you have it."}
      onClose={() => panel.close()}
    >
      <FactoryForm action={action} factory={factory} people={people} meId={meId} onSaved={saved} />
    </SidePanel>
  );
}
