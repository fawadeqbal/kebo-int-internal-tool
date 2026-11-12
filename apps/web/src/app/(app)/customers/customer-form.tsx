"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, LayoutGrid, Plus, Trash2, UserRound } from "lucide-react";
import { PARTY_TYPE_LABEL, PARTY_TYPES, customerLetters, UNKNOWN_COUNTRY, type PartyType } from "@kebo/shared";
import { Alert, Banner, Button, buttonClass, Card, CardBody, CardFooter, Checkbox, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelActions, PanelBody, useClosePanel } from "@/components/common/panel";
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
                <li key={p.key}>
                  {p.to ? (
                    <a href={`#${p.to}`} className="underline underline-offset-2">
                      {p.text}
                    </a>
                  ) : (
                    p.text
                  )}
                </li>
              ))}
            </ul>
          </Banner>
        )}

        {/* Board "New customer window": Company / Individual, then the fields in three columns. */}
        <div role="radiogroup" aria-label="Type" className="flex gap-2">
          {PARTY_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={draft.type === t}
              onClick={() => set("type", t)}
              className={cn(buttonClass(draft.type === t ? "brand" : "secondary", "sm"), "gap-1.5")}
            >
              {t === "company" ? <LayoutGrid aria-hidden /> : <UserRound aria-hidden />}
              {PARTY_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
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
            label="Initials on papers"
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
            <CountrySelect
              form={DRAFT}
              id="country"
              value={draft.country}
              onChange={(e) => set("country", e.target.value)}
              {...invalid("country", s.errors?.country)}
            />
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

        {s.code === "duplicate" && s.matches?.length ? (
          <>
            <Alert tone="warning">
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
            </Alert>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox name="allowDuplicate" value="true" />
              Save anyway — this is a different {draft.type === "company" ? "company" : "person"}
            </label>
          </>
        ) : null}

        <div role="group" aria-labelledby="contacts-title" className="flex min-w-0 flex-col gap-3">
          <h3 id="contacts-title" className="text-[15px] font-bold">
            Contacts
          </h3>
          {s.errors?.contacts && !Object.keys(s.errors).some((k) => k.startsWith("contacts.")) && (
            <Alert tone="error">{s.errors.contacts[0]}</Alert>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="bg-[#f8faf9] text-left text-text-2 dark:bg-surface-2">
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

        <Field label="Notes" htmlFor="notes" error={s.errors?.notes}>
          <Textarea
            form={DRAFT}
            id="notes"
            rows={3}
            placeholder="How they pay, who decides…"
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </>
    );
  };

  if (inPanel)
    return (
      <ActionForm action={action} onDone={onSaved} showSuccess={false} keepFields className="flex min-h-0 flex-1 flex-col">
        {(s) => (
          <PanelBody className={PANEL_FORM}>
            {form(s)}
            <PanelActions className="justify-end">
              <Button variant="ghost" onClick={close} className="max-md:hidden">
                Cancel
              </Button>
              {!customer && (
                <SubmitButton variant="secondary" name="another" value="1" pendingText="Saving…">
                  <Plus aria-hidden /> Save &amp; add another
                </SubmitButton>
              )}
              <SubmitButton pendingText="Saving…">
                <Check aria-hidden /> {customer ? "Save changes" : "Save customer"}
              </SubmitButton>
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
