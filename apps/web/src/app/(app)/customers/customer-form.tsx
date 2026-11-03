"use client";

import { useState } from "react";
import Link from "next/link";
import { Star, Trash2 } from "lucide-react";
import { CUSTOMER_TYPE_LABEL, CUSTOMER_TYPES, customerLetters, UNKNOWN_COUNTRY, type CustomerType, CURRENCY_LABEL } from "@kebo/shared";
import { Alert, Banner, Button, buttonClass, Card, CardBody, CardFooter, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { AddButton } from "@/components/common/edit-button";
import { PANEL_FORM, PanelActions, PanelBody, PanelKeys, PanelSection, useClosePanel } from "@/components/common/panel";
import { CountrySelect } from "@/components/people/country-select";
import type { ActionState } from "@/lib/actions";
import type { Contact, CustomerDetail } from "@/lib/types-people";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Everything is sent as JSON in `payload`, so the visible boxes belong to no
 * form (`form` names one that does not exist). That keeps React's automatic
 * form reset after each submit from putting the selects back to their first option.
 */
const DRAFT = "customer-draft";

type ContactDraft = { key: string; id: string | null; name: string; position: string; email: string; phone: string; whatsapp: string; wechat: string; isPrimary: boolean };
type Draft = { type: CustomerType; name: string; country: string; address: string; taxNo: string; regNo: string; initials: string; defaultCurrency: string; notes: string };

let seq = 0;
const newKey = () => `new-${++seq}`;
const blankContact = (isPrimary: boolean): ContactDraft => ({ key: newKey(), id: null, name: "", position: "", email: "", phone: "", whatsapp: "", wechat: "", isPrimary });
const fromContact = (c: Contact): ContactDraft => ({
  key: c.id,
  id: c.id,
  name: c.name,
  position: c.position ?? "",
  email: c.email ?? "",
  phone: c.phone ?? "",
  whatsapp: c.whatsapp ?? "",
  wechat: c.wechat ?? "",
  isPrimary: c.isPrimary,
});

/** The field a server error key points at ("contacts.1.email" → the second contact's email box). */
const fieldId = (key: string, contacts: ContactDraft[]) => {
  const m = /^contacts\.(\d+)\.(\w+)$/.exec(key);
  if (m) return contacts[Number(m[1])] ? `contact-${contacts[Number(m[1])]!.key}-${m[2]}` : null;
  return ["type", "name", "country", "address", "taxNo", "regNo", "initials", "defaultCurrency", "notes"].includes(key) ? key : null;
};

/**
 * Customer details and their contacts (add, remove, one primary), in the side
 * panel's titled groups: Who, Contacts, For papers, For the team. Existing
 * contacts keep their ids: deals point at them. In the panel (`inPanel`) Save
 * and Cancel are its pinned footer and a save hands the result to `onSaved`;
 * on the old edit page they sit at the bottom of the card.
 */
export function CustomerForm({
  action,
  customer,
  currencies,
  cancelHref,
  inPanel,
  onSaved,
}: {
  action: Action;
  customer: CustomerDetail | null;
  currencies: string[];
  cancelHref?: string;
  inPanel?: boolean;
  onSaved?: (state: ActionState) => void;
}) {
  const close = useClosePanel();
  const [draft, setDraft] = useState<Draft>(() => ({
    type: customer?.type ?? "company",
    name: customer?.name ?? "",
    country: customer?.country ?? UNKNOWN_COUNTRY,
    address: customer?.address ?? "",
    taxNo: customer?.taxNo ?? "",
    regNo: customer?.regNo ?? "",
    initials: customer?.initials ?? "",
    defaultCurrency: customer?.defaultCurrency ?? currencies[0] ?? "USD",
    notes: customer?.notes ?? "",
  }));
  const [contacts, setContacts] = useState<ContactDraft[]>(() => (customer?.contacts.length ? customer.contacts.map(fromContact) : [blankContact(true)]));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setContact = (key: string, patch: Partial<ContactDraft>) => setContacts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const makePrimary = (key: string) => setContacts((cs) => cs.map((c) => ({ ...c, isPrimary: c.key === key })));
  const remove = (key: string) =>
    setContacts((cs) => {
      const left = cs.filter((c) => c.key !== key);
      return left.length && !left.some((c) => c.isPrimary) ? left.map((c, i) => ({ ...c, isPrimary: i === 0 })) : left;
    });

  const payload = JSON.stringify({
    ...draft,
    contacts: contacts.map(({ key: _key, ...c }) => c),
  });
  const currencyOptions = currencies.includes(draft.defaultCurrency) ? currencies : [draft.defaultCurrency, ...currencies];
  const save = customer ? "Save changes" : "Add the customer";

  const form = (s: ActionState) => {
    const problems = Object.entries(s.errors ?? {})
      .filter(([, v]) => v?.length)
      .map(([k, v]) => ({ key: k, to: fieldId(k, contacts), text: v![0]! }));
    /** Its error, wired to the box for screen readers. */
    const invalid = (id: string, error: unknown) => (error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {});
    return (
      <>
        <input type="hidden" name="payload" value={payload} />
        {inPanel && <input type="hidden" name="inPanel" value="1" />}
        {/* Errors next to each field, and all of them here at the top after a save. */}
        {problems.length > 1 && (
          <Banner meaning="bad">
            <p className="font-medium">Check {problems.length} things before saving:</p>
            <ul className="mt-1 list-disc pl-4">
              {problems.map((p) => (
                <li key={p.key}>{p.to ? <a href={`#${p.to}`} className="underline underline-offset-2">{p.text}</a> : p.text}</li>
              ))}
            </ul>
          </Banner>
        )}

        <PanelSection title="Who" first>
          <Field label="Company or person's name" htmlFor="name" error={s.errors?.name}>
            <Input form={DRAFT} id="name" value={draft.name} onChange={(e) => set("name", e.target.value)} autoComplete="organization" {...invalid("name", s.errors?.name)} />
          </Field>
          <Field label="Type" htmlFor="type" error={s.errors?.type}>
            <Select form={DRAFT} id="type" value={draft.type} onChange={(e) => set("type", e.target.value as CustomerType)}>
              {CUSTOMER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CUSTOMER_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Country"
            htmlFor="country"
            error={s.errors?.country}
            hint={draft.country === UNKNOWN_COUNTRY ? <span className="text-warn">Set it as soon as you know: it decides shipping.</span> : "Where the goods are shipped to"}
          >
            <CountrySelect form={DRAFT} id="country" value={draft.country} onChange={(e) => set("country", e.target.value)} {...invalid("country", s.errors?.country)} />
          </Field>
          <Field label="Currency they pay in" htmlFor="defaultCurrency" error={s.errors?.defaultCurrency} hint="New quotations for them start in it">
            <Select form={DRAFT} id="defaultCurrency" value={draft.defaultCurrency} onChange={(e) => set("defaultCurrency", e.target.value)}>
              {currencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c in CURRENCY_LABEL ? ` · ${CURRENCY_LABEL[c as keyof typeof CURRENCY_LABEL]}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </PanelSection>

        <div role="group" aria-labelledby="contacts-title" className="flex min-w-0 flex-col gap-3 border-t border-line pt-5">
          <div className="-my-1 flex items-center justify-between gap-2">
            <h3 id="contacts-title" className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              Contacts
            </h3>
            {contacts.length < 20 && <AddButton label="Add a contact" onClick={() => setContacts((cs) => [...cs, blankContact(cs.length === 0)])} />}
          </div>
          {s.errors?.contacts && !Object.keys(s.errors).some((k) => k.startsWith("contacts.")) && <Alert tone="error">{s.errors.contacts[0]}</Alert>}
          {contacts.length === 0 && <p className="text-sm text-muted">No contacts. Add at least one person you can reach.</p>}
          {contacts.map((c, i) => {
            const err = (f: string) => s.errors?.[`contacts.${i}.${f}`];
            const fid = (f: string) => `contact-${c.key}-${f}`;
            return (
              <fieldset key={c.key} className={cn("min-w-0 rounded-lg border p-3", c.isPrimary ? "border-primary/40 bg-primary-soft/30" : "border-line")}>
                <legend className="sr-only">Contact {i + 1}</legend>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {c.name.trim() || `Contact ${i + 1}`}
                    {c.id === null && customer && <span className="ml-2 text-xs font-normal text-muted">new</span>}
                  </p>
                  <div className="flex items-center gap-1">
                    {c.isPrimary ? (
                      <span className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary">
                        <Star className="size-3.5 fill-current" aria-hidden /> Primary
                      </span>
                    ) : (
                      <Button size="xs" variant="ghost" onClick={() => makePrimary(c.key)}>
                        <Star aria-hidden /> Make primary
                      </Button>
                    )}
                    {contacts.length > 1 && (
                      <Button size="xs" variant="danger-ghost" onClick={() => remove(c.key)} aria-label={`Remove ${c.name || `contact ${i + 1}`}`}>
                        <Trash2 aria-hidden /> Remove
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-x-3 gap-y-3.5 sm:grid-cols-2">
                  <Field label="Name" htmlFor={fid("name")} error={err("name")}>
                    <Input form={DRAFT} id={fid("name")} value={c.name} onChange={(e) => setContact(c.key, { name: e.target.value })} {...invalid(fid("name"), err("name"))} />
                  </Field>
                  <Field label="Position" htmlFor={fid("position")} optional error={err("position")}>
                    <Input form={DRAFT} id={fid("position")} value={c.position} onChange={(e) => setContact(c.key, { position: e.target.value })} placeholder="e.g. Purchasing manager" />
                  </Field>
                  <Field label="Email" htmlFor={fid("email")} optional error={err("email")}>
                    <Input form={DRAFT} id={fid("email")} type="email" value={c.email} onChange={(e) => setContact(c.key, { email: e.target.value })} {...invalid(fid("email"), err("email"))} />
                  </Field>
                  <Field label="Phone" htmlFor={fid("phone")} optional error={err("phone")} hint="With country code, e.g. +92 300 1234567">
                    <Input form={DRAFT} id={fid("phone")} type="tel" value={c.phone} onChange={(e) => setContact(c.key, { phone: e.target.value })} {...invalid(fid("phone"), err("phone"))} />
                  </Field>
                  <Field label="WhatsApp" htmlFor={fid("whatsapp")} optional error={err("whatsapp")}>
                    <Input form={DRAFT} id={fid("whatsapp")} type="tel" value={c.whatsapp} onChange={(e) => setContact(c.key, { whatsapp: e.target.value })} />
                  </Field>
                  <Field label="WeChat" htmlFor={fid("wechat")} optional error={err("wechat")}>
                    <Input form={DRAFT} id={fid("wechat")} value={c.wechat} onChange={(e) => setContact(c.key, { wechat: e.target.value })} />
                  </Field>
                </div>
              </fieldset>
            );
          })}
          <p className="text-xs text-muted">Give each contact at least one way to reach them: email, phone, WhatsApp or WeChat.</p>
        </div>

        <PanelSection title="For papers">
          <Field label="Address on papers" htmlFor="address" optional error={s.errors?.address} hint="Printed on the contract and invoices" className="sm:col-span-2">
            <Textarea form={DRAFT} id="address" rows={2} className="min-h-0" value={draft.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="Business license number" htmlFor="taxNo" optional error={s.errors?.taxNo} hint="On the proforma invoice when given">
            <Input form={DRAFT} id="taxNo" value={draft.taxNo} onChange={(e) => set("taxNo", e.target.value)} />
          </Field>
          <Field label="Reg. number" htmlFor="regNo" optional error={s.errors?.regNo} hint="On the proforma invoice when given">
            <Input form={DRAFT} id="regNo" value={draft.regNo} onChange={(e) => set("regNo", e.target.value)} />
          </Field>
          <Field
            label="Letters on documents"
            htmlFor="initials"
            optional
            error={s.errors?.initials}
            hint={`In proforma numbers. Empty: from the name (${customerLetters(draft.name || "Customer")}).`}
          >
            <Input
              form={DRAFT}
              id="initials"
              value={draft.initials}
              maxLength={6}
              className="w-28 uppercase"
              placeholder={customerLetters(draft.name || "Customer")}
              onChange={(e) => set("initials", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
              {...invalid("initials", s.errors?.initials)}
            />
          </Field>
        </PanelSection>

        <PanelSection title="For the team" className="sm:grid-cols-1">
          <Field label="Notes" htmlFor="notes" optional error={s.errors?.notes} hint="Only the team sees these">
            <Textarea form={DRAFT} id="notes" rows={3} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </PanelSection>

        {s.code === "duplicate" && s.matches?.length ? (
          <Alert tone="warning">
            <p className="font-medium">This may be a customer you already have.</p>
            <p className="mt-0.5 text-text-2">These customers share an email or phone number with the contacts above. Open one to use it instead, or save anyway if they really are different.</p>
            <ul className="mt-2 flex flex-col gap-1">
              {s.matches.map((m) => (
                <li key={m.id}>
                  <Link href={`/customers/${m.id}`} target="_blank" className="font-medium text-primary hover:underline">
                    {m.label}
                  </Link>
                  {m.detail && <span className="text-text-2"> · {m.detail}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <SubmitButton size="sm" variant="secondary" name="allowDuplicate" value="true" pendingText="Saving…">
                Save anyway
              </SubmitButton>
            </div>
          </Alert>
        ) : null}
      </>
    );
  };

  if (inPanel)
    return (
      <ActionForm action={action} onDone={onSaved} showSuccess={false} keepFields className="flex min-h-0 flex-1 flex-col">
        {(s) => (
          <PanelBody className={PANEL_FORM}>
            {form(s)}
            <PanelActions className="max-md:[&>button:first-child]:flex-1">
              <SubmitButton pendingText="Saving…">{save}</SubmitButton>
              <Button variant="ghost" onClick={close} className="max-md:hidden">
                Cancel
              </Button>
              <PanelKeys />
            </PanelActions>
          </PanelBody>
        )}
      </ActionForm>
    );
  return (
    <ActionForm action={action} keepFields>
      {(s) => (
        <Card>
          <CardBody className="flex flex-col gap-5">{form(s)}</CardBody>
          <CardFooter>
            {cancelHref && (
              <Link href={cancelHref} className={buttonClass("ghost")}>
                Cancel
              </Link>
            )}
            <SubmitButton pendingText="Saving…">{save}</SubmitButton>
          </CardFooter>
        </Card>
      )}
    </ActionForm>
  );
}
