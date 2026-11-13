"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Check, Download, Eye, Plus, Trash2, X } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, CHANNEL_LABEL, INQUIRY_CHANNELS, PRIORITIES, PRIORITY_LABEL, UNKNOWN_COUNTRY, type AttachmentKind, type InquiryChannel } from "@kebo/shared";
import { Alert, Button, buttonClass, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ConfirmDialog } from "@/components/common/dialog";
import { PANEL_FORM, PanelBody, PanelFooter, PanelSection, useClosePanel, WhatHappens } from "@/components/common/panel";
import { ActionForm } from "@/components/common/action-form";
import { CountrySelect } from "@/components/people/country-select";
import type { ActionState } from "@/lib/actions";
import type { ContactOption, CustomerOption, DealFormValues, PersonWithRole } from "@/lib/types-deals";
import type { QuickCustomer, QuickCustomerResult } from "@/app/(app)/inquiries/actions";
import { CustomerPicker } from "./customer-picker";
import { send, type Staged } from "./documents-panel";
import { FileRow, FileZone, fileSize } from "@/components/common/file-zone";
import type { LineColumn } from "@/components/lines/line-table";
import { rowKey } from "./form-bits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const OTHER = "__other__";

/** The customer's items as the line table shows them (the form, and Needs → What they need). */
export const ITEM_COLUMNS: LineColumn[] = [
  { key: "description", label: "Description", width: "minmax(0,1fr)", input: "textarea", required: "Each item needs a description", placeholder: "What it is: size, material, standard…" },
  { key: "model", label: "Model / part no.", width: "8rem", input: "text", maxLength: 120, placeholder: "Model" },
  { key: "quantity", label: "Qty", width: "5rem", input: "number", align: "right", required: "Enter a quantity", placeholder: "Qty" },
  { key: "unit", label: "Unit", width: "5.5rem", input: "unit", maxLength: 20, initial: (p) => (p ? "sets" : "pcs") },
  { key: "targetPrice", label: "Target price", width: "6.5rem", input: "number", align: "right", placeholder: "Target", phoneHidden: true },
];

/** What the window sends: the request's own values (its items are saved by their own editor). */
function payload(v: DealFormValues) {
  return {
    customerId: v.customer?.id ?? "",
    contactId: v.contactId || null,
    channel: v.channel,
    category: v.category.trim(),
    title: v.title.trim() || null,
    requirements: v.requirements.trim() || null,
    priority: v.priority,
    requiredBy: v.requiredBy || null,
    assigneeId: v.assigneeId || null,
  };
}

/** A file the inquiry already has (the edit window lists them, with Remove). */
export interface RequestFile {
  id: string;
  fileName: string;
  /** "URS · 12 Nov 2026". */
  meta: string;
  /** Removes it (null: this person may not). */
  remove: (() => Promise<ActionState>) | null;
}

/**
 * The inquiry's window, the same for "New inquiry" and "Edit the request": who asked, what they need, and
 * the customer's files, in that order. The items are not here: they have their own editor on the inquiry
 * (Add items / Edit items). Files go up once the inquiry is saved.
 */
export function DealForm({
  action,
  initial,
  initialContacts,
  categories,
  people,
  meId,
  canAssignOthers,
  canAddCustomer = false,
  customerLocked,
  searchCustomers,
  loadContacts,
  addCustomer,
  mode,
  files = [],
  hasItems = false,
  onSaved,
}: {
  /** Saves and answers { data: { id, refNo } }; the window then sends the files and says it is saved. */
  action: Action;
  initial: DealFormValues;
  initialContacts: ContactOption[];
  categories: string[];
  /** Who can handle it. */
  people: PersonWithRole[];
  meId: string;
  canAssignOthers: boolean;
  canAddCustomer?: boolean;
  customerLocked?: string;
  searchCustomers: (q: string) => Promise<CustomerOption[]>;
  loadContacts: (customerId: string) => Promise<ContactOption[]>;
  addCustomer?: (v: QuickCustomer) => Promise<QuickCustomerResult>;
  mode: "create" | "edit";
  /** Edit: the files it already has. */
  files?: RequestFile[];
  /** Edit: it has an item list, so "What they need" may be empty. */
  hasItems?: boolean;
  /** Saved (and the files are up): `another` when "Save & add another" was pressed. */
  onSaved: (r: { id: string; refNo?: string; another: boolean }) => void;
}) {
  const router = useRouter();
  const close = useClosePanel();
  const [v, setV] = useState<DealFormValues>(initial);
  const [contacts, setContacts] = useState<ContactOption[]>(initialContacts);
  const [otherCategory, setOtherCategory] = useState(
    () => !!initial.category && !categories.some((c) => c.toLowerCase() === initial.category.toLowerCase()),
  );
  const [adding, setAdding] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [uploading, setUploading] = useState(false);
  const [kindNext, setKindNext] = useState<AttachmentKind>("urs");
  const stagedNow = useRef(staged);
  useEffect(() => {
    stagedNow.current = staged;
  }, [staged]);
  const [created, setCreated] = useState<{ id: string; failed: string[] } | null>(null);
  const [asking, setAsking] = useState<RequestFile | null>(null);
  const [removing, startRemove] = useTransition();
  const set = <K extends keyof DealFormValues>(k: K, value: DealFormValues[K]) => setV((s) => ({ ...s, [k]: value }));

  const chooseCustomer = async (c: CustomerOption | null, known?: ContactOption[]) => {
    set("customer", c);
    set("contactId", "");
    setContacts([]);
    if (!c) return;
    const list = known ?? (await loadContacts(c.id));
    setContacts(list);
    setV((s) => (s.customer?.id === c.id ? { ...s, contactId: (list.find((x) => x.isPrimary) ?? list[0])?.id ?? "" } : s));
  };

  // Saved first, then its new files go up one by one; only then the window says it is done.
  const submit: Action = async (prev, form) => {
    const r = await action(prev, form);
    if (!r.ok) return r;
    const { id, refNo } = r.data as { id: string; refNo?: string };
    const list = stagedNow.current;
    if (list.length) {
      setUploading(true);
      const failed: string[] = [];
      for (const s of list) {
        setStaged((x) => x.map((y) => (y.key === s.key ? { ...y, progress: 0, error: null } : y)));
        const error = await send(id, s, (p) => setStaged((x) => x.map((y) => (y.key === s.key ? { ...y, progress: p } : y))));
        setStaged((x) => x.map((y) => (y.key === s.key ? { ...y, progress: error ? null : 100, error } : y)));
        if (error) failed.push(`${s.file.name}: ${error}`);
      }
      setUploading(false);
      if (failed.length) {
        setCreated({ id, failed });
        return { ok: true };
      }
    }
    onSaved({ id, refNo, another: !!form.get("another") });
    return { ok: true };
  };

  const contactLine = (c: ContactOption) => [c.name, c.email ?? c.whatsapp ?? c.phone].filter(Boolean).join(" · ");
  const assignable = canAssignOthers ? people : people.filter((p) => p.id === meId || p.id === initial.assigneeId);
  const create = mode === "create";
  const required = !hasItems;

  if (created)
    return (
      <PanelBody>
        <Alert tone="warning">
          <p className="font-medium">The inquiry was saved, but some files did not upload:</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {created.failed.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <Link href={`/inquiries/${created.id}/files`} className={buttonClass("primary", "sm", "mt-3")}>
            Open the inquiry’s files and try them again
          </Link>
        </Alert>
      </PanelBody>
    );

  return (
    <PanelBody>
      <ActionForm
        action={submit}
        keepFields
        showSuccess={false}
        className={PANEL_FORM}
        banner={(st) =>
          st.message && st.ok === false ? (
            <Alert tone="error">
              <strong>Not saved.</strong> {notSaved(st)}
            </Alert>
          ) : null
        }
      >
        {(s) => (
          <>
            <input type="hidden" name="payload" value={JSON.stringify(payload(v))} />
            <PanelSection title="Who asked" first className="md:grid-cols-3">
              <Field label="Customer" htmlFor="customer" required error={s.errors?.customerId} className="md:col-span-2">
                {adding && addCustomer ? (
                  <QuickCustomerForm
                    add={addCustomer}
                    search={searchCustomers}
                    onCancel={() => setAdding(false)}
                    onUse={(c, list) => {
                      setAdding(false);
                      void chooseCustomer(c, list);
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-56 flex-1">
                      <CustomerPicker
                        value={v.customer}
                        onChange={(c) => void chooseCustomer(c)}
                        search={searchCustomers}
                        error={s.errors?.customerId}
                        disabled={!!customerLocked}
                        disabledReason={customerLocked}
                      />
                    </div>
                    {canAddCustomer && addCustomer && !customerLocked && (
                      <Button variant="secondary" onClick={() => setAdding(true)}>
                        <Plus aria-hidden /> New customer
                      </Button>
                    )}
                  </div>
                )}
              </Field>
              <Field
                label="Contact"
                htmlFor="contactId"
                error={s.errors?.contactId}
                hint={v.customer && !contacts.length ? "This customer has no contacts yet." : undefined}
              >
                <Select id="contactId" value={v.contactId} onChange={(e) => set("contactId", e.target.value)} disabled={!v.customer}>
                  <option value="">{v.customer ? "Not specified" : "Choose the customer first"}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {contactLine(c)}
                      {c.isPrimary ? " (main)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Came by" htmlFor="channel" required error={s.errors?.channel}>
                <Select id="channel" value={v.channel} onChange={(e) => set("channel", e.target.value as InquiryChannel)}>
                  {INQUIRY_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Needed by" htmlFor="requiredBy" hint="If they gave a date" error={s.errors?.requiredBy}>
                <Input id="requiredBy" type="date" value={v.requiredBy} onChange={(e) => set("requiredBy", e.target.value)} />
              </Field>
              <Field label="Handles it" htmlFor="assigneeId" hint={create ? "Can be set later" : undefined} error={s.errors?.assigneeId}>
                <Select id="assigneeId" value={v.assigneeId} onChange={(e) => set("assigneeId", e.target.value)} disabled={!canAssignOthers && v.assigneeId !== "" && v.assigneeId !== meId}>
                  {assignable.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === meId ? `${p.name} (me)` : p.name}
                    </option>
                  ))}
                  <option value="">Nobody yet</option>
                </Select>
              </Field>
            </PanelSection>

            <PanelSection title="What they need" className="md:grid-cols-3">
              <Field label="Title" htmlFor="title" error={s.errors?.title}>
                <Input id="title" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={200} placeholder="Short name, e.g. “Tablet press”" />
              </Field>
              <Field label="Category" htmlFor="category" required error={s.errors?.category}>
                <Select
                  id="category"
                  value={otherCategory ? OTHER : v.category}
                  aria-invalid={!!s.errors?.category || undefined}
                  onChange={(e) => {
                    if (e.target.value === OTHER) {
                      setOtherCategory(true);
                      set("category", "");
                    } else {
                      setOtherCategory(false);
                      set("category", e.target.value);
                    }
                  }}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={OTHER}>Other…</option>
                </Select>
                {otherCategory && (
                  <Input aria-label="Category name" placeholder="Type the category" value={v.category} onChange={(e) => set("category", e.target.value)} maxLength={120} autoFocus />
                )}
              </Field>
              <Field label="Priority" htmlFor="priority" error={s.errors?.priority}>
                <Select id="priority" value={v.priority} onChange={(e) => set("priority", e.target.value)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="What they need" htmlFor="requirements" required={required} error={s.errors?.requirements} className="md:col-span-3">
                <Textarea
                  id="requirements"
                  rows={4}
                  value={v.requirements}
                  placeholder={required ? "Write it as the customer said it." : "Optional: the items are listed"}
                  onChange={(e) => set("requirements", e.target.value)}
                />
              </Field>
            </PanelSection>

            <PanelSection title="Files from the customer" className="sm:grid-cols-1">
              {files.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate">
                    <a href={`/files/${f.id}?view=1`} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">
                      {f.fileName}
                    </a>
                    <span className="text-text-2"> · {f.meta}</span>
                  </span>
                  {f.remove && (
                    <button type="button" onClick={() => setAsking(f)} className="shrink-0 font-semibold text-bad hover:underline">
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <FileZone
                label="Add files"
                hint="Their URS, drawings, photos of the old machine… PDF, images, Excel, Word · up to 25 MB each"
                disabled={uploading}
                onFiles={(list) => setStaged((x) => [...x, ...list.map((file) => ({ key: rowKey(), file, kind: kindNext, note: "", progress: null, error: null }))])}
                kind={
                  <Select aria-label="What kind of file" value={kindNext} onChange={(e) => setKindNext(e.target.value as AttachmentKind)} className="h-[34px] w-auto text-[13px]">
                    {NEW_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_WORD[k]}
                      </option>
                    ))}
                  </Select>
                }
              >
                {staged.length > 0 &&
                  staged.map((f) => (
                    <FileRow
                      key={f.key}
                      name={f.file.name}
                      meta={
                        f.error ? (
                          <span className="text-bad">{f.error}</span>
                        ) : (
                          `${ATTACHMENT_KIND_LABEL[f.kind]} · ${fileSize(f.file.size)} · ${f.progress === null ? "goes up when you save" : `uploading ${f.progress}%`}`
                        )
                      }
                      actions={
                        <>
                          <Button size="icon-xs" variant="ghost" onClick={() => open(f.file, false)} aria-label={`View ${f.file.name}`}>
                            <Eye aria-hidden />
                          </Button>
                          <Button size="icon-xs" variant="ghost" onClick={() => open(f.file, true)} aria-label={`Download ${f.file.name}`}>
                            <Download aria-hidden />
                          </Button>
                          <Button size="icon-xs" variant="ghost" disabled={uploading} onClick={() => setStaged((x) => x.filter((y) => y.key !== f.key))} aria-label={`Remove ${f.file.name}`}>
                            <Trash2 aria-hidden />
                          </Button>
                        </>
                      }
                    />
                  ))}
              </FileZone>
            </PanelSection>

            {create && (
              <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-text-2">
                The items come next. On the inquiry, <strong className="text-text">Add items</strong> opens the items editor: type them, paste them from Excel, or leave it
                empty and take them from the first factory offer.
              </p>
            )}

            <PanelFooter start={create ? undefined : "Each changed value is kept in History."}>
              <Button type="button" variant="ghost" onClick={() => close()}>
                Cancel
              </Button>
              {create && (
                <SubmitButton variant="secondary" name="another" value="1" pendingText="Saving…">
                  <Plus aria-hidden /> Save &amp; add another
                </SubmitButton>
              )}
              <SubmitButton pendingText={uploading ? "Uploading files…" : "Saving…"}>
                <Check aria-hidden /> {create ? "Save inquiry" : "Save changes"}
              </SubmitButton>
            </PanelFooter>
          </>
        )}
      </ActionForm>
      {asking && (
        <ConfirmDialog
          title={`Remove ${asking.fileName}?`}
          confirmLabel="Remove the file"
          cancelLabel="Keep it"
          danger
          busy={removing}
          onCancel={() => setAsking(null)}
          onConfirm={() =>
            startRemove(async () => {
              const r = await asking.remove!();
              setAsking(null);
              if (r.ok) router.refresh();
              else toast(r.message ?? "The file was not removed.");
            })
          }
        >
          <WhatHappens lines={["The file leaves this inquiry. Nothing else changes."]} />
        </ConfirmDialog>
      )}
    </PanelBody>
  );
}

/** The kinds of file a customer sends, in the order the select lists them. */
const NEW_KINDS: AttachmentKind[] = ["urs", "drawing", "photo", "specification", "other"];
const KIND_WORD: Partial<Record<AttachmentKind, string>> = { urs: "URS (requirements)", drawing: "Drawing", photo: "Photo", specification: "Specification", other: "Other" };

/** Shows (or downloads) a file that is not uploaded yet. */
function open(file: File, download: boolean) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  if (download) a.download = file.name;
  else a.target = "_blank";
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** "Choose a category. Write what the customer needs, or add their list of items." */
function notSaved(st: ActionState) {
  const all = Object.values(st.errors ?? {})
    .flat()
    .filter((x): x is string => !!x);
  const list = [...new Set(all.length ? all : [st.message ?? ""])].filter(Boolean);
  return list.map((m) => (/[.!?]$/.test(m) ? m : `${m}.`)).join(" ");
}

/** Enter in these small inputs must not save the whole inquiry. */
const noSubmit = (e: KeyboardEvent) => {
  if (e.key === "Enter") e.preventDefault();
};

/**
 * Add a customer without leaving the inquiry: a name, country and one contact.
 * Address, tax number and more contacts are filled in on the customer page later.
 */
function QuickCustomerForm({
  add,
  search,
  onUse,
  onCancel,
}: {
  add: (v: QuickCustomer) => Promise<QuickCustomerResult>;
  search: (q: string) => Promise<CustomerOption[]>;
  onUse: (c: CustomerOption, contacts?: ContactOption[]) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState<QuickCustomer>({ name: "", country: UNKNOWN_COUNTRY, contact: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Extract<QuickCustomerResult, { ok: false }> | null>(null);
  const set = (k: keyof QuickCustomer, value: string) => setQ((s) => ({ ...s, [k]: value }));
  const err = (k: string) =>
    result?.errors?.[k]?.[0] ?? Object.entries(result?.errors ?? {}).find(([key]) => key.startsWith(`contacts.0.${k}`))?.[1]?.[0];

  const save = async (allowDuplicate = false) => {
    setBusy(true);
    const r = await add({ ...q, allowDuplicate });
    setBusy(false);
    if (r.ok) onUse(r.customer, r.contacts);
    else setResult(r);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/50 p-3" onKeyDown={noSubmit}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">New customer</p>
        <Button size="icon-xs" variant="ghost" onClick={onCancel} aria-label="Back to choosing a customer">
          <X aria-hidden />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company or person" htmlFor="qc-name" error={err("name")}>
          <Input id="qc-name" value={q.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label="Country" htmlFor="qc-country" error={err("country")}>
          <CountrySelect id="qc-country" value={q.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
        <Field label="Contact person" htmlFor="qc-contact" optional hint="The company name is used if left empty" error={err("name")}>
          <Input id="qc-contact" value={q.contact} onChange={(e) => set("contact", e.target.value)} maxLength={120} />
        </Field>
        <Field label="Email" htmlFor="qc-email" optional error={err("email")}>
          <Input id="qc-email" type="email" value={q.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Phone / WhatsApp" htmlFor="qc-phone" optional hint="Email or phone: at least one" error={err("phone")}>
          <Input id="qc-phone" type="tel" value={q.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
      </div>
      {result && !result.matches?.length && !Object.keys(result.errors ?? {}).length && (
        <p className="text-sm text-bad">{result.message}</p>
      )}
      {result?.matches?.length ? (
        <div className="rounded-md bg-warn-soft p-3 text-sm">
          <p>{result.message}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {result.matches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2">
                <span>
                  {m.label}
                  {m.detail && <span className="text-muted"> · {m.detail}</span>}
                </span>
                <Button
                  size="xs"
                  onClick={async () => {
                    const found = (await search(m.label)).find((c) => c.id === m.id);
                    onUse(found ?? { id: m.id, name: m.label, country: UNKNOWN_COUNTRY, primaryContact: null });
                  }}
                >
                  Use this one
                </Button>
              </li>
            ))}
          </ul>
          <Button size="xs" variant="ghost" className="mt-2" onClick={() => void save(true)} disabled={busy}>
            It is a different customer — add it anyway
          </Button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => void save()} disabled={busy || !q.name.trim()}>
          {busy ? "Adding…" : "Add and use this customer"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
