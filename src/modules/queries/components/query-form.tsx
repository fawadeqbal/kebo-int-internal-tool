"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, ButtonLink, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/ui/client";
import { PRIORITY_LABEL, SOURCE_LABEL } from "@/lib/labels";
import type { ActionState } from "@/lib/utils/result";
import { CustomerFields, DuplicateWarning } from "@/modules/customers/components";
import { CustomerPicker, type CustomerOption } from "./customer-picker";
import { FilePicker, uploadFiles } from "./uploader";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export interface QueryFormInitial {
  customer?: CustomerOption | null;
  source?: string;
  title?: string;
  category?: string | null;
  specifications?: string;
  quantity?: number;
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
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.message && !state.ok && !state.meta?.duplicates && <Alert tone="error">{state.message}</Alert>}

      <Card>
        <CardHeader
          title="Buyer"
          description={mode === "create" ? "Search by name, company or phone, or add a new buyer." : undefined}
          actions={
            mode === "create" && (
              <div role="radiogroup" aria-label="Customer type" className="flex rounded-lg border border-line p-0.5 text-sm">
                {(["existing", "new"] as const).map((m) => (
                  <label key={m} className={`cursor-pointer rounded-md px-3 py-1 ${customerMode === m ? "bg-brand-600 text-white" : "text-muted hover:text-ink"}`}>
                    <input type="radio" name="customerMode" value={m} checked={customerMode === m} onChange={() => setCustomerMode(m)} className="sr-only" />
                    {m === "existing" ? "Existing buyer" : "New buyer"}
                  </label>
                ))}
              </div>
            )
          }
        />
        <CardBody className="flex flex-col gap-4">
          {mode === "edit" && <input type="hidden" name="customerMode" value="existing" />}
          {customerMode === "existing" ? (
            <Field label="Buyer" htmlFor="customer-search" required error={e.customerId}>
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
        <CardHeader title="What does the buyer need?" />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Sourcing category" htmlFor="category" required error={e.category}>
            <Select id="category" name="category" defaultValue={v("category", initial?.category ?? "")} aria-invalid={!!e.category}>
              <option value="" disabled>
                Choose a sourcing category…
              </option>
              {[...categories, ...(initial?.category && !categories.includes(initial.category) ? [initial.category] : [])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Received via" htmlFor="source" error={e.source}>
            <Select id="source" name="source" defaultValue={v("source", initial?.source ?? "whatsapp")}>
              {Object.entries(SOURCE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Requirements"
            htmlFor="specifications"
            required
            error={e.specifications}
            hint="Machine or product, model, capacity, quantity, destination port, delivery time"
            className="sm:col-span-2"
          >
            <Textarea id="specifications" name="specifications" rows={6} defaultValue={v("specifications", initial?.specifications)} aria-invalid={!!e.specifications} />
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
          <details className="group sm:col-span-2" open={mode === "edit" || !!(e.title || e.quantity || e.requiredBy)}>
            <summary className="cursor-pointer select-none text-sm font-medium text-brand-700 hover:underline">More details (optional)</summary>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <Field label="Short title" htmlFor="title" error={e.title} hint="Leave empty to use the first line of the requirements" className="sm:col-span-2">
                <Input id="title" name="title" defaultValue={v("title", initial?.title)} maxLength={200} />
              </Field>
              <Field label="Quantity" htmlFor="quantity" error={e.quantity}>
                <Input id="quantity" name="quantity" type="number" min={1} step={1} inputMode="numeric" defaultValue={v("quantity", initial?.quantity ?? 1)} />
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
              <Field label="Needed by" htmlFor="requiredBy" error={e.requiredBy} hint="When the buyer needs the quotation or delivery">
                <Input id="requiredBy" name="requiredBy" type="date" defaultValue={v("requiredBy", initial?.requiredBy)} />
              </Field>
            </div>
          </details>
        </CardBody>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader title="Files (optional)" description="Drawings, spec sheets, photos, factory quotes" />
          <CardBody>
            <FilePicker files={files} onChange={setFiles} maxMb={maxUploadMb} />
          </CardBody>
        </Card>
      )}

      <div className="flex items-center gap-3">
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
