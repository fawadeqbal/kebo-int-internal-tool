"use client";

import { useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { Alert, Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { AddButton } from "@/components/common/edit-button";
import { PANEL_FORM, PanelActions, PanelBody, PanelKeys, PanelSection, SidePanel, useClosePanel, useSidePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { Person } from "@/lib/types";
import type { Factory, FactoryContact } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** The visible boxes belong to no form: everything goes as JSON in `payload` (see the customer form). */
const DRAFT = "factory-draft";

type ContactDraft = { key: string; id: string | null; name: string; position: string; phone: string; wechat: string; email: string; isPrimary: boolean };
type Draft = { name: string; ownerId: string; address: string; bankBeneficiary: string; bankName: string; bankAccount: string; bankSwift: string; bankDetails: string; notes: string };

let seq = 0;
const blank = (isPrimary: boolean): ContactDraft => ({ key: `new-${++seq}`, id: null, name: "", position: "", phone: "", wechat: "", email: "", isPrimary });
const fromContact = (c: FactoryContact): ContactDraft => ({ key: c.id, id: c.id, name: c.name, position: c.position ?? "", phone: c.phone ?? "", wechat: c.wechat ?? "", email: c.email ?? "", isPrimary: c.isPrimary });

/**
 * A factory's details in the side panel's titled groups: Company, Contacts (several, one primary), Bank details,
 * Notes. After an error the typed values stay.
 */
function FactoryForm({ action, factory, people, meId, onSaved }: { action: Action; factory: (Factory & { contacts?: FactoryContact[] }) | null; people: Person[]; meId: string; onSaved: (s: ActionState) => void }) {
  const close = useClosePanel();
  const [draft, setDraft] = useState<Draft>(() => ({
    name: factory?.name ?? "",
    ownerId: factory ? (factory.ownerId ?? "") : meId,
    address: factory?.address ?? "",
    bankBeneficiary: factory?.bankBeneficiary ?? "",
    bankName: factory?.bankName ?? "",
    bankAccount: factory?.bankAccount ?? "",
    bankSwift: factory?.bankSwift ?? "",
    bankDetails: factory?.bankDetails ?? "",
    notes: factory?.notes ?? "",
  }));
  const [contacts, setContacts] = useState<ContactDraft[]>(() =>
    factory?.contacts?.length ? factory.contacts.map(fromContact) : factory?.contactPerson || factory?.phone || factory?.wechat || factory?.email
      ? [{ ...blank(true), name: factory.contactPerson ?? "", phone: factory.phone ?? "", wechat: factory.wechat ?? "", email: factory.email ?? "" }]
      : [],
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setContact = (key: string, patch: Partial<ContactDraft>) => setContacts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const makePrimary = (key: string) => setContacts((cs) => cs.map((c) => ({ ...c, isPrimary: c.key === key })));
  const remove = (key: string) =>
    setContacts((cs) => {
      const left = cs.filter((c) => c.key !== key);
      return left.length && !left.some((c) => c.isPrimary) ? left.map((c, i) => ({ ...c, isPrimary: i === 0 })) : left;
    });
  const payload = JSON.stringify({ ...draft, ownerId: draft.ownerId || null, contacts: contacts.map(({ key: _k, ...c }) => c) });

  return (
    <ActionForm action={action} onDone={onSaved} showSuccess={false} className="flex min-h-0 flex-1 flex-col">
      {(s) => {
        const err = (k: string) => s.errors?.[k];
        const invalid = (k: string) => (s.errors?.[k] ? { "aria-invalid": true } : {});
        return (
          <PanelBody className={PANEL_FORM}>
            <input type="hidden" name="payload" value={payload} />
            <PanelSection title="Company" first>
              <Field label="Factory name" htmlFor="name" error={err("name")} hint="As on their supplier quotes and contracts">
                <Input form={DRAFT} id="name" value={draft.name} onChange={(e) => set("name", e.target.value)} autoComplete="organization" {...invalid("name")} />
              </Field>
              <Field label="Handled by" htmlFor="ownerId" optional error={err("ownerId")}>
                <Select form={DRAFT} id="ownerId" value={draft.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
                  <option value="">Nobody yet</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === meId ? `${p.name} (me)` : p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Address" htmlFor="address" optional error={err("address")} className="sm:col-span-2">
                <Textarea form={DRAFT} id="address" rows={2} className="min-h-0" value={draft.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
            </PanelSection>

            <div role="group" aria-labelledby="factory-contacts" className="flex min-w-0 flex-col gap-3 border-t border-line pt-5">
              <div className="flex items-center justify-between gap-2">
                <h3 id="factory-contacts" className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                  Contacts
                </h3>
                {contacts.length < 20 && <AddButton label="Add contact" onClick={() => setContacts((cs) => [...cs, blank(cs.length === 0)])} />}
              </div>
              {err("contacts") && <Alert tone="error">{err("contacts")![0]}</Alert>}
              {contacts.length === 0 && <p className="text-sm text-muted">No contacts yet.</p>}
              {contacts.map((c, i) => {
                const fid = (k: string) => `fc-${c.key}-${k}`;
                return (
                  <fieldset key={c.key} className={cn("rounded-lg border border-line p-3", c.isPrimary && "border-primary/40")}>
                    <legend className="sr-only">Contact {i + 1}</legend>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{c.name.trim() || `Contact ${i + 1}`}</span>
                      <span className="flex items-center gap-1">
                        {c.isPrimary ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                            <Star aria-hidden className="size-3 fill-current" /> Primary
                          </span>
                        ) : (
                          <Button size="xs" variant="ghost" onClick={() => makePrimary(c.key)}>
                            Make primary
                          </Button>
                        )}
                        <Button size="xs" variant="danger-ghost" onClick={() => remove(c.key)} aria-label={`Delete ${c.name || `contact ${i + 1}`}`}>
                          <Trash2 aria-hidden />
                        </Button>
                      </span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Name" htmlFor={fid("name")} error={err(`contacts.${i}.name`)}>
                        <Input form={DRAFT} id={fid("name")} value={c.name} onChange={(e) => setContact(c.key, { name: e.target.value })} />
                      </Field>
                      <Field label="Position" htmlFor={fid("position")} optional>
                        <Input form={DRAFT} id={fid("position")} value={c.position} onChange={(e) => setContact(c.key, { position: e.target.value })} />
                      </Field>
                      <Field label="Phone" htmlFor={fid("phone")} optional error={err(`contacts.${i}.phone`)} hint="With country code, e.g. +86 138 0000 0000">
                        <Input form={DRAFT} id={fid("phone")} type="tel" value={c.phone} onChange={(e) => setContact(c.key, { phone: e.target.value })} />
                      </Field>
                      <Field label="WeChat" htmlFor={fid("wechat")} optional>
                        <Input form={DRAFT} id={fid("wechat")} value={c.wechat} onChange={(e) => setContact(c.key, { wechat: e.target.value })} />
                      </Field>
                      <Field label="Email" htmlFor={fid("email")} optional error={err(`contacts.${i}.email`)} className="sm:col-span-2">
                        <Input form={DRAFT} id={fid("email")} type="email" value={c.email} onChange={(e) => setContact(c.key, { email: e.target.value })} />
                      </Field>
                    </div>
                  </fieldset>
                );
              })}
            </div>

            <PanelSection title="Bank details">
              <Field label="Beneficiary" htmlFor="bankBeneficiary" optional error={err("bankBeneficiary")}>
                <Input form={DRAFT} id="bankBeneficiary" value={draft.bankBeneficiary} onChange={(e) => set("bankBeneficiary", e.target.value)} />
              </Field>
              <Field label="Bank" htmlFor="bankName" optional error={err("bankName")}>
                <Input form={DRAFT} id="bankName" value={draft.bankName} onChange={(e) => set("bankName", e.target.value)} />
              </Field>
              <Field label="Account number" htmlFor="bankAccount" optional error={err("bankAccount")}>
                <Input form={DRAFT} id="bankAccount" value={draft.bankAccount} onChange={(e) => set("bankAccount", e.target.value)} {...invalid("bankAccount")} />
              </Field>
              <Field label="SWIFT" htmlFor="bankSwift" optional error={err("bankSwift")}>
                <Input form={DRAFT} id="bankSwift" value={draft.bankSwift} onChange={(e) => set("bankSwift", e.target.value)} {...invalid("bankSwift")} />
              </Field>
              <Field label="Other bank details" htmlFor="bankDetails" optional error={err("bankDetails")} className="sm:col-span-2">
                <Textarea form={DRAFT} id="bankDetails" rows={2} className="min-h-0" value={draft.bankDetails} onChange={(e) => set("bankDetails", e.target.value)} />
              </Field>
            </PanelSection>

            <PanelSection title="Notes about them" className="sm:grid-cols-1">
              <Field label="Notes" htmlFor="notes" optional error={err("notes")}>
                <Textarea form={DRAFT} id="notes" rows={3} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </PanelSection>
            <PanelActions className="max-md:[&>button:first-child]:flex-1">
              <SubmitButton pendingText="Saving…">{factory ? "Save" : "Create factory"}</SubmitButton>
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
 * "New factory" (over the list, ?panel=new-factory) and "Edit factory · name" (over the list or the factory's
 * page, ?panel=edit-factory&id=…) in the side panel. After a save it closes and a toast says so.
 */
export function FactoryPanel({
  action,
  factory,
  people,
  meId,
  onRecord,
}: {
  action: Action;
  factory: (Factory & { contacts?: FactoryContact[] }) | null;
  people: Person[];
  meId: string;
  /** Opened on the factory's own page (no "Open" in the toast). */
  onRecord?: boolean;
}) {
  const panel = useSidePanel(factory ? "edit-factory" : "new-factory");
  const saved = (s: ActionState) => {
    const d = s.data as { id: string; name: string } | undefined;
    if (!d) return panel.close();
    toast({ message: factory ? "Saved." : `Factory ${d.name} created.`, action: onRecord ? undefined : { label: "Open", href: `/factories/${d.id}` } });
    panel.close({ saved: d.id });
  };
  return (
    <SidePanel title={factory ? `Edit factory · ${factory.name}` : "New factory"} onClose={() => panel.close()}>
      <FactoryForm action={action} factory={factory} people={people} meId={meId} onSaved={saved} />
    </SidePanel>
  );
}
