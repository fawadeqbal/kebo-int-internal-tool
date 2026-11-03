"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, Plus, X } from "lucide-react";
import { Alert, Button, Card, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { EditableRows, EditButton, useFocusRow } from "@/components/common/edit-button";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/* ---------------------------------------------------------------- helpers */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** "14 Jan 2027" in the browser (the server's formatter stays on the server). */
export const dayLabel = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";

/* ---------------------------------------------------------------- the side panel */

const noop = () => () => {};
/** True in the browser, false while rendering on the server. */
const useMounted = () => useSyncExternalStore(noop, () => true, () => false);

const PanelClose = createContext<() => void>(() => {});
/** Inside an Edit panel: closes it (a form's onDone). */
export const useClosePanel = () => useContext(PanelClose);

/**
 * The Edit side panel: 600px from the right on a desktop, the whole screen on
 * a phone; Escape or the backdrop closes it. Its body is a form (or the
 * existing forms of the section) in sections with small-caps titles, two
 * columns at most, the label above each field and its hint under it, and
 * Save / Cancel in a footer that stays at the bottom; saving closes it.
 */
export function EditPanel({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const head = useRef<HTMLHeadingElement>(null);
  const mounted = useMounted();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  useEffect(() => {
    if (mounted) head.current?.focus();
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end">
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="relative flex h-dvh w-full flex-col border-l border-line bg-surface shadow-pop sm:w-[600px] sm:max-w-[calc(100vw-2rem)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={`${id}-title`} ref={head} tabIndex={-1} className="text-base font-semibold outline-none">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label="Close the panel" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
        <PanelClose.Provider value={onClose}>{children}</PanelClose.Provider>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A panel's scrolling body. A form inside takes its height (`PANEL_FORM`), so
 * its PanelActions stay at the bottom of the panel however short it is.
 */
export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto p-5", className)}>{children}</div>;
}

/** The class of a form filling a PanelBody, so its PanelActions sit at the bottom. */
export const PANEL_FORM = "flex flex-1 flex-col gap-5";

/** A section of a panel's form: a small-caps title, then its fields, two columns at most (one on a phone). */
export function PanelSection({ title, children, className, first }: { title?: string; children: ReactNode; className?: string; first?: boolean }) {
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-3", !first && "border-t border-line pt-5")}>
      {title && <legend className="float-left mb-1 w-full text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</legend>}
      <div className={cn("grid grid-cols-1 gap-x-3 gap-y-3.5 sm:grid-cols-2", className)}>{children}</div>
    </fieldset>
  );
}

/**
 * The panel's Save / Cancel, in a footer that stays at the bottom of the panel
 * while the form scrolls; `end`: a quiet action on the right (Remove this offer).
 */
export function PanelActions({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-5 -mb-5 mt-auto flex flex-wrap items-center gap-3 border-t border-line bg-surface-2 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {children}
      {end && <span className="ml-auto">{end}</span>}
    </div>
  );
}

function PanelFooter({ save = "Save" }: { save?: string }) {
  const close = useClosePanel();
  return (
    <PanelActions>
      <SubmitButton size="sm" pendingText="Saving…">
        {save}
      </SubmitButton>
      <Button type="button" size="sm" variant="ghost" onClick={close}>
        Cancel
      </Button>
      <span className="text-xs text-muted">Changes show in the step&rsquo;s Changes.</span>
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

/** The full form of a card in the panel: its fields grouped, Save / Cancel. */
export function FieldsForm({ action, fields, save }: { action: Action; fields: DetailField[]; save?: string }) {
  const close = useClosePanel();
  const id = useId();
  const editable = fields.filter((f) => f.name && !f.cardOnly);
  const groups = [...new Set(editable.map((f) => f.group ?? ""))];
  return (
    <ActionForm action={action} onDone={close} showSuccess={false} className="flex min-h-0 flex-1 flex-col">
      {(s) => (
        <PanelBody className="gap-5">
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
                    error={s.errors?.[f.name!]}
                    className={cn(f.wide && "sm:col-span-2")}
                  >
                    <Control f={{ ...f, value: s.values?.[f.name!] ?? f.value }} id={`${id}-${f.name}`} />
                  </Field>
                ))}
            </PanelSection>
          ))}
          <PanelFooter save={save} />
        </PanelBody>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- "+ Add" in place */

/**
 * One value changed right there: an empty one is "+ Add", a filled one shows
 * a small pencil on hover (`shown`); either turns into its input and Save
 * (Enter saves, Esc cancels).
 */
function AddInPlace({ f, action, shown }: { f: DetailField; action: Action; shown?: ReactNode }) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initial = () => (shown !== undefined && f.value ? f.value : f.type === "select" ? (f.options?.[0]?.value ?? "") : "");
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      if (!v.trim()) return setError(`Type the ${f.label.toLowerCase()}, or Esc to cancel.`);
      setError(null);
      const form = new FormData();
      form.set(f.name!, v.trim());
      const r = await action({}, form);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r.message ?? "Something went wrong. Please try again.");
    });
  if (!open && shown !== undefined)
    return (
      <span className="inline-flex max-w-full items-baseline gap-1.5">
        <span className="min-w-0">{shown}</span>
        <button
          type="button"
          onClick={() => (setV(initial()), setOpen(true))}
          className="grid size-5 shrink-0 translate-y-0.5 place-items-center self-start rounded text-primary opacity-0 transition-opacity group-hover/field:opacity-100 hover:bg-primary-soft focus-visible:opacity-100 [@media(hover:none)]:hidden"
          aria-label={`Change the ${f.label.toLowerCase()}`}
          title={`Change the ${f.label.toLowerCase()}`}
        >
          <Pencil className="size-3" aria-hidden />
        </button>
      </span>
    );
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-0.5 rounded text-sm font-medium text-primary hover:underline"
        aria-label={`Add the ${f.label.toLowerCase()}`}
      >
        <Plus className="size-3.5" aria-hidden /> Add
      </button>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        {f.label}
      </label>
      <Control
        f={f}
        id={id}
        value={v}
        onChange={setV}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && f.type !== "textarea") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            setError(null);
          }
        }}
      />
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="xs" variant="primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => (setOpen(false), setError(null))}>
          Cancel
        </Button>
      </div>
    </div>
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
  panel?: { title: string; description?: string; body: ReactNode };
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card id={id} data-target={target} data-target-card={target ? "" : undefined} className={cn("scroll-mt-24", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
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
        <EditPanel title={panel.title} description={panel.description} onClose={() => setOpen(false)}>
          {panel.body}
        </EditPanel>
      )}
    </Card>
  );
}

/**
 * The Details card of a step (board OrderV4Shipping): its values as a label /
 * value grid (three columns, two on a phone), "n of m filled" in the header,
 * every empty value a "+ Add" that saves it in place, and Edit for the whole
 * form in the side panel. Without the right to change it: the values only.
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
  actions,
  footer,
}: {
  id?: string;
  /** Where checklist links land: the card is `target`, each value `target.name` (see goTo). */
  target?: string;
  title: ReactNode;
  description?: ReactNode;
  fields: DetailField[];
  /** Saves one value or the whole card; none: nothing is changed here. */
  action?: Action;
  canEdit: boolean;
  panelTitle?: string;
  panelDescription?: string;
  /** The panel's own body (the section's existing forms) instead of the fields' form. */
  panelBody?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const editable = canEdit && !!action;
  const shown = fields.filter((f) => !f.panelOnly);
  const counted = shown.filter((f) => !f.uncounted);
  const n = counted.filter(filled).length;
  const hasPanel = !!panelBody || (editable && fields.some((f) => f.name && !f.cardOnly));
  return (
    <ViewCard
      id={id}
      target={target}
      title={title}
      description={description ?? (editable ? "Click + Add to fill one value right here; Edit opens everything." : undefined)}
      meter={{ n, of: counted.length }}
      canEdit={canEdit && hasPanel}
      actions={actions}
      panel={
        hasPanel
          ? {
              title: panelTitle ?? `Edit ${typeof title === "string" ? title.toLowerCase() : "the details"}`,
              description: panelDescription ?? "Everything about it in one place. Saving updates the checklist.",
              body: panelBody ?? <FieldsForm action={action!} fields={fields} />,
            }
          : undefined
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-4 py-4 lg:grid-cols-3">
        {shown.map((f) => (
          <div
            key={f.name ?? f.label}
            data-target={target ? `${target}.${f.target ?? f.name ?? f.label.toLowerCase()}` : undefined}
            className="group/field -mx-1.5 flex min-w-0 flex-col gap-0.5 px-1.5 py-0.5"
          >
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="min-w-0 text-sm font-medium break-words text-text tabular">
              {filled(f) ? (
                editable && f.name && f.type !== "textarea" && !f.fixed ? (
                  <AddInPlace f={f} action={action!} shown={shownOf(f)} />
                ) : (
                  shownOf(f)
                )
              ) : f.empty !== undefined ? (
                f.empty
              ) : editable && f.name ? (
                <AddInPlace f={f} action={action!} />
              ) : (
                <span className="font-normal text-muted">—</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {footer}
    </ViewCard>
  );
}

const LinesClose = createContext<() => void>(() => {});
/** Inside a LinesCard's edit mode: back to the read-only lines (an editor that saves as a whole). */
export const useCloseLines = () => useContext(LinesClose);

/**
 * A view card for a set of lines: read-only until "Edit lines", then the
 * step's line table to type into ("#edit-lines" in the address opens it, so
 * a row's "Open the lines" lands here ready). On a phone, read-only lines are
 * short text lines.
 */
export function LinesCard({
  title,
  description,
  canEdit,
  view,
  edit,
  phone,
  actions,
  editActions,
  editLabel = "Edit lines",
  target,
}: {
  title: ReactNode;
  description?: ReactNode;
  canEdit: boolean;
  view: ReactNode;
  edit?: ReactNode;
  /** The lines as short text lines on a phone (read-only). */
  phone?: ReactNode;
  actions?: ReactNode;
  /** Shown while editing (e.g. Excel, Mark all received). */
  editActions?: ReactNode;
  editLabel?: string;
  /** Where checklist links land ("lines.packing"; see goTo). */
  target?: string;
}) {
  const [editing, setEditing] = useState(false);
  // The row clicked in the read-only lines: selected in the editor once it is open.
  const [row, setRow] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const editBox = useRef<HTMLDivElement>(null);
  const editable = canEdit && !!edit;
  useFocusRow(editing ? row : null, editBox, () => setRow(null));
  useEffect(() => {
    if (!editable) return;
    const check = () => {
      if (window.location.hash === "#edit-lines") {
        setEditing(true);
        ref.current?.scrollIntoView({ block: "start" });
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [editable]);
  const desktop = editable ? (
    <EditableRows label="Click a row to change it" onRow={(n) => (setRow(n), setEditing(true))}>
      {view}
    </EditableRows>
  ) : (
    view
  );
  return (
    <div ref={ref} id="lines" className="scroll-mt-24">
      <ViewCard
        title={title}
        target={target}
        description={description ?? (editable && !editing ? "Click a row to change it, or edit them all." : undefined)}
        canEdit={false}
        actions={
          <>
            {editing ? editActions : actions}
            {editable &&
              (editing ? (
                <Button size="sm" variant="secondary" className="h-8 px-3 text-[13px]" onClick={() => setEditing(false)}>
                  Done
                </Button>
              ) : (
                <EditButton label={editLabel} onClick={() => setEditing(true)} />
              ))}
          </>
        }
      >
        <div className="p-4">
          {editing ? (
            <div ref={editBox}>
              <LinesClose.Provider value={() => setEditing(false)}>{edit}</LinesClose.Provider>
            </div>
          ) : phone ? (
            <>
              <div className="sm:hidden">{phone}</div>
              <div className="max-sm:hidden">{desktop}</div>
            </>
          ) : (
            desktop
          )}
        </div>
      </ViewCard>
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
}: {
  label: ReactNode;
  title: string;
  description?: string;
  body: ReactNode;
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
        <EditPanel title={title} description={description} onClose={() => setOpen(false)}>
          {body}
        </EditPanel>
      )}
    </>
  );
}
