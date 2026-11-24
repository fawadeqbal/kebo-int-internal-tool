"use client";

import { useId, useRef, useState, type ReactNode } from "react";

import { Button, cn, Field, Input, Select, Textarea, type ButtonSize, type ButtonVariant, Notice } from "@kebo/ui";
import { ChangeHint, changeKind, changeLine, changeWords, countChanges } from "@/components/common/change-words";
import { PanelBody, PanelSection, SidePanel, useClosePanel, WindowFooter } from "@/components/common/panel";
import { EditButton } from "@/components/common/edit-button";

import { useEditSave } from "@/components/edits/use-edit-save";
import type { EditCard, EditRef } from "@/lib/types-edits";
import type { ActionState } from "@/lib/actions";
import { formatDate, type TimeStyle } from "@kebo/utils";
import { timeStyle } from "@/lib/format";

import { useOpenFromLink } from "@/components/order-sections/section-window";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/* ---------------------------------------------------------------- helpers */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** "14 Jan 2027", the company's way. */
export const dayLabel = (iso: string | null | undefined, style: TimeStyle = timeStyle()) => (iso ? formatDate(iso, style) : "");

/* ---------------------------------------------------------------- the side panel (common/panel) */

/* ---------------------------------------------------------------- fields */

export type DetailType = "text" | "date" | "number" | "select" | "textarea";

/** One value of a view card: shown, counted in "n of m filled", added in place, and edited in the panel. */
export interface DetailField {
  /** What the action is sent (empty: shown only). */
  name?: string;
  label: string;
  /** Its label in the panel, when the card's is shorter ("Container" → "Container no."). */
  panelLabel?: string;
  /** The value as it is edited (YYYY-MM-DD for dates). */
  value: string | null | undefined;
  /** How it reads (default: the value, dates as "14 Jan 2027"). */
  show?: ReactNode;
  type?: DetailType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  max?: string;
  /** The panel's group heading ("Way and ports"). */
  group?: string;
  /** Left out of "n of m filled". */
  uncounted?: boolean;
  /** Only in the panel; only in the card. */
  panelOnly?: boolean;
  cardOnly?: boolean;
  /** Takes a whole row in the panel. */
  wide?: boolean;
  /** Shown in the panel but not changed there (e.g. worked out). */
  hint?: string;
  /** Shown in the card when it is empty, instead of "+ Add" or "—" (e.g. a file's own add button). */
  empty?: ReactNode;
  /** Its stable name (data-target) when it has no `name` (or another one): the card's target + "." + this. */
  target?: string;
  /** Filled, it is not changed in place (only in the panel). */
  fixed?: boolean;
}

function Control({ f, id, value, onChange, autoFocus, onKeyDown }: { f: DetailField; id: string; value?: string; onChange?: (v: string) => void; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent) => void }) {
  const common = {
    id,
    name: f.name,
    autoFocus,
    onKeyDown,
    ...(onChange ? { value: value ?? "", onChange: (e: { target: { value: string } }) => onChange(e.target.value) } : { defaultValue: f.value ?? "" }),
  };
  if (f.type === "select")
    return (
      <Select {...common}>
        {(f.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  if (f.type === "textarea") return <Textarea {...common} rows={2} className="min-h-0" maxLength={2000} placeholder={f.placeholder} />;
  return (
    <Input
      {...common}
      type={f.type === "date" ? "date" : "text"}
      inputMode={f.type === "number" ? "decimal" : undefined}
      max={f.max}
      maxLength={f.type === "date" ? undefined : 200}
      placeholder={f.placeholder}
      className={f.type === "number" ? "tabular" : undefined}
    />
  );
}

/** How a value reads in "what changed": a choice's label, a date as "14 Jan 2027"; empty is "" (then it is Added). */
const changeText = (f: DetailField, v: string) =>
  (f.options?.find((o) => o.value === v)?.label ?? (f.type === "date" && ISO.test(v) ? dayLabel(v) : v.length > 40 ? `${v.slice(0, 39)}…` : v)) || "";

/**
 * The full form of a card in the panel: its fields grouped, Save / Cancel.
 * Filling an empty value saves plainly; changing a saved one asks why first
 * (Edit n), and the edit is kept for the card's "Edited n×" (`edit`).
 */
export function FieldsForm({
  action,
  fields,
  save,
  edit,
  card,
  plain,
  note,
  extra,
}: {
  action: Action;
  fields: DetailField[];
  save?: string;
  edit?: EditRef;
  card?: EditCard | null;
  /** Never asks why (a draft). */
  plain?: boolean;
  /** The quiet line beside the buttons ("" for none). */
  note?: ReactNode;
  /** Under the fields, above the buttons (a section's files, what saving does). */
  extra?: ReactNode;
}) {
  const close = useClosePanel();
  const id = useId();
  const editable = fields.filter((f) => f.name && !f.cardOnly);
  const fresh = editable.every((f) => !(f.value ?? "").trim());
  const groups = [...new Set(editable.map((f) => f.group ?? ""))];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saver = useEditSave({ edit, card, what: "values" });
  // What differs from what is saved, as it is typed (canvas board "One edit window"): the button counts it
  // (changeWords: "No changes", "Save", "Save 2 changes"), and each differing field says Added, or what it was.
  const formRef = useRef<HTMLFormElement>(null);
  // Each differing field's value now (name → value): Added when it was empty, else Changed or Removed.
  const [nowOf, setNowOf] = useState<Record<string, string>>({});
  const recount = () => {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    const now: Record<string, string> = {};
    for (const f of editable) {
      if (!data.has(f.name!)) continue;
      const v = String(data.get(f.name!) ?? "").trim();
      if (changeKind(f.value, v)) now[f.name!] = v;
    }
    setNowOf((was) => (JSON.stringify(was) === JSON.stringify(now) ? was : now));
  };
  const counts = countChanges(editable.filter((f) => f.name! in nowOf).map((f) => ({ from: f.value ?? "", to: nowOf[f.name!]! })));
  // A window that names its own button (Add the shipment) keeps it, and so does one for something new (plain);
  // the Save of saved values counts.
  const counting = !save && !plain;
  const saveWords = counting ? changeWords(counts) : save;

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const changes: string[] = [];
    const keys: string[] = [];
    let filledChanged = false;
    for (const f of editable) {
      if (!data.has(f.name!)) continue;
      const now = String(data.get(f.name!) ?? "").trim();
      const was = (f.value ?? "").trim();
      if (now === was) continue;
      if (was) filledChanged = true;
      keys.push(f.name!);
      changes.push(changeLine(f.panelLabel ?? f.label, changeText(f, was), changeText(f, now)));
    }
    if (!changes.length) return close({ ok: true });
    setErrors({});
    void saver.save({
      changes,
      keys,
      askWhy: filledChanged && !plain,
      run: async (reason, confirm) => {
        if (reason) data.set("reason", reason);
        // The order's checks (a date out of order) ask here: this form can show them and go ahead.
        data.set("ask", "true");
        if (confirm) data.set("confirm", "true");
        const st = await action({}, data);
        if (st.ok) return { ok: true };
        if (st.code === "confirm") return { ok: false, message: st.message ?? "Something looks out of order.", confirm: true };
        const errs: Record<string, string> = {};
        for (const [k, v] of Object.entries(st.errors ?? {})) {
          const first = Array.isArray(v) ? v[0] : v;
          if (first) errs[k] = String(first);
        }
        setErrors(errs);
        return {
          ok: false,
          message: st.message ?? "Something went wrong. Please try again.",
          reasonChoices: st.code === "reason_needed" ? (st.choices ?? []) : undefined,
        };
      },
    });
  };

  return (
    <form
      ref={formRef}
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onInput={recount}
      onChange={recount}
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      <PanelBody className="gap-5">
        {saver.error && <Notice tone="bad">{saver.error}</Notice>}
        {groups.map((g, i) => (
          <PanelSection key={g} title={g || undefined} first={i === 0}>
            {editable
              .filter((f) => (f.group ?? "") === g)
              .map((f) => (
                <Field
                  key={f.name}
                  label={f.panelLabel ?? f.label}
                  htmlFor={`${id}-${f.name}`}
                  hint={
                    // A first fill (nothing saved yet, or a window that never asks why: a first booking) has nothing
                    // to compare: no "Added" on every field typed in (e2e 24 Nov).
                    f.name! in nowOf && !fresh && !(plain && !(f.value ?? "").trim()) ? (
                      <>
                        <ChangeHint was={changeText(f, (f.value ?? "").trim())} now={changeText(f, nowOf[f.name!]!)} />
                        {f.hint}
                      </>
                    ) : (
                      f.hint
                    )
                  }
                  error={errors[f.name!]}
                  className={cn(f.wide && "sm:col-span-2")}
                >
                  <Control f={f} id={`${id}-${f.name}`} />
                </Field>
              ))}
          </PanelSection>
        ))}
        {extra}
        <WindowFooter note={note ?? (card?.first ? "Changing a saved value asks why." : "Changes show in the step’s Changes.")}>
          <Button type="submit" variant="primary" disabled={saver.busy || (counting && counts.changed + counts.added === 0)} aria-busy={saver.busy}>
            {saver.busy ? "Saving…" : (saveWords ?? "Save")}
          </Button>
        </WindowFooter>
      </PanelBody>
      {saver.dialog}
    </form>
  );
}

/** A button that opens a side panel (the header's "Split into two shipments", a card's own tools). */
export function PanelButton({
  label,
  title,
  description,
  body,
  variant = "secondary",
  size = "md",
  icon,
  className,
  panelClassName,
  name,
  edit,
}: {
  /** A link opens it: ?do=<name> (the order's next step). */
  name?: string;
  /** It changes the box it sits in: drawn as the one quiet ✎ Edit (EditButton), its label its words. */
  edit?: boolean;
  label: ReactNode;
  title: string;
  description?: string;
  body: ReactNode;
  /** The window's width: one of RULES.window (part 640, wideRows 720, items 1180). */
  panelClassName?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  useOpenFromLink(name, () => setOpen(true));
  return (
    <>
      {edit ? (
        <EditButton label={label} onClick={() => setOpen(true)} className={className} />
      ) : (
        <Button size={size} variant={variant} onClick={() => setOpen(true)} className={className}>
          {icon} {label}
        </Button>
      )}
      {open && (
        <SidePanel title={title} description={description} onClose={() => setOpen(false)} className={panelClassName}>
          {body}
        </SidePanel>
      )}
    </>
  );
}

