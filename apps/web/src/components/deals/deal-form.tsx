"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus } from "lucide-react";
import { CHANNEL_LABEL, INQUIRY_CHANNELS, PRIORITIES, PRIORITY_LABEL, type InquiryChannel } from "@kebo/shared";
import { Button, buttonClass, Card, CardBody, CardFooter, CardHeader, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { ContactOption, CustomerOption, DealFormItem, DealFormValues, PersonWithRole } from "@/lib/types-deals";
import { CustomerPicker } from "./customer-picker";
import { ErrorText, MiniLabel, move, numberText, RowButtons, rowKey } from "./form-bits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const OTHER = "__other__";

const emptyItem = (): DealFormItem => ({ id: null, key: rowKey(), description: "", model: "", quantity: "", unit: "pcs", targetPrice: "" });

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
    items: v.items.map((it) => ({
      id: it.id,
      description: it.description,
      model: it.model.trim() || null,
      quantity: numberText(it.quantity),
      unit: it.unit.trim() || "pcs",
      targetPrice: numberText(it.targetPrice) || null,
    })),
  };
}

/**
 * The inquiry form (new and edit): who asked, through which channel, what for,
 * and the items with quantities. Sends JSON to saveDealAction.
 */
export function DealForm({
  action,
  initial,
  initialContacts,
  categories,
  people,
  meId,
  canAssignOthers,
  customerLocked,
  searchCustomers,
  loadContacts,
  cancelHref,
  mode,
}: {
  action: Action;
  initial: DealFormValues;
  initialContacts: ContactOption[];
  categories: string[];
  /** Handled-by choices; null on edit (reassigning is done on the deal page). */
  people: PersonWithRole[] | null;
  meId: string;
  canAssignOthers: boolean;
  customerLocked?: string;
  searchCustomers: (q: string) => Promise<CustomerOption[]>;
  loadContacts: (customerId: string) => Promise<ContactOption[]>;
  cancelHref: string;
  mode: "create" | "edit";
}) {
  const [v, setV] = useState<DealFormValues>(initial);
  const [contacts, setContacts] = useState<ContactOption[]>(initialContacts);
  const [otherCategory, setOtherCategory] = useState(
    () => !!initial.category && !categories.some((c) => c.toLowerCase() === initial.category.toLowerCase()),
  );
  const set = <K extends keyof DealFormValues>(k: K, value: DealFormValues[K]) => setV((s) => ({ ...s, [k]: value }));
  const setItem = (i: number, patch: Partial<DealFormItem>) =>
    setV((s) => ({ ...s, items: s.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) }));

  const chooseCustomer = async (c: CustomerOption | null) => {
    set("customer", c);
    set("contactId", "");
    setContacts([]);
    if (!c) return;
    const list = await loadContacts(c.id);
    setContacts(list);
    setV((s) => (s.customer?.id === c.id ? { ...s, contactId: (list.find((x) => x.isPrimary) ?? list[0])?.id ?? "" } : s));
  };

  const contactLine = (c: ContactOption) => [c.name, c.email ?? c.whatsapp ?? c.phone].filter(Boolean).join(" · ");
  const assignable = people ? (canAssignOthers ? people : people.filter((p) => p.id === meId)) : [];

  return (
    <ActionForm action={action}>
      {(s) => (
        <>
          <input type="hidden" name="payload" value={JSON.stringify(payload(v, mode === "create"))} />
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Customer" description="Who is asking, and how they reached us" />
              <CardBody className="grid gap-4 md:grid-cols-2">
                <Field label="Customer" htmlFor="customer" error={s.errors?.customerId} className="md:col-span-2">
                  <CustomerPicker
                    value={v.customer}
                    onChange={chooseCustomer}
                    search={searchCustomers}
                    error={s.errors?.customerId}
                    disabled={!!customerLocked}
                    disabledReason={customerLocked}
                  />
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
              <CardHeader title="The request" />
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
                <Field label="Title" htmlFor="title" optional hint="Leave empty to name it after the items" error={s.errors?.title}>
                  <Input
                    id="title"
                    value={v.title}
                    onChange={(e) => set("title", e.target.value)}
                    maxLength={200}
                    placeholder="e.g. Gate valves for Jebel Ali project"
                  />
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
                <Field
                  label="Requirements"
                  htmlFor="requirements"
                  optional
                  hint="Specs, standards, packing, destination port — anything the factories need to know"
                  error={s.errors?.requirements}
                  className="md:col-span-2"
                >
                  <Textarea id="requirements" rows={4} value={v.requirements} onChange={(e) => set("requirements", e.target.value)} />
                </Field>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Items" description="One line per product the customer wants priced" />
              <CardBody className="flex flex-col gap-3">
                <ol className="flex flex-col gap-3">
                  {v.items.map((it, i) => (
                    <li key={it.key} className="rounded-lg border border-line p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted">Item {i + 1}</span>
                        <RowButtons
                          index={i}
                          count={v.items.length}
                          label={`item ${i + 1}`}
                          onMove={(to) => setV((st) => ({ ...st, items: move(st.items, i, to) }))}
                          onRemove={() => setV((st) => ({ ...st, items: st.items.filter((_, n) => n !== i) }))}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-6">
                        <div className="sm:col-span-6">
                          <MiniLabel htmlFor={`desc-${it.key}`}>Description</MiniLabel>
                          <Textarea
                            id={`desc-${it.key}`}
                            rows={2}
                            className="min-h-0"
                            value={it.description}
                            onChange={(e) => setItem(i, { description: e.target.value })}
                            placeholder="What it is, size, material, standard…"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <MiniLabel htmlFor={`model-${it.key}`}>Model / part no.</MiniLabel>
                          <Input
                            id={`model-${it.key}`}
                            value={it.model}
                            onChange={(e) => setItem(i, { model: e.target.value })}
                            maxLength={120}
                          />
                        </div>
                        <div>
                          <MiniLabel htmlFor={`qty-${it.key}`}>Quantity</MiniLabel>
                          <Input
                            id={`qty-${it.key}`}
                            inputMode="decimal"
                            value={it.quantity}
                            onChange={(e) => setItem(i, { quantity: e.target.value })}
                            className="tabular"
                          />
                        </div>
                        <div>
                          <MiniLabel htmlFor={`unit-${it.key}`}>Unit</MiniLabel>
                          <Input
                            id={`unit-${it.key}`}
                            value={it.unit}
                            onChange={(e) => setItem(i, { unit: e.target.value })}
                            maxLength={20}
                            list="units"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <MiniLabel htmlFor={`target-${it.key}`}>Target price (optional)</MiniLabel>
                          <Input
                            id={`target-${it.key}`}
                            inputMode="decimal"
                            value={it.targetPrice}
                            onChange={(e) => setItem(i, { targetPrice: e.target.value })}
                            className="tabular"
                            placeholder="Customer's budget per unit"
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                <datalist id="units">
                  {["pcs", "sets", "kg", "tons", "m", "m²", "m³", "rolls", "cartons", "pairs", "litres"].map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
                <ErrorText error={s.errors?.items} />
                <div>
                  <Button size="sm" onClick={() => setV((st) => ({ ...st, items: [...st.items, emptyItem()] }))}>
                    <Plus aria-hidden /> Add another item
                  </Button>
                </div>
              </CardBody>
              <CardFooter>
                <Link href={cancelHref} className={buttonClass("ghost")}>
                  Cancel
                </Link>
                <SubmitButton pendingText="Saving…">{mode === "create" ? "Create the inquiry" : "Save changes"}</SubmitButton>
              </CardFooter>
            </Card>
          </div>
        </>
      )}
    </ActionForm>
  );
}
