"use client";

import { ChoiceChips } from "@/components/common/choice-chips";
import { useState } from "react";
import Link from "next/link";
import { Building2, MapPin, Trash2, Users } from "lucide-react";
import { PARTY_TYPE_LABEL, PARTY_TYPES, customerLetters, UNKNOWN_COUNTRY, type PartyType } from "@kebo/shared";
import { Button, Checkbox, cn, Field, Input, Select, Textarea, Notice } from "@kebo/ui";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelBody } from "@/components/common/panel";
import { JumpToStep, StepsFooter, StepsFrame } from "@/components/common/steps-frame";
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

type ContactDraft = {
  key: string;
  id: string | null;
  name: string;
  position: string;
  email: string;
  phone: string;
  whatsapp: string;
  wechat: string;
  isPrimary: boolean;
};
type Draft = {
  type: PartyType;
  name: string;
  country: string;
  address: string;
  taxNo: string;
  regNo: string;
  initials: string;
  defaultCurrency: string;
  notes: string;
};

let seq = 0;
const newKey = () => `new-${++seq}`;
const blankContact = (isPrimary: boolean): ContactDraft => ({
  key: newKey(),
  id: null,
  name: "",
  position: "",
  email: "",
  phone: "",
  whatsapp: "",
  wechat: "",
  isPrimary,
});
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
type CustomerStep = "company" | "details" | "contacts";
const CUSTOMER_STEPS: { key: CustomerStep; label: string; icon: typeof Building2 }[] = [
  { key: "company", label: "Who they are", icon: Building2 },
  { key: "details", label: "Address and tax", icon: MapPin },
  { key: "contacts", label: "Contacts", icon: Users },
];
const DETAIL_KEYS = new Set(["taxNo", "address", "regNo", "notes"]);
/** The step of a refused field: its details, its contacts, or who they are. */
const stepOfField = (k: string): CustomerStep => (k.startsWith("contacts") ? "contacts" : DETAIL_KEYS.has(k) ? "details" : "company");

export function CustomerForm({
  action,
  customer,
  currencies,
  inPanel,
  onSaved,
}: {
  action: Action;
  customer: CustomerDetail | null;
  currencies: string[];
  inPanel?: boolean;
  onSaved?: (state: ActionState) => void;
}) {
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
  const [contacts, setContacts] = useState<ContactDraft[]>(() =>
    customer?.contacts.length ? customer.contacts.map(fromContact) : [blankContact(true)],
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setContact = (key: string, patch: Partial<ContactDraft>) =>
    setContacts((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
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

  const form = (s: ActionState) => {
    /** Its error, wired to the box for screen readers. */
    const invalid = (id: string, error: unknown) => (error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {});
    // Three parts, so steps (design rule 1): who they are, the details, the people (canvas board "Making a record").
    return {
      company: (
        <>
          <ChoiceChips label="Type" value={draft.type} options={PARTY_TYPES} labels={PARTY_TYPE_LABEL} onChange={(v) => set("type", v)} />
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
            <Field label="Name" required htmlFor="name" error={s.errors?.name} className="sm:col-span-2">
              <Input
                form={DRAFT}
                id="name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                autoComplete="organization"
                {...invalid("name", s.errors?.name)}
              />
            </Field>
            <Field
              label="Initials on documents"
              htmlFor="initials"
              error={s.errors?.initials}
              hint={`1–6 letters. Empty: ${customerLetters(draft.name || "Customer")}`}
            >
              <Input
                form={DRAFT}
                id="initials"
                value={draft.initials}
                maxLength={6}
                className="uppercase"
                placeholder={customerLetters(draft.name || "Customer")}
                onChange={(e) => set("initials", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                {...invalid("initials", s.errors?.initials)}
              />
            </Field>
            <Field
              label="Country"
              htmlFor="country"
              error={s.errors?.country}
              hint={
                draft.country === UNKNOWN_COUNTRY ? (
                  <span className="text-warn">Set it as soon as you know: it decides shipping.</span>
                ) : undefined
              }
            >
              <CountrySelect id="country" value={draft.country} onChange={(code) => set("country", code)} invalid={!!s.errors?.country} />
            </Field>
            <Field label="Default currency" htmlFor="defaultCurrency" error={s.errors?.defaultCurrency}>
              <Select
                form={DRAFT}
                id="defaultCurrency"
                value={draft.defaultCurrency}
                onChange={(e) => set("defaultCurrency", e.target.value)}
              >
                {currencyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {s.code === "duplicate" && s.matches?.length ? (
            <>
              <Notice tone="todo">
                <strong>Possible duplicate.</strong> A customer with the same email or phone exists:{" "}
                {s.matches.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ", "}
                    <Link href={`/customers/${m.id}`} target="_blank" className="font-bold underline-offset-2 hover:underline">
                      {m.label}
                    </Link>
                    {m.detail && ` (${m.detail})`}
                  </span>
                ))}
                . Open it, or tick “Save anyway”.
              </Notice>
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox name="allowDuplicate" value="true" />
                Save anyway — this is a different {draft.type === "company" ? "company" : "person"}
              </label>
            </>
          ) : null}
        </>
      ),
      details: (
        <>
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
            <Field label="Tax no." htmlFor="taxNo" error={s.errors?.taxNo}>
              <Input form={DRAFT} id="taxNo" value={draft.taxNo} onChange={(e) => set("taxNo", e.target.value)} />
            </Field>
            <Field label="Address" htmlFor="address" error={s.errors?.address} className="sm:col-span-2">
              <Input form={DRAFT} id="address" value={draft.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="Registration no." htmlFor="regNo" error={s.errors?.regNo}>
              <Input form={DRAFT} id="regNo" value={draft.regNo} onChange={(e) => set("regNo", e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="notes" error={s.errors?.notes}>
            <Textarea
              form={DRAFT}
              id="notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </>
      ),
      contacts: <>

          <div role="group" aria-labelledby="contacts-title" className="flex min-w-0 flex-col gap-3">
            {/* The step is already named Contacts: the heading is for screen readers only (not said twice). */}
            <h3 id="contacts-title" className="sr-only">
              Contacts
            </h3>
            {s.errors?.contacts && !Object.keys(s.errors).some((k) => k.startsWith("contacts.")) && (
              <Notice tone="bad">{s.errors.contacts[0]}</Notice>
            )}
            <div className="scroll-x">
              <table className="w-full text-md">
                <thead className="bg-faint text-left text-text-2">
                  <tr>
                    <th className="w-[22%] px-2 py-2.5 font-semibold">
                      Name <span className="text-bad">*</span>
                    </th>
                    <th className="px-2 py-2.5 font-semibold">Position</th>
                    <th className="px-2 py-2.5 font-semibold">Email</th>
                    <th className="px-2 py-2.5 font-semibold">Phone</th>
                    <th className="px-2 py-2.5 font-semibold">WhatsApp</th>
                    <th className="px-2 py-2.5 font-semibold">WeChat</th>
                    <th className="w-[70px] px-2 py-2.5 text-center font-semibold">Primary</th>
                    <th className="w-10">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c, i) => {
                    const err = (f: string) => s.errors?.[`contacts.${i}.${f}`];
                    const fid = (f: string) => `contact-${c.key}-${f}`;
                    const cell = (f: "name" | "position" | "email" | "phone" | "whatsapp" | "wechat", label: string, type = "text") => (
                      <td className="px-2 py-2 align-top">
                        <Input
                          form={DRAFT}
                          id={fid(f)}
                          type={type}
                          aria-label={`${label}, contact ${i + 1}`}
                          placeholder={f === "name" ? undefined : label}
                          value={c[f]}
                          onChange={(e) => setContact(c.key, { [f]: e.target.value })}
                          {...invalid(fid(f), err(f))}
                        />
                        {err(f) && (
                          <span id={`${fid(f)}-error`} className="mt-1 block text-xs text-bad">
                            {err(f)![0]}
                          </span>
                        )}
                      </td>
                    );
                    return (
                      <tr key={c.key} className="border-t border-surface-2">
                        {cell("name", "Name")}
                        {cell("position", "Position")}
                        {cell("email", "Email", "email")}
                        {cell("phone", "Phone", "tel")}
                        {cell("whatsapp", "WhatsApp", "tel")}
                        {cell("wechat", "WeChat")}
                        <td className="px-2 py-2 text-center align-middle">
                          <input
                            type="radio"
                            name="primary-contact"
                            form={DRAFT}
                            aria-label={`Primary: contact ${i + 1}`}
                            checked={c.isPrimary}
                            onChange={() => makePrimary(c.key)}
                            className="size-4 accent-primary-solid"
                          />
                        </td>
                        <td className="px-1 py-2 align-middle">
                          {contacts.length > 1 && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => remove(c.key)}
                              aria-label={`Remove ${c.name || `contact ${i + 1}`}`}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {contacts.length < 20 && (
              <Button size="sm" className="self-start" onClick={() => setContacts((cs) => [...cs, blankContact(cs.length === 0)])}>
                + Add contact
              </Button>
            )}
            <p className="text-xs text-muted">Give each contact at least one way to reach them: email, phone, WhatsApp or WeChat.</p>
          </div>
      </>,
    };
  };

  const [step, setStep] = useState<CustomerStep>("company");
  const at = Math.max(0, CUSTOMER_STEPS.findIndex((x) => x.key === step));
  const last = at === CUSTOMER_STEPS.length - 1;
  const go = (i: number) => setStep(CUSTOMER_STEPS[Math.max(0, Math.min(CUSTOMER_STEPS.length - 1, i))]!.key);
  const named = contacts.filter((c) => c.name.trim()).length;
  return (
    <PanelBody fill>
      <ActionForm
        action={action}
        onDone={onSaved}
        showSuccess={false}
        keepFields
        fieldId={(k) => fieldId(k, contacts)}
        reveal={(k) => setStep(stepOfField(k))}
        className={cn(PANEL_FORM, "min-h-0 gap-0")}
        // A new customer is saved from its last step: Enter on an earlier one goes on to the next.
        beforeSend={() => {
          if (customer || last) return true;
          go(at + 1);
          return false;
        }}
      >
        {(s) => {
          const parts = form(s);
          return (
            <>
              <input type="hidden" name="payload" value={payload} />
              {inPanel && <input type="hidden" name="inPanel" value="1" />}
              <JumpToStep errors={s.code === "duplicate" ? { name: ["duplicate"] } : s.errors} stepOf={stepOfField} onJump={setStep} />
              <StepsFrame
                steps={CUSTOMER_STEPS.map((x, k) => ({
                  key: x.key,
                  label: x.label,
                  icon: x.icon,
                  done: !customer && k < at,
                  summary:
                    x.key === "company"
                      ? draft.name.trim() || undefined
                      : x.key === "details"
                        ? [draft.taxNo && `Tax ${draft.taxNo}`, draft.address.split("\n")[0]].filter(Boolean).join(" · ") || undefined
                        : named
                          ? `${named} ${named === 1 ? "person" : "people"}`
                          : undefined,
                }))}
                at={step}
                onGo={setStep}
                footer={
                  <StepsFooter
                    onBack={at > 0 ? () => go(at - 1) : null}
                    // Editing, it can be saved from any step; a new one, from its last.
                    jump={customer && !last ? { label: "Save now" } : null}
                    onNext={last ? null : () => go(at + 1)}
                    save={{ label: customer ? "Save" : "Add the customer" }}
                  />
                }
              >
                <div className="flex flex-col gap-5">{parts[step]}</div>
              </StepsFrame>
            </>
          );
        }}
      </ActionForm>
    </PanelBody>
  );
}
