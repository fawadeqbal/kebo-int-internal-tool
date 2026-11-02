"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Alert, Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** One field of a light row: what ticks it (required) or an optional one. */
export interface LightField {
  name: string;
  label: string;
  type?: "text" | "date" | "number" | "select" | "file" | "textarea";
  /** Filled in for the person: today, the forwarder of the last order like it, the banks of the last LC… */
  value?: string | null;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  max?: string;
  /** Under the field: where the value came from ("from SO-2026-0027"). */
  hint?: string;
}

/** "+ Loading photos": an optional field one tap away, added to the row's form. */
export interface LightChip {
  label: string;
  field: LightField;
}

/** A one-tap item: saves at once with today's date (or "all"). */
export interface LightTap {
  label: string;
  action: Action;
  /** Today (YYYY-MM-DD): sent as `on`. */
  on: string;
  /** More fields sent along (e.g. the shipments it applies to). */
  extra?: Record<string, string>;
}

/** Sends a file to the deal's files and answers its id (server actions cap bodies at 1 MB, so files go through a route). */
export async function uploadFile(dealId: string, file: File, note: string): Promise<{ id?: string; error?: string }> {
  const body = new FormData();
  body.set("file", file, file.name);
  body.set("kind", "other");
  body.set("note", note.slice(0, 300));
  try {
    const res = await fetch(`/files/inquiries/${dealId}`, { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) return { error: json.error ?? (res.status === 413 ? "This file is too large." : `Upload failed (${res.status})`) };
    return { id: json.id };
  } catch {
    return { error: "The connection dropped. Try again." };
  }
}

function Control({ f, id, value, onChange, onFile }: { f: LightField; id: string; value: string; onChange: (v: string) => void; onFile: (file: File | null) => void }) {
  if (f.type === "file")
    return <Input id={id} type="file" className="pt-1.5" onChange={(e) => onFile(e.target.files?.[0] ?? null)} accept={f.placeholder} />;
  if (f.type === "select")
    return (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {(f.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  if (f.type === "textarea")
    return <Textarea id={id} rows={2} className="min-h-0" value={value} maxLength={1000} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
  return (
    <Input
      id={id}
      type={f.type === "date" ? "date" : "text"}
      inputMode={f.type === "number" ? "decimal" : undefined}
      max={f.max}
      maxLength={f.type === "date" ? undefined : 200}
      value={value}
      placeholder={f.placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={f.type === "number" ? "tabular" : undefined}
    />
  );
}

/**
 * A light row's form (board OrderV4Shipping): only the fields that tick the
 * item, filled in with what we know, an optional one or two, and "Add if you
 * have it:" chips that bring more optional fields into the same row. Files
 * are plain uploads to the deal's files, kept with the item.
 */
export function LightForm({
  fields,
  chips = [],
  dealId,
  fileNote,
  save = "Save and tick",
  hint,
  onSubmit,
  onDone,
}: {
  fields: LightField[];
  chips?: LightChip[];
  dealId: string;
  /** The note the uploaded files get in the deal's files. */
  fileNote: string;
  save?: string;
  hint?: string;
  onSubmit: (values: Record<string, string>) => Promise<ActionState>;
  onDone: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [shown, setShown] = useState<LightField[]>(fields);
  const [left, setLeft] = useState<LightChip[]>(chips);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.value ?? ""])));
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const required = shown.filter((f) => f.required);

  const submit = () =>
    start(async () => {
      setError(null);
      const missing = required.filter((f) => (f.type === "file" ? !files[f.name] : !values[f.name]?.trim()));
      if (missing.length) return setError(`Fill in ${missing.map((f) => f.label.toLowerCase()).join(" and ")} to tick it.`);
      const out: Record<string, string> = {};
      for (const f of shown) if (f.type !== "file") out[f.name] = (values[f.name] ?? "").trim();
      for (const f of shown) {
        const file = f.type === "file" ? files[f.name] : null;
        if (!file) continue;
        setBusy(true);
        const up = await uploadFile(dealId, file, fileNote);
        setBusy(false);
        if (up.error || !up.id) return setError(up.error ?? "The file was not kept.");
        out[f.name] = up.id;
      }
      const r = await onSubmit(out);
      if (r.ok) {
        onDone();
        router.refresh();
      } else setError(r.message ?? "Something went wrong. Please try again.");
    });

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        {shown.map((f) => (
          <Field
            key={f.name}
            label={f.label}
            htmlFor={`${id}-${f.name}`}
            optional={!f.required}
            hint={f.hint}
            className={cn(f.type === "textarea" && "sm:col-span-3")}
          >
            <Control
              f={f}
              id={`${id}-${f.name}`}
              value={values[f.name] ?? ""}
              onChange={(v) => setValues((x) => ({ ...x, [f.name]: v }))}
              onFile={(file) => setFiles((x) => ({ ...x, [f.name]: file }))}
            />
          </Field>
        ))}
      </div>
      {left.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted">Add if you have it:</span>
          {left.map((c) => (
            <button
              key={c.field.name}
              type="button"
              onClick={() => {
                setShown((s) => [...s, c.field]);
                setValues((x) => ({ ...x, [c.field.name]: c.field.value ?? "" }));
                setLeft((l) => l.filter((x) => x !== c));
              }}
              className="inline-flex items-center gap-0.5 rounded-full border border-primary/30 px-2.5 py-1 font-medium text-primary hover:bg-primary-soft"
            >
              <Plus className="size-3" aria-hidden /> {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending || busy}>
          {busy ? "Sending the file…" : pending ? "Saving…" : save}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <span className="text-xs text-muted">
          {hint ?? (required.length && required.length < shown.length ? `Only the first ${required.length === 1 ? "one is" : `${required.length} are`} needed to tick it.` : null)}
        </span>
      </div>
    </form>
  );
}

/** The light form of an automatic item: its values go to the item's action as form fields. */
export function sendTo(action: Action, fixed?: Record<string, string>) {
  return (values: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...fixed, ...values })) form.set(k, v);
    return action({}, form);
  };
}

/** A one-tap button: "Ordered today", "All received", "Arrived today", "Done today", "All delivered OK". */
export function TapButton({ tap, primary, onError }: { tap: LightTap; primary?: boolean; onError: (m: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant={primary ? "primary" : "secondary"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          onError(null);
          const form = new FormData();
          form.set("on", tap.on);
          for (const [k, v] of Object.entries(tap.extra ?? {})) form.set(k, v);
          const r = await tap.action({}, form);
          if (r.ok) router.refresh();
          else onError(r.message ?? "Something went wrong. Please try again.");
        })
      }
    >
      {pending ? "Saving…" : tap.label}
    </Button>
  );
}
