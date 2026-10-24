"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, ButtonLink, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { PRIORITY_LABEL, SOURCE_LABEL } from "@/lib/labels";
import type { ActionState } from "@/lib/utils/result";
import { CustomerFields, DuplicateWarning } from "@/modules/customers/components";
import { LineItemsEditor } from "@/components/documents/line-items-editor";
import type { EditableLine } from "@/lib/line-items";
import { CustomerPicker, type CustomerOption } from "./customer-picker";
import { FilePicker, uploadFiles } from "./uploader";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface QueryFormInitial {
  customer?: CustomerOption | null;
  source?: string;
  title?: string;
  category?: string | null;
  items?: EditableLine[];
  specifications?: string | null;
  priority?: string;
  requiredBy?: string | null;
}

export function QueryForm({
  action,
  mode,
  initial,
  people,
  canAssignOthers,
  currentUserId,
  cancelHref,
  maxUploadMb,
  categories,
  otherCategories = [],
}: {
  action: Action;
  mode: "create" | "edit";
  initial?: QueryFormInitial;
  people?: { id: string; name: string }[];
  canAssignOthers?: boolean;
  currentUserId?: string;
  cancelHref: string;
  maxUploadMb: number;
  categories: string[];
  /** Categories typed in earlier with "Other", offered as suggestions. */
  otherCategories?: string[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, {});
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    (state.values?.customerMode as "existing" | "new" | undefined) ?? "existing",
  );
  const [prefillCompany, setPrefillCompany] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<{ pct: number; error?: string } | null>(null);
  const e = state.errors ?? {};
  const v = (key: string, fallback?: string | number | null) => (state.values?.[key] as string | undefined) ?? (fallback === null || fallback === undefined ? "" : String(fallback));

  // After the query is created: upload any chosen files, then open the query.
  const createdId = state.ok ? (state.meta?.id as string | undefined) : undefined;
  useEffect(() => {
    if (!createdId) return;
    if (files.length === 0) {
      router.push(`/queries/${createdId}?toast=Inquiry+created`);
      return;
    }
    uploadFiles(createdId, files, (pct) => setUploadState({ pct }))
      .then(() => router.push(`/queries/${createdId}?toast=Inquiry+created`))
      .catch((err: Error) => setUploadState({ pct: 0, error: err.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdId]);

  if (createdId && uploadState?.error) {
    return (
      <Alert tone="warning">
        The query was saved, but the files could not be uploaded: {uploadState.error}{" "}
        <a href={`/queries/${createdId}`} className="font-medium underline">
          Open the inquiry
        </a>{" "}
        and try uploading again.
      </Alert>
    );
  }

  const tooLarge = files.some((f) => f.size > maxUploadMb * 1024 * 1024);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.message && !state.ok && !state.meta?.duplicates && <Alert tone="error">{state.message}</Alert>}

      <Card>
        <CardHeader
          title="Customer"
          description={mode === "create" ? "Search by name, company or phone, or add a new customer." : undefined}
          actions={
            mode === "create" && (
              <div role="radiogroup" aria-label="Customer type" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
                {(["existing", "new"] as const).map((m) => (
                  <label key={m} className={`inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 text-xs font-medium transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring ${customerMode === m ? "bg-surface text-text shadow-card" : "text-muted hover:text-text"}`}>
                    <input type="radio" name="customerMode" value={m} defaultChecked={customerMode === m} onChange={() => setCustomerMode(m)} className="sr-only" />
                    {m === "existing" ? "Existing customer" : "New customer"}
                  </label>
                ))}
              </div>
            )
          }
        />
        <CardBody className="flex flex-col gap-4">
          {mode === "edit" && <input type="hidden" name="customerMode" value="existing" />}
          {customerMode === "existing" ? (
            <Field label="Customer" htmlFor="customer-search" required error={e.customerId}>
              <CustomerPicker
                name="customerId"
                initial={initial?.customer}
                error={e.customerId?.[0]}
                onCreateNew={
                  mode === "create"
                    ? (text) => {
                        setPrefillCompany(text);
                        setCustomerMode("new");
                      }
                    : undefined
                }
              />
            </Field>
          ) : (
            <>
              <DuplicateWarning state={state} />
              <CustomerFields state={state} initial={{ contactPerson: prefillCompany }} prefix="c-" compact />
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What does the customer need?" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <CategoryField categories={categories} suggestions={otherCategories} initial={v("category", initial?.category ?? "")} otherChosen={state.values?.categoryChoice === OTHER} error={e.category} />
          <Field label="Received via" htmlFor="source" error={e.source}>
            <Select id="source" name="source" defaultValue={v("source", initial?.source ?? "whatsapp")}>
              {Object.entries(SOURCE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <p className="text-sm font-medium text-text">
              Items <span className="text-bad">*</span>
            </p>
            <p className="-mt-1 text-xs text-muted">One line per machine or product: name on the first line, then capacity, voltage, size… The quotation starts from these.</p>
            <LineItemsEditor
              priced={false}
              initialItems={state.values?.items ? (JSON.parse(state.values.items as string) as EditableLine[]) : (initial?.items ?? [])}
              errors={e}
              placeholder={"e.g. Capsule filling machine\n25,000 capsules/hour, size 0–4"}
            />
          </div>
          <Field
            label="Other details"
            htmlFor="specifications"
            optional
            error={e.specifications}
            hint="Destination port, delivery time, standards, payment terms…"
            className="sm:col-span-2"
          >
            <Textarea id="specifications" name="specifications" rows={2} className="min-h-0" defaultValue={v("specifications", initial?.specifications)} />
          </Field>
          {mode === "create" && people && (
            <Field label="Handled by" htmlFor="assignedTo" error={e.assignedTo} hint={canAssignOthers ? "Who will source and quote this" : "Take it yourself, or leave it for a manager"}>
              <Select id="assignedTo" name="assignedTo" defaultValue={v("assignedTo", "")}>
                <option value="">Not assigned yet</option>
                {(canAssignOthers ? people : people.filter((p) => p.id === currentUserId)).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === currentUserId ? `${p.name} (me)` : p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <details className="group sm:col-span-2" open={mode === "edit" || !!(e.title || e.requiredBy)}>
            <summary className="cursor-pointer text-sm font-medium text-primary select-none hover:underline">More details (optional)</summary>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <Field label="Short title" htmlFor="title" optional error={e.title} hint="Leave empty to name it after the items" className="sm:col-span-2">
                <Input id="title" name="title" defaultValue={v("title", initial?.title)} maxLength={200} />
              </Field>
              <Field label="Priority" htmlFor="priority" error={e.priority}>
                <Select id="priority" name="priority" defaultValue={v("priority", initial?.priority ?? "normal")}>
                  {Object.entries(PRIORITY_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Needed by" htmlFor="requiredBy" optional error={e.requiredBy} hint="When the customer needs the quotation or delivery">
                <Input id="requiredBy" name="requiredBy" type="date" defaultValue={v("requiredBy", initial?.requiredBy)} />
              </Field>
            </div>
          </details>
        </CardBody>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader title="Files" description="Optional. Drawings, spec sheets, photos, factory quotes" />
          <CardBody>
            <FilePicker files={files} onChange={setFiles} maxMb={maxUploadMb} />
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton disabled={tooLarge || !!createdId} pendingText={mode === "create" ? "Creating…" : "Saving…"}>
          {mode === "create" ? "Create inquiry" : "Save changes"}
        </SubmitButton>
        <ButtonLink href={cancelHref} variant="secondary">
          Cancel
        </ButtonLink>
        {createdId && files.length > 0 && !uploadState?.error && <span className="text-sm text-muted">Uploading files… {uploadState?.pct ?? 0}%</span>}
      </div>
    </form>
  );
}

const OTHER = "__other__";

/**
 * The settings categories, plus "Other" to type a new one. Inputs are
 * uncontrolled (defaultValue mirrors state) so React's reset of the form
 * after a failed submit puts back what was chosen instead of blanking it.
 */
function CategoryField({ categories, suggestions, initial, error, otherChosen }: { categories: string[]; suggestions: string[]; initial: string; error?: string[]; otherChosen?: boolean }) {
  const listed = categories.some((c) => c === initial);
  const [choice, setChoice] = useState(otherChosen || (initial !== "" && !listed) ? OTHER : initial);
  const [custom, setCustom] = useState(listed ? "" : initial);
  const other = choice === OTHER;
  return (
    <div className="grid content-start gap-3">
      <Field label="Sourcing category" htmlFor="category-choice" required error={other ? undefined : error}>
        <Select
          id="category-choice"
          name={other ? "categoryChoice" : "category"}
          defaultValue={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-invalid={!other && !!error}
        >
          <option value="" disabled>
            Choose a sourcing category…
          </option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={OTHER}>Other (type your own)…</option>
        </Select>
      </Field>
      {other && (
        <Field label="Your category" htmlFor="category" required error={error} hint={suggestions.length ? "Pick one used before, or type a new one" : undefined}>
          <Input
            id="category"
            name="category"
            defaultValue={custom}
            onChange={(e) => setCustom(e.target.value)}
            list="category-suggestions"
            maxLength={120}
            placeholder="e.g. Packaging Machinery"
            autoFocus={initial === "" || listed}
            aria-invalid={!!error}
          />
          {suggestions.length > 0 && (
            <datalist id="category-suggestions">
              {suggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          )}
        </Field>
      )}
    </div>
  );
}
