"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { UserPlus, X } from "lucide-react";
import { CHANNEL_LABEL, INQUIRY_CHANNELS, PRIORITIES, PRIORITY_LABEL, UNKNOWN_COUNTRY, type InquiryChannel } from "@kebo/shared";
import { Alert, Badge, Button, buttonClass, Card, CardBody, CardFooter, CardHeader, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CountrySelect } from "@/components/people/country-select";
import type { ActionState } from "@/lib/actions";
import type { ContactOption, CustomerOption, DealFormValues, PersonWithRole } from "@/lib/types-deals";
import type { QuickCustomer, QuickCustomerResult } from "@/app/(app)/deals/actions";
import { CustomerPicker } from "./customer-picker";
import { FileDrop, send, type Staged } from "./documents-panel";
import { LineTable, type LineColumn } from "@/components/lines/line-table";
import { localLineHandlers } from "@/components/lines/local-lines";
import { rowKey } from "./form-bits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const OTHER = "__other__";

const ITEM_COLUMNS: LineColumn[] = [
  { key: "description", label: "Description", width: "minmax(0,1fr)", input: "textarea", required: "Each item needs a description", placeholder: "What it is: size, material, standard…" },
  { key: "model", label: "Model / part no.", width: "8rem", input: "text", maxLength: 120, placeholder: "Model" },
  { key: "quantity", label: "Qty", width: "5rem", input: "number", align: "right", required: "Enter a quantity", placeholder: "Qty" },
  { key: "unit", label: "Unit", width: "5.5rem", input: "unit", maxLength: 20, initial: (p) => (p ? "sets" : "pcs") },
  { key: "targetPrice", label: "Target price", width: "6.5rem", input: "number", align: "right", placeholder: "Target", phoneHidden: true },
];

/** Items with parts pointing at their item by position, as the API takes them. */
function itemsPayload(items: DealFormValues["items"]) {
  const at = new Map(items.map((it, n) => [it.key, n]));
  return items.map((it) => ({
    id: it.id,
    partOf: it.parentKey ? (at.get(it.parentKey) ?? null) : null,
    description: it.description,
    model: it.model.trim() || null,
    quantity: it.quantity.replace(/,/g, "").trim(),
    unit: it.unit.trim() || "pcs",
    targetPrice: it.targetPrice.replace(/,/g, "").trim() || null,
  }));
}

/** The body the API's inquiry schema accepts. */
function payload(v: DealFormValues, withAssignee: boolean) {
  return {
    customerId: v.customer?.id ?? "",
    contactId: v.contactId || null,
    channel: v.channel,
    category: v.category.trim(),
    title: v.title.trim() || null,
    requirements: v.requirements.trim() || null,
    priority: v.priority,
    requiredBy: v.requiredBy || null,
    ...(withAssignee ? { assigneeId: v.assigneeId || null } : {}),
    items: itemsPayload(v.items),
  };
}

/**
 * The inquiry form (new and edit): who asked and how, the items as a quick
 * table (parts under their item), the requirements and — for a new inquiry —
 * the URS and other files, uploaded once the inquiry is saved.
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
  cancelHref,
  mode,
}: {
  /** Edit: saves and opens the deal. Create: returns the new id ({ data: { id } }); the form uploads the files, then opens it. */
  action: Action;
  initial: DealFormValues;
  initialContacts: ContactOption[];
  categories: string[];
  /** Handled-by choices; null on edit (reassigning is done on the deal page). */
  people: PersonWithRole[] | null;
  meId: string;
  canAssignOthers: boolean;
  canAddCustomer?: boolean;
  customerLocked?: string;
  searchCustomers: (q: string) => Promise<CustomerOption[]>;
  loadContacts: (customerId: string) => Promise<ContactOption[]>;
  addCustomer?: (v: QuickCustomer) => Promise<QuickCustomerResult>;
  cancelHref: string;
  mode: "create" | "edit";
}) {
  const router = useRouter();
  const [v, setV] = useState<DealFormValues>(initial);
  const [contacts, setContacts] = useState<ContactOption[]>(initialContacts);
  const [otherCategory, setOtherCategory] = useState(
    () => !!initial.category && !categories.some((c) => c.toLowerCase() === initial.category.toLowerCase()),
  );
  const [adding, setAdding] = useState(false);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [uploading, setUploading] = useState(false);
  const stagedNow = useRef(staged);
  useEffect(() => {
    stagedNow.current = staged;
  }, [staged]);
  const [created, setCreated] = useState<{ id: string; failed: string[] } | null>(null);
  const set = <K extends keyof DealFormValues>(k: K, value: DealFormValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const itemHandlers = localLineHandlers(
    v.items,
    (fn) => setV((s) => ({ ...s, items: fn(s.items) })),
    (values, parentKey) => ({
      id: null,
      key: rowKey(),
      parentKey,
      description: values.description ?? "",
      model: values.model ?? "",
      quantity: values.quantity ?? "",
      unit: values.unit || (parentKey ? "sets" : "pcs"),
      targetPrice: values.targetPrice ?? "",
      priced: false,
    }),
    (row, values) => ({ ...row, ...values }),
  );

  const chooseCustomer = async (c: CustomerOption | null, known?: ContactOption[]) => {
    set("customer", c);
    set("contactId", "");
    setContacts([]);
    if (!c) return;
    const list = known ?? (await loadContacts(c.id));
    setContacts(list);
    setV((s) => (s.customer?.id === c.id ? { ...s, contactId: (list.find((x) => x.isPrimary) ?? list[0])?.id ?? "" } : s));
  };

  // A new inquiry is saved first, then its files go up one by one, then the deal opens.
  const submit: Action = async (prev, form) => {
    const r = await action(prev, form);
    if (mode === "edit" || !r.ok) return r;
    const id = (r.data as { id: string }).id;
    const files = stagedNow.current;
    if (files.length) {
      setUploading(true);
      const failed: string[] = [];
      for (const s of files) {
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
    router.push(`/deals/${id}`);
    return { ok: true, message: "Inquiry created." };
  };

  const contactLine = (c: ContactOption) => [c.name, c.email ?? c.whatsapp ?? c.phone].filter(Boolean).join(" · ");
  const assignable = people ? (canAssignOthers ? people : people.filter((p) => p.id === meId)) : [];

  if (created)
    return (
      <Alert tone="warning">
        <p className="font-medium">The inquiry was created, but some files did not upload:</p>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {created.failed.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <Link href={`/deals/${created.id}`} className={buttonClass("primary", "sm", "mt-3")}>
          Open the inquiry and try them again
        </Link>
      </Alert>
    );

  return (
    <ActionForm action={submit} keepFields>
      {(s) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload(v, mode === "create"))} />
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Customer" description="Who is asking, and how they reached us" />
              <CardBody className="grid gap-4 md:grid-cols-2">
                <Field label="Customer" htmlFor="customer" error={s.errors?.customerId} className="md:col-span-2">
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
                      <div className="min-w-0 flex-1 basis-72">
                        <CustomerPicker
                          value={v.customer}
                          onChange={(c) => void chooseCustomer(c)}
                          search={searchCustomers}
                          error={s.errors?.customerId}
                          disabled={!!customerLocked}
                          disabledReason={customerLocked}
                        />
                      </div>
                      {canAddCustomer && addCustomer && !customerLocked && !v.customer && (
                        <Button variant="secondary" onClick={() => setAdding(true)}>
                          <UserPlus aria-hidden /> New customer
                        </Button>
                      )}
                    </div>
                  )}
                </Field>
                <Field
                  label="Contact person"
                  htmlFor="contactId"
                  optional
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
                <Field label="Came in by" htmlFor="channel" error={s.errors?.channel}>
                  <Select id="channel" value={v.channel} onChange={(e) => set("channel", e.target.value as InquiryChannel)}>
                    {INQUIRY_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABEL[c]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title={mode === "create" ? "What the customer needs" : "Requirement"}
                description="Their requirement as they sent it, with the URS. The lines are made at factory prices, as each factory offers them."
              />
              <CardBody className="flex flex-col gap-4">
                <Field
                  label="Requirement"
                  htmlFor="requirements"
                  optional={v.items.length > 0}
                  hint="What they want, specs, standards, packing, destination port — anything the factories need to know"
                  error={s.errors?.requirements}
                >
                  <Textarea id="requirements" rows={5} value={v.requirements} onChange={(e) => set("requirements", e.target.value)} />
                </Field>
                {mode === "create" && <FileDrop staged={staged} setStaged={setStaged} busy={uploading} />}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Their list of items (optional)"
                description="Only if the customer sent a list. Factories may answer with their own models and breakdown; that is decided at factory prices."
              />
              <CardBody>
                <LineTable
                  rows={v.items.map((it) => ({
                    key: it.key,
                    parentKey: it.parentKey,
                    values: { description: it.description, model: it.model, quantity: it.quantity, unit: it.unit, targetPrice: it.targetPrice },
                    badge: it.priced ? (
                      <span className="ml-1 align-middle" title="A factory has priced this: changing it will ask why">
                        <Badge tone="info">Priced</Badge>
                      </span>
                    ) : undefined,
                  }))}
                  columns={ITEM_COLUMNS}
                  noun="item"
                  error={s.errors?.items?.[0]}
                  empty="No list: the requirement above is enough."
                  {...itemHandlers}
                />
              </CardBody>
            </Card>


            <Card>
              <CardHeader title="The deal" />
              <CardBody className="grid gap-4 md:grid-cols-2">
                <Field label="Category" htmlFor="category" error={s.errors?.category}>
                  <Select
                    id="category"
                    value={otherCategory ? OTHER : v.category}
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
                      Choose a category
                    </option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value={OTHER}>Another category…</option>
                  </Select>
                  {otherCategory && (
                    <Input
                      aria-label="Category name"
                      placeholder="Type the category"
                      value={v.category}
                      onChange={(e) => set("category", e.target.value)}
                      maxLength={120}
                      autoFocus
                    />
                  )}
                </Field>
                <Field
                  label="Needed by"
                  htmlFor="requiredBy"
                  optional
                  hint="When the customer wants our offer"
                  error={s.errors?.requiredBy}
                >
                  <Input id="requiredBy" type="date" value={v.requiredBy} onChange={(e) => set("requiredBy", e.target.value)} />
                </Field>
                {people && (
                  <Field
                    label="Handled by"
                    htmlFor="assigneeId"
                    optional
                    hint={canAssignOthers ? "Assigning someone starts sourcing" : "Take it yourself, or leave it for a manager to assign"}
                    error={s.errors?.assigneeId}
                  >
                    <Select id="assigneeId" value={v.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                      <option value="">Nobody yet</option>
                      {assignable.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id === meId ? `${p.name} (me)` : p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Priority" htmlFor="priority" error={s.errors?.priority}>
                  <Select id="priority" value={v.priority} onChange={(e) => set("priority", e.target.value)}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Title"
                  htmlFor="title"
                  optional
                  hint="Leave empty to name it after the items"
                  error={s.errors?.title}
                  className="md:col-span-2"
                >
                  <Input
                    id="title"
                    value={v.title}
                    onChange={(e) => set("title", e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Gate valves for Jebel Ali project"
                  />
                </Field>
              </CardBody>
              <CardFooter>
                <Link href={cancelHref} className={buttonClass("ghost")}>
                  Cancel
                </Link>
                <SubmitButton pendingText={uploading ? "Uploading files…" : "Saving…"}>
                  {mode === "create"
                    ? staged.length
                      ? `Create the inquiry and upload ${staged.length} file${staged.length === 1 ? "" : "s"}`
                      : "Create the inquiry"
                    : "Save changes"}
                </SubmitButton>
              </CardFooter>
            </Card>
          </div>
        </>
      )}
    </ActionForm>
  );
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
