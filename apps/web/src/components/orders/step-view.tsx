"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Alert, Button, Card, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { PanelActions, PanelBody, PanelSection, SidePanel, useClosePanel } from "@/components/common/panel";
import { EditButton } from "@/components/common/edit-button";
import { EditsChip, editedMark } from "@/components/edits/edits";
import { useEditSave } from "@/components/edits/use-edit-save";
import type { EditCard, EditRef } from "@/lib/types-edits";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/* ---------------------------------------------------------------- helpers */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** "14 Jan 2027" in the browser (the server's formatter stays on the server). */
export const dayLabel = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";

/* ---------------------------------------------------------------- the side panel (common/panel) */

function PanelFooter({ save = "Save", busy, note }: { save?: string; busy?: boolean; note?: ReactNode }) {
  const close = useClosePanel();
  return (
    <PanelActions>
      <Button type="submit" size="sm" disabled={busy} aria-busy={busy}>
        {busy ? "Saving…" : save}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => close()} disabled={busy}>
        Cancel
      </Button>
      <span className="text-xs text-muted">{note ?? "Changes show in the step’s Changes."}</span>
    </PanelActions>
  );
}

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
  /** Its checklist link name when it has no `name` (or another one): the card's target + "." + this. */
  target?: string;
  /** Filled, it is not changed in place (only in the panel). */
  fixed?: boolean;
}

const filled = (f: DetailField) => f.value !== null && f.value !== undefined && f.value !== "";
/** How a filled value reads: its own `show`, a date as "14 Jan 2027", or the value. */
const shownOf = (f: DetailField): ReactNode => f.show ?? (f.type === "date" && f.value && ISO.test(f.value) ? dayLabel(f.value) : f.value);

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

/** How a value reads in "what changed": a choice's label, a date as "14 Jan 2027", or "empty". */
const changeText = (f: DetailField, v: string) =>
  (f.options?.find((o) => o.value === v)?.label ?? (f.type === "date" && ISO.test(v) ? dayLabel(v) : v.length > 40 ? `${v.slice(0, 39)}…` : v)) || "empty";

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
  const groups = [...new Set(editable.map((f) => f.group ?? ""))];
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saver = useEditSave({ edit, card, what: "values" });

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
      changes.push(`${f.panelLabel ?? f.label}: ${changeText(f, was)} → ${changeText(f, now)}`);
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
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
    >
      <PanelBody className="gap-5">
        {saver.error && <Alert tone="error">{saver.error}</Alert>}
        {groups.map((g, i) => (
          <PanelSection key={g} title={g || undefined} first={i === 0}>
            {editable
              .filter((f) => (f.group ?? "") === g)
              .map((f) => (
                <Field
                  key={f.name}
                  label={f.panelLabel ?? f.label}
                  htmlFor={`${id}-${f.name}`}
                  hint={f.hint}
                  error={errors[f.name!]}
                  className={cn(f.wide && "sm:col-span-2")}
                >
                  <Control f={f} id={`${id}-${f.name}`} />
                </Field>
              ))}
          </PanelSection>
        ))}
        {extra}
        <PanelFooter save={save} busy={saver.busy} note={note ?? (card?.first ? "Changing a saved value asks why." : undefined)} />
      </PanelBody>
      {saver.dialog}
    </form>
  );
}

/* ---------------------------------------------------------------- the cards */

/** "8 of 12 filled" and its small bar. */
function FilledMeter({ n, of, word = "filled" }: { n: number; of: number; word?: string }) {
  const pct = of ? Math.round((n / of) * 100) : 100;
  return (
    <span className="inline-flex items-center gap-2 text-xs text-text-2 tabular">
      {n} of {of} {word}
      <span
        className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3 max-sm:hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={of}
        aria-valuenow={n}
        aria-label={`${n} of ${of} ${word}`}
      >
        <span className={cn("block h-full rounded-full", n >= of ? "bg-ok" : "bg-ok/80")} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/**
 * A read-only card of a step's view: its title, the header's Edit (the full
 * form in the side panel) for people who may change it, and its content.
 */
export function ViewCard({
  id,
  target,
  title,
  description,
  meter,
  canEdit,
  editLabel = "Edit",
  panel,
  actions,
  children,
  className,
}: {
  id?: string;
  /** Where a checklist item's link lands (data-target, see goTo). */
  target?: string;
  title: ReactNode;
  description?: ReactNode;
  meter?: { n: number; of: number; word?: string };
  canEdit: boolean;
  editLabel?: string;
  /** The panel the Edit opens. */
  panel?: { title: string; description?: string; body: ReactNode; className?: string };
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card id={id} data-target={target} data-target-card={target ? "" : undefined} className={cn("scroll-mt-24", className)}>
      {/* A phone puts wide actions under the title instead of squeezing it to a word a line. */}
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 max-sm:flex-wrap">
        <div className="min-w-0 max-sm:grow max-sm:basis-[55%]">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {meter && meter.of > 0 && <FilledMeter {...meter} />}
          {actions}
          {canEdit && panel && <EditButton label={editLabel} onClick={() => setOpen(true)} />}
        </div>
      </div>
      {children}
      {open && panel && (
        <SidePanel title={panel.title} description={panel.description} onClose={() => setOpen(false)} className={panel.className}>
          {panel.body}
        </SidePanel>
      )}
    </Card>
  );
}

/**
 * The Details card of a step (board OrderV4Shipping): its values as a label /
 * value grid (three columns, two on a phone), "n of m filled" in the header,
 * and Edit for the whole form in the side panel (read only on the page: board
 * "View first, edit on purpose"). "Edited n×" says how often saved values
 * changed, and each changed value is marked. Without the right to change it:
 * the values only.
 */
export function DetailsCard({
  id,
  target,
  title,
  description,
  fields,
  action,
  canEdit,
  panelTitle,
  panelDescription,
  panelBody,
  panelClassName,
  actions,
  footer,
  edits,
}: {
  /** The panel's width, when its body needs more than the usual (a window with three columns). */
  panelClassName?: string;
  id?: string;
  /** Where checklist links land: the card is `target`, each value `target.name` (see goTo). */
  target?: string;
  title: ReactNode;
  description?: ReactNode;
  fields: DetailField[];
  /** Saves the card; none: nothing is changed here. */
  action?: Action;
  canEdit: boolean;
  panelTitle?: string;
  panelDescription?: string;
  /** The panel's own body (the section's existing forms) instead of the fields' form. */
  panelBody?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** Where its edits are kept, and what they are so far ("Edited n×"). */
  edits?: { ref: EditRef; card?: EditCard | null; plain?: boolean };
}) {
  const editable = canEdit && !!action;
  const shown = fields.filter((f) => !f.panelOnly);
  const counted = shown.filter((f) => !f.uncounted);
  const n = counted.filter(filled).length;
  const hasPanel = !!panelBody || (editable && fields.some((f) => f.name && !f.cardOnly));
  const name = typeof title === "string" ? title : "This card";
  return (
    <ViewCard
      id={id}
      target={target}
      title={title}
      description={description}
      meter={{ n, of: counted.length }}
      canEdit={canEdit && hasPanel}
      actions={
        <>
          <EditsChip card={edits?.card} title={name} />
          {actions}
        </>
      }
      panel={
        hasPanel
          ? {
              title: panelTitle ?? `Edit ${typeof title === "string" ? title.toLowerCase() : "the details"}`,
              description: panelDescription ?? "Everything about it in one place. Saving updates the checklist.",
              className: panelClassName,
              body: panelBody ?? <FieldsForm action={action!} fields={fields} edit={edits?.ref} card={edits?.card} plain={edits?.plain} />,
            }
          : undefined
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-4 py-4 lg:grid-cols-3">
        {shown.map((f) => (
          <div
            key={f.name ?? f.label}
            data-target={target ? `${target}.${f.target ?? f.name ?? f.label.toLowerCase()}` : undefined}
            className="-mx-1.5 flex min-w-0 flex-col gap-0.5 px-1.5 py-0.5"
          >
            <dt className="text-xs text-muted">
              {f.label}
              {f.name && editedMark(edits?.card, f.name)}
            </dt>
            <dd className="min-w-0 text-sm font-medium break-words text-text tabular">
              {filled(f) ? shownOf(f) : f.empty !== undefined ? f.empty : <span className="font-normal text-muted">—</span>}
            </dd>
          </div>
        ))}
      </dl>
      {footer}
    </ViewCard>
  );
}

/**
 * A view card for a set of lines (board "View first, edit on purpose"): read
 * only, always. "Edit lines" in its header opens the lines in the wide edit
 * panel (`edit`, e.g. BatchLines), where changes are kept until Save changes;
 * "#edit-lines" in the address opens it too. "Edited n×" beside it says how
 * often the saved lines changed. On a phone, the lines are short text lines.
 */
export function LinesCard({
  title,
  description,
  canEdit,
  view,
  edit,
  phone,
  actions,
  editLabel = "Edit lines",
  target,
  panelTitle,
  panelDescription,
  edits,
}: {
  title: ReactNode;
  description?: ReactNode;
  canEdit: boolean;
  view: ReactNode;
  /** The edit panel's body (BatchLines, or an editor that saves as a whole). */
  edit?: ReactNode;
  /** The lines as short text lines on a phone (read-only). */
  phone?: ReactNode;
  actions?: ReactNode;
  editLabel?: string;
  /** Where checklist links land ("lines.packing"; see goTo). */
  target?: string;
  panelTitle?: string;
  panelDescription?: ReactNode;
  /** The card's saved edits: "Edited n×". */
  edits?: EditCard | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const editable = canEdit && !!edit;
  useEffect(() => {
    if (!editable) return;
    const check = () => {
      if (window.location.hash === "#edit-lines") {
        setOpen(true);
        ref.current?.scrollIntoView({ block: "start" });
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [editable]);
  const close = () => {
    setOpen(false);
    if (window.location.hash === "#edit-lines") history.replaceState(null, "", window.location.pathname + window.location.search);
  };
  const name = typeof title === "string" ? title : "the lines";
  return (
    <div ref={ref} id="lines" className="scroll-mt-24">
      <ViewCard
        title={title}
        target={target}
        description={description}
        canEdit={false}
        actions={
          <>
            <EditsChip card={edits} title={name} />
            {actions}
            {editable && <EditButton label={editLabel} onClick={() => setOpen(true)} />}
          </>
        }
      >
        <div className="p-4">
          {phone ? (
            <>
              <div className="sm:hidden">{phone}</div>
              <div className="max-sm:hidden">{view}</div>
            </>
          ) : (
            view
          )}
        </div>
      </ViewCard>
      {open && editable && (
        <SidePanel
          title={panelTitle ?? `Edit ${name.toLowerCase().startsWith("lines") ? name.toLowerCase() : name}`}
          description={panelDescription ?? "Change, add, remove or move lines here. Nothing is saved until Save changes."}
          onClose={close}
          className="md:w-[1180px]"
        >
          {edit}
        </SidePanel>
      )}
    </div>
  );
}

/** A small error line for client calls. */
export function InlineError({ message }: { message: string | null }) {
  return message ? <Alert tone="error">{message}</Alert> : null;
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
}: {
  label: ReactNode;
  title: string;
  description?: string;
  body: ReactNode;
  /** The window's own width and such (md:w-[820px]). */
  panelClassName?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
  icon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant={variant} onClick={() => setOpen(true)} className={className}>
        {icon} {label}
      </Button>
      {open && (
        <SidePanel title={title} description={description} onClose={() => setOpen(false)} className={panelClassName}>
          {body}
        </SidePanel>
      )}
    </>
  );
}

/** The way a thing moves through its states, as one bar: done ones filled, the one now in the accent, the rest plain. */
export function StatusBar({ states, at }: { states: { key: string; label: string }[]; at: string }) {
  const here = Math.max(0, states.findIndex((s) => s.key === at));
  return (
    <ol aria-label="Status" className="flex overflow-x-auto rounded-lg bg-surface-2 text-sm font-semibold">
      {states.map((s, i) => (
        <li
          key={s.key}
          aria-current={i === here ? "step" : undefined}
          className={cn(
            "min-w-28 flex-1 px-3.5 py-2.5 whitespace-nowrap first:rounded-l-lg last:rounded-r-lg",
            i < here ? "bg-primary-solid text-primary-fg" : i === here ? "bg-action-solid text-white" : "text-text-2",
          )}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}
