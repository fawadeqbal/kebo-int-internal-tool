"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Download, Eye, FileText, Pencil, Trash2 } from "lucide-react";
import { ATTACHMENT_KIND_LABEL, CHANNEL_LABEL, INQUIRY_CHANNELS, PARTY_TYPE_LABEL, PARTY_TYPES, PRIORITIES, PRIORITY_LABEL, UNKNOWN_COUNTRY, type AttachmentKind } from "@kebo/shared";
import { Alert, Button, buttonClass, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ConfirmDialog } from "@/components/common/dialog";
import { PANEL_FORM, PanelBody, PanelSection, useReportDirty, useReportLost, WhatHappens } from "@/components/common/panel";
import { ActionForm } from "@/components/common/action-form";
import { OnePartFooter, StepsFrame } from "@/components/common/steps-frame";
import { CountrySelect } from "@/components/people/country-select";
import { CurrencySelect } from "@/components/common/currency-select";
import { countryName } from "@/lib/countries";
import { date } from "@/lib/format";
import type { ActionState } from "@/lib/actions";
import type { ContactOption, CustomerOption, DealFormValues, PersonWithRole } from "@/lib/types-deals";
import type { QuickCustomer, QuickCustomerResult } from "@/app/(app)/inquiries/actions";
import { CustomerPicker } from "./customer-picker";
import { ChoiceChips } from "@/components/common/choice-chips";
import { send, type Staged } from "./documents-panel";
import { FileRow, FileZone, fileSize } from "@/components/common/file-zone";
import { LineTable } from "@/components/lines/line-table";
import { ReasonDialog } from "@/components/edits/edits";
import { recordEditAction } from "@/lib/edit-actions";
import type { DealItem } from "@/lib/types";
import type { LineRow } from "@/components/lines/line-table";
import type { EditCard, EditRef } from "@/lib/types-edits";
import { ITEM_COLUMNS, itemsBody, useItemRows } from "./items-sheet";
import { rowKey } from "./form-bits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const OTHER = "__other__";

export { ITEM_COLUMNS } from "./items-sheet";

/** What the window sends: the request's own values (the items go with them, see the Items step). */
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
 * The inquiry's window, the same for "New inquiry" and "Edit the request", in steps (design 17 Nov):
 * Customer · Items · Details · Files. The items are typed in a sheet (paste a list, Excel) and saved with
 * the rest in one save; changing a saved list asks why first. Files go up once the inquiry is saved.
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
  recentCustomers,
  loadContacts,
  addCustomer,
  mode,
  files = [],
  items = [],
  itemsUpload = true,
  itemsEdit,
  startStep = "customer",
  only = false,
  onAllSteps,
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
  /** The picker's "Recent", before anything is typed. */
  recentCustomers?: () => Promise<CustomerOption[]>;
  loadContacts: (customerId: string) => Promise<ContactOption[]>;
  addCustomer?: (v: QuickCustomer) => Promise<QuickCustomerResult>;
  mode: "create" | "edit";
  /** Edit: the files it already has. */
  files?: RequestFile[];
  /** Edit: the items it has (with items, "What they need" may be empty). */
  items?: DealItem[];
  /** The sheet takes an Excel file (not once a quotation went out). */
  itemsUpload?: boolean;
  /** Edit: where a change to the items is kept ("Edited n×" on the items). */
  itemsEdit?: { edit: EditRef; card?: EditCard | null };
  /** The step it opens on (the Items card's Edit: Items). */
  startStep?: RequestStep;
  /** Only that step (Edit on one part, design 17 Nov): no rail, Cancel and Save, and "All steps". */
  only?: boolean;
  onAllSteps?: () => void;
  /** Saved (and the files are up). */
  onSaved: (r: { id: string; refNo?: string; title?: string; customer?: string; files?: number }) => void;
}) {
  const router = useRouter();
  const [v, setV] = useState<DealFormValues>(initial);
  const [contacts, setContacts] = useState<ContactOption[]>(initialContacts);
  const [otherCategory, setOtherCategory] = useState(
    () => !!initial.category && !categories.some((c) => c.toLowerCase() === initial.category.toLowerCase()),
  );
  // "+ New customer" (with what was typed in the search): the Customer step becomes its form until added.
  const [adding, setAdding] = useState<string | null>(null);
  const [addingBusy, setAddingBusy] = useState(false);
  const newCustomer = useRef<{ save: () => void } | null>(null);
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
  // The window in steps (design 17 Nov): Customer · Items · Details · Files.
  const [step, setStep] = useState<RequestStep>(startStep);
  // The items on a copy; changing a saved list asks why before the save (kept with the edit).
  const sheet = useItemRows(items);
  const [why, setWhy] = useState<string | null>(null);
  const [askingWhy, setAskingWhy] = useState(false);
  const sendAfterWhy = useRef(false);
  const anchor = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!sendAfterWhy.current) return;
    sendAfterWhy.current = false;
    anchor.current?.form?.requestSubmit();
  }, [why]);
  const create = mode === "create";
  // A new inquiry ends on Review (design rules 18 Nov): the whole request in its page's boxes, then Confirm and save.
  const STEPS = create ? REQUEST_STEPS : REQUEST_STEPS.filter((x) => x.key !== "review");
  const at = Math.max(0, STEPS.findIndex((x) => x.key === step));
  const last = at === STEPS.length - 1;
  const go = (k: number) => setStep(STEPS[Math.min(Math.max(k, 0), STEPS.length - 1)]!.key);

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
    // A changed list of items is kept as an edit of the items, with its reason ("Edited n×").
    if (!create && sheet.dirty && itemsEdit && (why || !itemsEdit.card?.first))
      await recordEditAction({
        ...itemsEdit.edit,
        kind: why ? "edit" : "first",
        reason: why ?? undefined,
        changes: sheet.diff.changes.slice(0, 60),
        keys: sheet.diff.keys.slice(0, 500),
      }).catch(() => undefined);
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
    onSaved({ id, refNo, title: v.title.trim() || undefined, customer: v.customer?.name, files: list.length });
    return { ok: true };
  };

  const contactLine = (c: ContactOption) => [c.name, c.email ?? c.whatsapp ?? c.phone].filter(Boolean).join(" · ");
  const mainContact = !!contacts.find((c) => c.id === v.contactId)?.isPrimary;
  const assignable = canAssignOthers ? people : people.filter((p) => p.id === meId || p.id === initial.assigneeId);
  const required = sheet.rows.length === 0;
  // The items go with the save: a new inquiry's always, an edit's when they changed.
  const body = { ...payload(v), ...(create || sheet.dirty ? { items: itemsBody(sheet.list) } : {}) };
  const itemErrors = (errors: ActionState["errors"]) =>
    Object.entries(errors ?? {})
      .filter(([k, list]) => list?.length && k.startsWith("items."))
      .map(([k, list]) => `Item ${Number(k.split(".")[1]) + 1}: ${list![0]}`)
      .filter((x, n, all) => all.indexOf(x) === n);

  // What closing now would lose, in a few words, for "Discard your change?" (design rules 18 Nov).
  const reportLost = useReportLost();
  const reportDirty = useReportDirty();
  const lost = useMemo(
    () => lostLines(initial, v, { contacts, people, meId, items: sheet.rows, itemsDirty: sheet.dirty, itemChanges: sheet.diff.changes.length, staged: staged.length, create }),
    [initial, v, contacts, people, meId, sheet.rows, sheet.dirty, sheet.diff.changes.length, staged.length, create],
  );
  const lostKey = lost.join("\n");
  useEffect(() => {
    reportLost(
      lost.length
        ? create
          ? { title: "Close without saving?", text: "This new inquiry isn’t saved yet. These will be lost:", lines: lost }
          : { lines: lost }
        : null,
    );
    reportDirty(lost.length ? true : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the words, not the list's identity
  }, [lostKey, create, reportLost, reportDirty]);

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
    <PanelBody fill>
      <ActionForm
        action={submit}
        keepFields
        showSuccess={false}
        className={cn(PANEL_FORM, "min-h-0 gap-0")}
        beforeSend={() => {
          // A new inquiry is saved from Review only: Enter (or Ctrl+Enter) on a step goes on to the next one.
          if (create && step !== "review") {
            go(at + 1);
            return false;
          }
          // A saved list changed: why, first (then it sends itself).
          if (create || !sheet.dirty || !sheet.askWhy || why !== null) return true;
          setAskingWhy(true);
          return false;
        }}
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
            <input ref={anchor} type="hidden" name="payload" value={JSON.stringify(body)} />
            {why && <input type="hidden" name="reason" value={why} />}
            <StepsFrame
              steps={STEPS.map((x, k) => ({
                key: x.key,
                label: x.label,
                summary:
                  x.key === "customer"
                    ? [v.customer?.name, CHANNEL_LABEL[v.channel]].filter(Boolean).join(" · ") || undefined
                    : x.key === "items"
                      ? sheet.rows.length
                        ? itemsCount(sheet.rows)
                        : "none yet"
                      : x.key === "details"
                      ? [v.category, PRIORITY_LABEL[v.priority as keyof typeof PRIORITY_LABEL]].filter(Boolean).join(" · ") || undefined
                      : x.key === "review"
                      ? undefined
                      : files.length + staged.length
                        ? `${files.length + staged.length} file${files.length + staged.length === 1 ? "" : "s"}`
                        : undefined,
                done: !create || k < at,
              }))}
              at={step}
              onGo={setStep}
              single={only}
              footer={
                step === "customer" && adding !== null ? (
                  <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-line bg-surface px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:px-4">
                    <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
                      <ChevronLeft aria-hidden /> Back to search
                    </Button>
                    <span className="flex-1" />
                    <Button type="button" variant="strong" size="lg" disabled={addingBusy} onClick={() => newCustomer.current?.save()} className="max-md:h-11">
                      <Check aria-hidden /> {addingBusy ? "Adding…" : "Add and use"}
                    </Button>
                  </div>
                ) : only ? (
                  <OnePartFooter onAllSteps={onAllSteps} saveLabel="Save changes" />
                ) : (
                <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-line bg-surface px-6 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-md:px-4">
                  {/* One strong button (design rules 18 Nov): Next is soft, Back and Review are words; ✕ closes, there is no Cancel. */}
                  {at > 0 ? (
                    <Button type="button" variant="ghost" onClick={() => go(at - 1)} aria-label="Back" className="max-md:size-11 max-md:px-0">
                      <ChevronLeft aria-hidden /> <span className="max-md:hidden">Back</span>
                    </Button>
                  ) : null}
                  <span className="flex-1 max-md:hidden" />
                  {create && step === "review" ? (
                    <SubmitButton variant="strong" size="lg" pendingText={uploading ? "Uploading files…" : "Saving…"} className="max-md:flex-1">
                      <Check aria-hidden /> Confirm and save
                    </SubmitButton>
                  ) : (
                    <>
                      <span className="flex-1 md:hidden" />
                      {create && at < STEPS.length - 2 && (
                        <Button type="button" variant="ghost" onClick={() => setStep("review")}>
                          Review
                        </Button>
                      )}
                      {!create && (
                        <SubmitButton variant="strong" pendingText={uploading ? "Uploading files…" : "Saving…"}>
                          <Check aria-hidden /> Save changes
                        </SubmitButton>
                      )}
                      {!last && (
                        <Button type="button" variant="soft" onClick={() => go(at + 1)}>
                          Next <ChevronRight aria-hidden />
                        </Button>
                      )}
                    </>
                  )}
                </div>
                )
              }
            >
            {/* A refused field on another part: every step, at that one. */}
            <JumpToStep
              st={s}
              onJump={(k) => {
                setStep(k);
                if (only && k !== step) onAllSteps?.();
              }}
            />
            {step === "customer" &&
              (adding !== null && addCustomer ? (
                <NewCustomerForm
                  initialName={adding}
                  add={addCustomer}
                  search={searchCustomers}
                  onReady={(api) => {
                    newCustomer.current = api;
                  }}
                  onBusy={setAddingBusy}
                  onUse={(c, list) => {
                    setAdding(null);
                    void chooseCustomer(c, list);
                  }}
                />
              ) : (
              <PanelSection quiet title="Who asked" first className="md:grid-cols-3">
                <Field label="Customer" htmlFor="customer" required error={s.errors?.customerId} className="md:col-span-2">
                  <CustomerPicker
                    value={v.customer}
                    onChange={(c) => void chooseCustomer(c)}
                    search={searchCustomers}
                    recent={recentCustomers}
                    onNew={canAddCustomer && addCustomer && !customerLocked ? (typed) => setAdding(typed) : undefined}
                    error={s.errors?.customerId}
                    disabled={!!customerLocked}
                    disabledReason={customerLocked}
                  />
                </Field>
                <Field
                  label={
                    <>
                      Contact
                      {/* The main contact is chosen for you, and says so. */}
                      {mainContact && <span className="rounded-full bg-primary-soft px-2 py-px text-[11.5px] font-semibold text-primary">Main contact</span>}
                    </>
                  }
                  htmlFor="contactId"
                  error={s.errors?.contactId}
                >
                  <Select id="contactId" value={v.contactId} onChange={(e) => set("contactId", e.target.value)} disabled={!v.customer}>
                    <option value="">{v.customer ? "None" : "Choose a customer first"}</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {contactLine(c)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Came by" htmlFor="channel" required error={s.errors?.channel} className="md:col-span-3">
                  <ChoiceChips id="channel" label="Came by" value={v.channel} options={INQUIRY_CHANNELS} labels={CHANNEL_LABEL} onChange={(c) => set("channel", c)} invalid={!!s.errors?.channel} />
                </Field>
                <Field label="Needed by" htmlFor="requiredBy" optional error={s.errors?.requiredBy}>
                  <Input id="requiredBy" type="date" value={v.requiredBy} onChange={(e) => set("requiredBy", e.target.value)} />
                </Field>
                <Field label="Responsible person" htmlFor="assigneeId" error={s.errors?.assigneeId}>
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
              ))}

            {step === "items" && (
              <PanelSection quiet title="Items they asked for" first className="sm:grid-cols-1">
                <LineTable
                  rows={sheet.rows}
                  columns={ITEM_COLUMNS}
                  noun="item"
                  sheet={{ name: "Customer items", upload: itemsUpload }}
                  error={itemErrors(s.errors).length ? undefined : s.errors?.items?.[0]}
                  duplicates
                  {...sheet.handlers}
                />
                {itemErrors(s.errors).length > 0 && (
                  <div role="alert" className="flex flex-col gap-0.5 rounded-xl border border-bad/30 bg-bad-soft px-3 py-2.5 text-sm text-bad">
                    <span className="font-semibold">Fix {itemErrors(s.errors).length === 1 ? "this item" : "these items"}, then save again:</span>
                    {itemErrors(s.errors).map((e) => (
                      <span key={e}>{e}</span>
                    ))}
                  </div>
                )}
                {!create && sheet.dirty && (
                  <p className="text-[13px] text-text-2">
                    {`${sheet.diff.changes.length} change${sheet.diff.changes.length === 1 ? "" : "s"} to the items, saved with the rest${sheet.askWhy ? " · Save asks why" : ""}.`}
                  </p>
                )}
              </PanelSection>
            )}

            {step === "details" && (
            <PanelSection quiet title="What they need" first className="md:grid-cols-3">
              <Field label="Inquiry title" htmlFor="title" error={s.errors?.title}>
                <Input id="title" value={v.title} onChange={(e) => set("title", e.target.value)} maxLength={200} />
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
                  <Input aria-label="Category name" value={v.category} onChange={(e) => set("category", e.target.value)} maxLength={120} autoFocus />
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
                  
                  onChange={(e) => set("requirements", e.target.value)}
                />
              </Field>
            </PanelSection>
            )}

            {step === "files" && (
            <PanelSection quiet title="Files from the customer" first className="sm:grid-cols-1">
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
            )}


            {step === "review" && (
              <ReviewBoxes
                v={v}
                contacts={contacts}
                people={people}
                meId={meId}
                rows={sheet.rows}
                files={[...files.map((f) => ({ key: f.id, name: f.fileName, meta: f.meta })), ...staged.map((f) => ({ key: f.key, name: f.file.name, meta: ATTACHMENT_KIND_LABEL[f.kind] }))]}
                onEdit={(k) => setStep(k)}
              />
            )}
            </StepsFrame>
          </>
        )}
      </ActionForm>
      {askingWhy && (
        <ReasonDialog
          n={(itemsEdit?.card?.count ?? 0) + 1}
          title="Why are you changing the items?"
          changes={sheet.diff.changes}
          saveLabel="Save changes"
          onCancel={() => setAskingWhy(false)}
          onSave={(reason) => {
            setAskingWhy(false);
            sendAfterWhy.current = true;
            setWhy(reason);
          }}
        />
      )}
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
 * "+ New customer" from the picker (design rules 18 Nov): the Customer step becomes this form, with what was typed
 * as the name. Company or individual, name and country, the main contact; More holds the rest. A customer with a
 * similar name shows above it with Use this one. The window's bottom bar has Back to search and Add and use.
 */
function NewCustomerForm({
  initialName,
  add,
  search,
  onUse,
  onReady,
  onBusy,
}: {
  initialName: string;
  add: (v: QuickCustomer) => Promise<QuickCustomerResult>;
  search: (q: string) => Promise<CustomerOption[]>;
  onUse: (c: CustomerOption, contacts?: ContactOption[]) => void;
  /** Gives the window's Add and use its way in. */
  onReady: (api: { save: () => void }) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [q, setQ] = useState<QuickCustomer>({ type: "company", name: initialName, country: UNKNOWN_COUNTRY, contact: "", position: "", email: "", phone: "", whatsapp: "", address: "", taxNo: "", defaultCurrency: "USD", initials: "" });
  const [sameWhatsapp, setSameWhatsapp] = useState(true);
  const [more, setMore] = useState(false);
  const [result, setResult] = useState<Extract<QuickCustomerResult, { ok: false }> | null>(null);
  const [found, setFound] = useState<{ name: string; list: CustomerOption[] }>({ name: "", list: [] });
  const set = (k: keyof QuickCustomer, value: string) => setQ((s) => ({ ...s, [k]: value }));
  const err = (k: string) => result?.errors?.[k]?.[0];
  const contactErr = (k: string) => result?.errors?.[`contacts.0.${k}`]?.[0] ?? (k === "name" ? result?.errors?.contacts?.[0] : undefined);

  // A customer with a similar name is shown while typing (nothing is stopped: a new one can still be added).
  const name = q.name.trim();
  useEffect(() => {
    if (name.length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      const list = await search(name);
      const words = name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      if (live) setFound({ name, list: list.filter((c) => words.some((w) => c.name.toLowerCase().includes(w))).slice(0, 2) });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, search]);
  const similar = name.length >= 3 && found.name === name ? found.list : [];

  const save = async (allowDuplicate = false) => {
    onBusy(true);
    const r = await add({ ...q, contact: q.contact.trim() || (q.type === "individual" ? q.name : ""), whatsapp: sameWhatsapp ? "" : q.whatsapp, allowDuplicate });
    onBusy(false);
    if (r.ok) onUse(r.customer, r.contacts);
    else setResult(r);
  };
  const saveNow = useRef(save);
  useEffect(() => {
    saveNow.current = save;
  });
  useEffect(() => {
    onReady({ save: () => void saveNow.current() });
  }, [onReady]);

  const use = async (m: { id: string; label: string }) => {
    const found = (await search(m.label)).find((c) => c.id === m.id);
    onUse(found ?? { id: m.id, name: m.label, country: UNKNOWN_COUNTRY, primaryContact: null });
  };
  const matches = result?.matches?.length ? result.matches.map((m) => ({ id: m.id, label: m.label, detail: m.detail ?? "" })) : similar.map((c) => ({ id: c.id, label: c.name, detail: [countryName(c.country), c.primaryContact?.name].filter(Boolean).join(" · ") }));

  return (
    <section aria-label="New customer" className="flex flex-col gap-4" onKeyDown={noSubmit}>
      <div className="-mb-1 flex items-center gap-2">
        <h4 className="text-base font-bold">New customer</h4>
      </div>
      {matches.length > 0 && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2.5 text-[13.5px]">
          {matches.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="min-w-0 flex-1">
                Already a customer? <b className="font-semibold">{m.label}</b>
                {m.detail && <span className="text-text-2"> · {m.detail}</span>}
              </span>
              <Button size="sm" onClick={() => void use(m)}>
                Use this one
              </Button>
            </div>
          ))}
          {result?.matches?.length ? (
            <Button size="xs" variant="ghost" className="self-start" onClick={() => void save(true)}>
              It’s a different customer: add it anyway
            </Button>
          ) : null}
        </div>
      )}
      {result && !result.matches?.length && !Object.keys(result.errors ?? {}).length && <p className="text-sm text-bad">{result.message}</p>}
      <ChoiceChips label="Type" value={q.type ?? "company"} options={PARTY_TYPES} labels={PARTY_TYPE_LABEL} onChange={(t) => set("type", t)} />
      <div className="grid gap-x-4 gap-y-3.5 md:grid-cols-3">
        <Field label="Name" htmlFor="qc-name" required error={err("name")} className="md:col-span-2">
          <Input id="qc-name" value={q.name} onChange={(e) => set("name", e.target.value)} maxLength={200} autoFocus />
        </Field>
        <Field label="Country" htmlFor="qc-country" required error={err("country")}>
          <CountrySelect id="qc-country" value={q.country} onChange={(e) => set("country", e.target.value)} />
        </Field>
      </div>
      <p className="-mb-1 text-xs font-semibold tracking-wide text-text-2 uppercase">Main contact</p>
      <div className="grid gap-x-4 gap-y-3.5 md:grid-cols-3">
        <Field label="Name" htmlFor="qc-contact" required={q.type !== "individual"} error={contactErr("name")}>
          <Input id="qc-contact" value={q.contact} onChange={(e) => set("contact", e.target.value)} maxLength={120} />
        </Field>
        <Field label="Position" htmlFor="qc-position" optional error={contactErr("position")}>
          <Input id="qc-position" value={q.position} onChange={(e) => set("position", e.target.value)} maxLength={80} />
        </Field>
        <Field label="Email" htmlFor="qc-email" error={contactErr("email")}>
          <Input id="qc-email" type="email" value={q.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="qc-phone" error={contactErr("phone")}>
          <Input id="qc-phone" type="tel" value={q.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="WhatsApp" htmlFor="qc-whatsapp" error={contactErr("whatsapp")}>
          {sameWhatsapp ? (
            <label className="flex h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border border-line-strong bg-surface px-3 text-sm max-sm:h-11">
              <input id="qc-whatsapp" type="checkbox" role="switch" checked onChange={() => setSameWhatsapp(false)} className="peer sr-only" />
              <span aria-hidden className="relative h-5 w-9 rounded-full bg-primary-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-text after:absolute after:top-0.5 after:right-0.5 after:size-4 after:rounded-full after:bg-white" />
              Same as phone
            </label>
          ) : (
            <Input id="qc-whatsapp" type="tel" value={q.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} autoFocus />
          )}
        </Field>
      </div>
      <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)} className="flex items-center gap-1.5 self-start text-sm font-semibold text-primary hover:underline">
        <ChevronRight aria-hidden className={cn("size-4 transition-transform", more && "rotate-90")} /> More: address, tax no., currency, initials
      </button>
      {more && (
        <div className="grid gap-x-4 gap-y-3.5 md:grid-cols-3">
          <Field label="Address" htmlFor="qc-address" optional error={err("address")} className="md:col-span-3">
            <Input id="qc-address" value={q.address} onChange={(e) => set("address", e.target.value)} maxLength={500} />
          </Field>
          <Field label="Tax no." htmlFor="qc-tax" optional error={err("taxNo")}>
            <Input id="qc-tax" value={q.taxNo} onChange={(e) => set("taxNo", e.target.value)} maxLength={60} />
          </Field>
          <Field label="Currency" htmlFor="qc-currency" error={err("defaultCurrency")}>
            <CurrencySelect id="qc-currency" value={q.defaultCurrency ?? "USD"} onChange={(e) => set("defaultCurrency", e.target.value)} />
          </Field>
          <Field label="Initials on papers" htmlFor="qc-initials" optional error={err("initials")}>
            <Input id="qc-initials" value={q.initials} onChange={(e) => set("initials", e.target.value.toUpperCase())} maxLength={6} />
          </Field>
        </div>
      )}
    </section>
  );
}

/** The inquiry's window in steps (design 17 Nov): who asked, their items, the details, their files, then Review (a new one). */
export type RequestStep = "customer" | "items" | "details" | "files" | "review";
const REQUEST_STEPS: { key: RequestStep; label: string }[] = [
  { key: "customer", label: "Customer" },
  { key: "items", label: "Items" },
  { key: "details", label: "Details" },
  { key: "files", label: "Files" },
  { key: "review", label: "Review" },
];

/** "3 items, 2 parts": the lines of a list, its parts counted apart. */
export function itemsCount(rows: Pick<LineRow, "parentKey">[]) {
  const parts = rows.filter((r) => r.parentKey).length;
  const items = rows.length - parts;
  return [`${items} item${items === 1 ? "" : "s"}`, parts ? `${parts} part${parts === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
}

/** The lines numbered as the page shows them: 1, 2, 2.1, 2.2, 3. */
export function numbered<T extends Pick<LineRow, "key" | "parentKey">>(rows: T[]): (T & { no: string })[] {
  const top = new Map<string, number>();
  const parts = new Map<string, number>();
  let n = 0;
  return rows.map((r) => {
    if (!r.parentKey) {
      top.set(r.key, ++n);
      return { ...r, no: String(n) };
    }
    const k = (parts.get(r.parentKey) ?? 0) + 1;
    parts.set(r.parentKey, k);
    return { ...r, no: `${top.get(r.parentKey) ?? "?"}.${k}` };
  });
}

const personName = (people: PersonWithRole[], id: string, meId: string) => (id ? `${people.find((p) => p.id === id)?.name ?? "Someone"}${id === meId ? " (me)" : ""}` : "Nobody yet");

/**
 * What closing the window now would lose, a line each: a new inquiry lists what was filled in
 * ("Customer: Techtribe"); an edit lists each change, old → new ("Came by: Email → WhatsApp").
 */
function lostLines(
  a: DealFormValues,
  b: DealFormValues,
  o: { contacts: ContactOption[]; people: PersonWithRole[]; meId: string; items: LineRow[]; itemsDirty: boolean; itemChanges: number; staged: number; create: boolean },
): string[] {
  const contact = (id: string) => (id ? (o.contacts.find((c) => c.id === id)?.name ?? "another contact") : "none");
  const fields: [string, string, string][] = [
    ["Customer", a.customer?.name ?? "none", b.customer?.name ?? "none"],
    ["Contact", contact(a.contactId), contact(b.contactId)],
    ["Came by", CHANNEL_LABEL[a.channel], CHANNEL_LABEL[b.channel]],
    ["Needed by", a.requiredBy ? date(a.requiredBy) : "none", b.requiredBy ? date(b.requiredBy) : "none"],
    ["Responsible person", personName(o.people, a.assigneeId, o.meId), personName(o.people, b.assigneeId, o.meId)],
    ["Inquiry title", a.title.trim() || "none", b.title.trim() || "none"],
    ["Category", a.category.trim() || "none", b.category.trim() || "none"],
    ["Priority", PRIORITY_LABEL[a.priority as keyof typeof PRIORITY_LABEL] ?? a.priority, PRIORITY_LABEL[b.priority as keyof typeof PRIORITY_LABEL] ?? b.priority],
    ["What they need", a.requirements.trim() ? "written" : "none", b.requirements.trim() ? (a.requirements.trim() ? "changed" : "written") : "none"],
  ];
  const out = fields
    .filter(([label, x, y], k) => (k === 1 && a.customer?.id !== b.customer?.id ? false : label === "What they need" ? a.requirements.trim() !== b.requirements.trim() : x !== y))
    .map(([label, x, y]) => (o.create ? `${label}: ${y}` : `${label}: ${x} → ${y}`));
  if (o.create ? o.items.length > 0 : o.itemsDirty)
    out.push(o.create ? `Items: ${itemsCount(o.items)}` : `Items: ${o.itemChanges} change${o.itemChanges === 1 ? "" : "s"}`);
  if (o.staged) out.push(`Files: ${o.staged} to add`);
  return out;
}

/** The inquiry as its page will show it (design rules 18 Nov): the same boxes, each with Edit back to its step. */
function ReviewBoxes({
  v,
  contacts,
  people,
  meId,
  rows,
  files,
  onEdit,
}: {
  v: DealFormValues;
  contacts: ContactOption[];
  people: PersonWithRole[];
  meId: string;
  rows: LineRow[];
  files: { key: string; name: string; meta: string }[];
  onEdit: (step: RequestStep) => void;
}) {
  const contact = contacts.find((c) => c.id === v.contactId);
  const missing = (what: string) => <span className="font-semibold text-bad">{what}</span>;
  const lines = numbered(rows);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid gap-3.5 md:grid-cols-2 md:items-start">
        <ReviewBox title="Customer" onEdit={() => onEdit("customer")}>
          <Facts
            rows={[
              ["Customer", v.customer ? [v.customer.name, countryName(v.customer.country)].join(" · ") : missing("Not chosen yet")],
              ["Contact", contact ? [contact.name, contact.email ?? contact.whatsapp ?? contact.phone].filter(Boolean).join(" · ") : "—"],
              ["Came by", CHANNEL_LABEL[v.channel]],
              ["Needed by", v.requiredBy ? date(v.requiredBy) : "—"],
              ["Responsible", personName(people, v.assigneeId, meId)],
            ]}
          />
        </ReviewBox>
        <ReviewBox title="Details" onEdit={() => onEdit("details")}>
          <Facts
            rows={[
              ["Inquiry title", v.title.trim() || "—"],
              ["Category", v.category.trim() || missing("Not chosen yet")],
              ["Priority", PRIORITY_LABEL[v.priority as keyof typeof PRIORITY_LABEL] ?? v.priority],
              ["What they need", v.requirements.trim() ? <span className="line-clamp-3 whitespace-pre-line">{v.requirements.trim()}</span> : rows.length ? "—" : missing("Write it, or add items")],
            ]}
          />
        </ReviewBox>
      </div>
      <ReviewBox title="Items" count={rows.length ? itemsCount(rows) : undefined} onEdit={() => onEdit("items")}>
        {lines.length ? (
          <ul className="text-[13.5px]">
            {lines.map((r) => (
              <li key={r.key} className={cn("flex items-baseline gap-3 border-t border-line px-4 py-2 first:border-t-0", r.parentKey && "pl-9")}>
                <span className="w-7 shrink-0 text-text-2 tabular">{r.no}</span>
                <span className="min-w-0 flex-1">
                  <span className={r.parentKey ? "" : "font-semibold"}>{r.values.description || "—"}</span>
                  {r.values.model && <span className="text-text-2"> · {r.values.model}</span>}
                </span>
                <span className="shrink-0 text-text-2 tabular">
                  {[r.values.quantity, r.values.unit].filter(Boolean).join(" ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-text-2">None yet</p>
        )}
      </ReviewBox>
      <ReviewBox title="Files" count={files.length ? String(files.length) : undefined} onEdit={() => onEdit("files")}>
        {files.length ? (
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {files.map((f) => (
              <span key={f.key} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[13px]">
                <FileText aria-hidden className="size-3.5 shrink-0 text-text-2" />
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-text-2">{f.meta.split(" · ")[0]}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-text-2">None</p>
        )}
      </ReviewBox>
    </div>
  );
}

/** One box of the Review step: its name (and count), Edit, then what it holds. */
function ReviewBox({ title, count, onEdit, children }: { title: string; count?: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-4">
        <h4 className="text-sm font-bold">{title}</h4>
        {count && <span className="text-xs text-text-2">{count}</span>}
        <span className="flex-1" />
        <Button type="button" size="xs" variant="ghost" onClick={onEdit} className="text-primary hover:text-primary">
          <Pencil aria-hidden /> Edit<span className="sr-only"> {title.toLowerCase()}</span>
        </Button>
      </header>
      {children}
    </section>
  );
}

/** Label · value rows, the label quiet. */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-3 text-[13.5px]">
      {rows.map(([k, val]) => (
        <div key={k} className="contents">
          <dt className="text-text-2">{k}</dt>
          <dd className="min-w-0 font-medium break-words">{val}</dd>
        </div>
      ))}
    </dl>
  );
}
const DETAIL_FIELDS = new Set(["title", "category", "priority", "requirements"]);

/** A save refused for a field on another step opens that step, so the field and its message are in view. */
function JumpToStep({ st, onJump }: { st: ActionState; onJump: (step: RequestStep) => void }) {
  // Once per answer: a later step change by hand is not undone.
  const jump = useRef(onJump);
  useEffect(() => {
    jump.current = onJump;
  });
  useEffect(() => {
    const first = Object.keys(st.errors ?? {}).find((k) => st.errors?.[k]?.length);
    if (first) jump.current(first === "items" || first.startsWith("items.") ? "items" : DETAIL_FIELDS.has(first) ? "details" : "customer");
  }, [st]);
  return null;
}
