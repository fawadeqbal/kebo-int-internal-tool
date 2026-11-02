"use client";

import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Lock, Minus, MoreHorizontal, Paperclip, Plus, Upload } from "lucide-react";
import { TOOL_LABEL, type FlowStep, type OrderDocumentKind, type PaymentRoute } from "@kebo/shared";
import { Alert, Button, buttonClass, Card, CardHeader, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { FloatingMenu } from "@/components/common/floating";
import type { ActionState } from "@/lib/actions";
import type { ChecklistOp } from "@/app/(app)/orders/checklist-actions";
import type { ChecklistItem } from "@/lib/types-checklist";
import type { BankContract, BankStepView, DeliveryView, FlowDocument, ShipmentView } from "@/lib/types-flow";
import { BankContractForm, BankStepForm, DateForm, DeliveryForm, DocumentForm, RouteForm, ShipmentForm } from "./flow-forms";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;
/** checklistAction bound to the order: (change, item id or automatic key, …). */
export type ChecklistRun = (op: ChecklistOp, target: string, prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * What an automatic item's button opens: the existing form for its data
 * (inline in the row), a link to the part of the page that records it, or a
 * form that opens itself (the payment forms).
 */
export type AutoTool =
  | { kind: "link"; label: string; href: string }
  | { kind: "node"; node: ReactNode }
  | {
      kind: "date";
      label: string;
      action: Action;
      name: string;
      field: string;
      value: string | null;
      max?: string;
      save: string;
      hint?: string;
    }
  | { kind: "route"; label: string; action: Action; route: PaymentRoute | null; bankRoutes: boolean }
  | { kind: "contract"; label: string; action: Action; contract: BankContract | null; lc: boolean; currency: string }
  | { kind: "shipment"; label: string; action: Action; shipment?: ShipmentView; defaults?: Partial<ShipmentView>; today: string }
  | {
      kind: "document";
      label: string;
      action: Action;
      doc?: FlowDocument;
      docKind?: OrderDocumentKind;
      files: { id: string; name: string; href: string }[];
      shipments: { id: string; label: string }[];
    }
  | { kind: "bankStep"; label: string; action: Action; step: BankStepView; today: string }
  | { kind: "delivery"; label: string; action: Action; d: DeliveryView; people: { id: string; name: string }[]; today: string };

/* ---------------------------------------------------------------- small helpers */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const short = (iso: string | null | undefined) =>
  iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "";
const value = (v: string) => (ISO.test(v) ? short(v) : v);
const daysLate = (iso: string) => Math.max(1, Math.round((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000));

/** Where an automatic item takes its tick from. */
function sourceOf(key: string) {
  if (key === "deposit_in" || key === "balance_in") return "from the payments";
  if (key === "factory_advance" || key === "factory_paid") return "from the factory payments";
  if (key === "packing_list") return "from the packing list";
  if (key === "goods_received") return "from goods received";
  if (["booked", "loaded", "sailed", "arrived"].includes(key)) return "from the shipment";
  if (key === "contract") return "from the LC";
  if (key.startsWith("doc:")) return "from the papers";
  if (key.startsWith("bank:")) return "bank step";
  return "from the data";
}

/** Sends a file to the deal's files and answers its id (server actions cap bodies at 1 MB, so files go through a route). */
async function uploadToDeal(dealId: string, file: File, note: string): Promise<{ id?: string; error?: string }> {
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

/** One call of the checklist's action with a JSON body; refreshes the page when it worked. */
function useRun(run: ChecklistRun) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const call = (op: ChecklistOp, target: string, body: Record<string, unknown> = {}, then?: () => void) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        setError(null);
        const form = new FormData();
        form.set("payload", JSON.stringify(body));
        const r = await run(op, target, {}, form);
        if (r.ok) {
          then?.();
          router.refresh();
        } else setError(r.message ?? "Something went wrong. Please try again.");
        resolve(!!r.ok);
      }),
    );
  return { call, pending, error, setError };
}

/* ---------------------------------------------------------------- the box */

function Box({ item }: { item: ChecklistItem }) {
  const round = item.auto ? "rounded-full" : "rounded-[5px]";
  if (item.done)
    return (
      <span className={cn("grid size-[18px] shrink-0 place-items-center bg-ok text-white", round)} role="img" aria-label="Done">
        <Check className="size-3" strokeWidth={3.5} aria-hidden />
      </span>
    );
  if (item.skipped)
    return (
      <span
        className={cn("grid size-[18px] shrink-0 place-items-center border-[1.5px] border-dashed border-line-strong text-muted", round)}
        role="img"
        aria-label="Skipped"
      >
        <Minus className="size-3" strokeWidth={3} aria-hidden />
      </span>
    );
  return (
    <span
      className={cn(
        "block size-[18px] shrink-0 border-[1.5px] border-solid bg-surface",
        round,
        item.late ? "border-bad" : "border-line-strong",
      )}
      role="img"
      aria-label={item.late ? "Late" : "Open"}
    />
  );
}

/* ---------------------------------------------------------------- forms in the row */

const panel = "flex flex-col gap-3 rounded-lg border border-line bg-surface p-3";

/** An own item's fields (Fill in, Upload, Change the details): saving ticks it, or keeps the values. */
function FillForm({
  item,
  dealId,
  run,
  mode,
  onDone,
}: {
  item: ChecklistItem;
  dealId: string;
  run: ChecklistRun;
  mode: "tick" | "edit";
  onDone: () => void;
}) {
  const id = useId();
  const { call, pending, error, setError } = useRun(run);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const upload = item.tool === "upload";
  const submit = async (form: FormData) => {
    setBusy(true);
    const data: Record<string, string> = {};
    for (const f of item.fields) {
      const v = form.get(`f-${f.key}`);
      if (f.type !== "file" && typeof v === "string") data[f.key] = v.trim();
    }
    let attachmentId: string | undefined;
    for (const [key, file] of Object.entries(files)) {
      if (!file) continue;
      const r = await uploadToDeal(dealId, file, item.title);
      if (r.error || !r.id) {
        setBusy(false);
        setError(r.error ?? "The file was not kept.");
        return;
      }
      if (key === "$item") attachmentId = r.id;
      else data[key] = r.id;
    }
    setBusy(false);
    if (mode === "tick") await call("tick", item.id!, { data, ...(attachmentId && { attachmentId }) }, onDone);
    else
      await call(
        "edit",
        item.id!,
        { data, ...(title.trim() !== item.title && { title: title.trim() }), ...(attachmentId && { attachmentId }) },
        onDone,
      );
  };
  return (
    <form action={submit} className={panel}>
      {error && <Alert tone="error">{error}</Alert>}
      {mode === "edit" && (
        <Field label="What has to be done" htmlFor={`${id}-title`}>
          <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </Field>
      )}
      {item.fields.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {item.fields.map((f) =>
            f.type === "file" ? (
              <Field
                key={f.key}
                label={f.label}
                htmlFor={`${id}-${f.key}`}
                optional
                hint={item.values[f.key] ? "A new file replaces it" : undefined}
              >
                <Input
                  id={`${id}-${f.key}`}
                  type="file"
                  onChange={(e) => setFiles((x) => ({ ...x, [f.key]: e.target.files?.[0] ?? null }))}
                  className="pt-1.5"
                />
              </Field>
            ) : (
              <Field key={f.key} label={f.label} htmlFor={`${id}-${f.key}`}>
                <Input
                  id={`${id}-${f.key}`}
                  name={`f-${f.key}`}
                  type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                  defaultValue={item.values[f.key] ?? ""}
                  maxLength={500}
                />
              </Field>
            ),
          )}
        </div>
      )}
      {(upload || mode === "edit") && (
        <Field
          label={upload ? "The file" : "Attach a file"}
          htmlFor={`${id}-file`}
          optional={!upload || !!item.file}
          hint={item.file ? `Now: ${item.file.name}` : undefined}
        >
          <Input
            id={`${id}-file`}
            type="file"
            onChange={(e) => setFiles((x) => ({ ...x, $item: e.target.files?.[0] ?? null }))}
            className="pt-1.5"
          />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending || busy}>
          {busy ? "Sending the file…" : pending ? "Saving…" : mode === "tick" ? "Save and tick" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {mode === "tick" && <span className="text-xs text-muted">Files go to the deal&apos;s files too.</span>}
      </div>
    </form>
  );
}

/** One short field and its button: skip with a reason, a note. */
function OneField({
  label,
  name,
  initial,
  save,
  long,
  onSave,
  onDone,
  pending,
  error,
}: {
  label: string;
  name: string;
  initial?: string | null;
  save: string;
  long?: boolean;
  onSave: (v: string) => void;
  onDone: () => void;
  pending: boolean;
  error: string | null;
}) {
  const id = useId();
  const [v, setV] = useState(initial ?? "");
  return (
    <form
      className={panel}
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v.trim());
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field label={label} htmlFor={id}>
        {long ? (
          <Textarea id={id} name={name} rows={2} className="min-h-0" value={v} onChange={(e) => setV(e.target.value)} maxLength={1000} />
        ) : (
          <Input id={id} name={name} value={v} onChange={(e) => setV(e.target.value)} maxLength={300} autoFocus />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "Saving…" : save}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Set due date and person. */
function DueForm({
  item,
  people,
  onSave,
  onDone,
  pending,
  error,
}: {
  item: ChecklistItem;
  people: { id: string; name: string }[];
  onSave: (b: Record<string, unknown>) => void;
  onDone: () => void;
  pending: boolean;
  error: string | null;
}) {
  const id = useId();
  return (
    <form
      className={panel}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        onSave({ dueOn: String(f.get("dueOn") ?? ""), assigneeId: String(f.get("assigneeId") ?? "") });
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Due on" htmlFor={`${id}-due`} optional>
          <Input id={`${id}-due`} name="dueOn" type="date" defaultValue={item.dueOn ?? ""} />
        </Field>
        <Field label="Person" htmlFor={`${id}-who`} optional>
          <Select id={`${id}-who`} name="assigneeId" defaultValue={item.assignee?.id ?? ""}>
            <option value="">Whoever handles the order</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** An automatic item's form, as the step's own panels use it. */
function AutoForm({ tool, onDone }: { tool: AutoTool; onDone: () => void }) {
  switch (tool.kind) {
    case "date":
      return (
        <DateForm
          action={tool.action}
          name={tool.name}
          label={tool.field}
          value={tool.value}
          max={tool.max}
          save={tool.save}
          hint={tool.hint}
          onDone={onDone}
        />
      );
    case "route":
      return <RouteForm action={tool.action} route={tool.route} bankRoutes={tool.bankRoutes} onDone={onDone} />;
    case "contract":
      return <BankContractForm action={tool.action} contract={tool.contract} lc={tool.lc} currency={tool.currency} onDone={onDone} />;
    case "shipment":
      return <ShipmentForm action={tool.action} shipment={tool.shipment} defaults={tool.defaults} today={tool.today} onDone={onDone} />;
    case "document":
      return (
        <DocumentForm
          action={tool.action}
          doc={tool.doc}
          kind={tool.docKind}
          files={tool.files}
          shipments={tool.shipments}
          onDone={onDone}
        />
      );
    case "bankStep":
      return <BankStepForm action={tool.action} step={tool.step} today={tool.today} onDone={onDone} />;
    case "delivery":
      return <DeliveryForm action={tool.action} d={tool.d} people={tool.people} today={tool.today} onDone={onDone} />;
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- one row */

type Open = null | "tool" | "edit" | "due" | "note" | "skip" | "attach";

function Row({
  item,
  now,
  canEdit,
  tool,
  payNode,
  run,
  dealId,
  people,
}: {
  item: ChecklistItem;
  now: boolean;
  canEdit: boolean;
  tool?: AutoTool;
  payNode?: ReactNode;
  run: ChecklistRun;
  dealId: string;
  people: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState<Open>(null);
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const { call, pending, error } = useRun(run);
  const close = () => setOpen(null);
  const target = item.auto ? item.key! : item.id!;
  const closed = item.done || item.skipped;

  // The row's own button: Mark done, Fill in, Upload, Pay; an automatic item's form.
  let buttons: ReactNode = null;
  if (canEdit && !item.auto && !closed && open !== "tool") {
    const primary = now ? "primary" : "secondary";
    if (item.tool === "fill" || item.tool === "upload")
      buttons = (
        <Button size="xs" variant={primary} onClick={() => setOpen("tool")}>
          {item.tool === "upload" && <Upload aria-hidden />}{" "}
          {item.tool === "upload" ? "Upload" : item.fields.length ? TOOL_LABEL.fill : "Mark done"}
        </Button>
      );
    else
      buttons = (
        <>
          {item.tool === "pay" && payNode}
          <Button size="xs" variant={primary} disabled={pending} onClick={() => call("tick", item.id!, {})}>
            {pending ? "Ticking…" : item.tool === "pay" ? "Mark paid" : "Mark done"}
          </Button>
        </>
      );
  } else if (item.auto && tool && open !== "tool") {
    if (tool.kind === "link")
      buttons = (
        <Link href={tool.href} className={buttonClass(closed ? "ghost" : now ? "primary" : "secondary", "xs")}>
          {tool.label}
        </Link>
      );
    else if (tool.kind === "node") buttons = closed ? null : tool.node;
    else
      buttons = (
        <Button size="xs" variant={closed ? "ghost" : now ? "primary" : "secondary"} onClick={() => setOpen("tool")}>
          {closed ? "Change" : tool.label}
        </Button>
      );
  }

  // Who and when; an automatic item whose data already says the date shows nothing more.
  const dated = item.data.some(([, v]) => v === item.doneOn);
  const whoWhen = item.done && !(item.auto && dated) ? [item.doneBy?.name, short(item.doneOn)].filter(Boolean).join(" · ") : "";
  const menuItem = (label: string, on: () => void, danger?: boolean) => (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none",
        danger && "text-bad",
      )}
      onClick={() => {
        setMenu(false);
        on();
      }}
    >
      {label}
    </button>
  );

  return (
    <li
      className={cn(
        "grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-lg px-3 py-3",
        item.late ? "bg-bad-soft" : now && !closed ? "bg-primary-soft/70 ring-1 ring-primary/15" : "",
      )}
    >
      <span className="row-start-1 mt-0.5">
        <Box item={item} />
      </span>
      <p className="col-[2/3] row-start-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className={cn("font-medium", item.late && "text-bad", item.skipped && "text-muted line-through", item.done && "font-normal")}>
          {item.title}
        </span>
        {item.auto && (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Lock className="size-3" aria-hidden /> {sourceOf(item.key!)}
          </span>
        )}
        {item.dueOn && !closed && (
          <span className={cn("text-xs", item.late ? "font-medium text-bad" : "text-muted")}>
            due {short(item.dueOn)}
            {item.late ? ` · ${daysLate(item.dueOn)} day${daysLate(item.dueOn) === 1 ? "" : "s"} late` : ""}
          </span>
        )}
        {item.assignee && !closed && <span className="text-xs text-muted">· {item.assignee.name}</span>}
      </p>
      <div className="col-[2/4] row-start-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-xs">
        <span className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
          {item.skipped ? (
            <span className="text-muted">Skipped{item.skipReason ? `: ${item.skipReason}` : ""}</span>
          ) : (
            <>
              {item.data.map(([l, v]) => (
                <span key={l} className="text-muted">
                  {l} <span className="font-medium text-text tabular">{value(v)}</span>
                </span>
              ))}
              {item.file && (
                <a
                  href={`/files/${item.file.id}?view=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <Paperclip className="size-3" aria-hidden /> {item.file.name}
                </a>
              )}
              {!item.done && item.needs && <span className="text-muted">Needs: {item.needs}</span>}
            </>
          )}
          {item.note && <span className="text-text-2 italic">{item.note}</span>}
        </span>
        {whoWhen && <span className="shrink-0 text-muted">{whoWhen}</span>}
      </div>

      {(buttons || canEdit) && (
        <div
          className={cn(
            // On a phone the row's buttons go under it; with none, the ⋯ stays on the title line at the right.
            buttons
              ? "col-[2/4] row-start-3 flex flex-wrap items-center gap-1.5 pt-1 sm:col-[3/4] sm:row-start-1 sm:justify-end sm:pt-0"
              : "col-[3/4] row-start-1 flex items-start justify-end gap-1.5",
            "sm:has-[input:not([type=hidden]),textarea,select]:col-[2/4] sm:has-[input:not([type=hidden]),textarea,select]:row-start-3 sm:has-[input:not([type=hidden]),textarea,select]:justify-start",
          )}
        >
          {buttons}
          {canEdit && (
            <>
              <button
                ref={more}
                type="button"
                aria-label={`More for ${item.title}`}
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu((m) => !m)}
                className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
              {menu && (
                <FloatingMenu anchor={() => more.current} onClose={() => setMenu(false)} label={item.title} width={220}>
                  {!item.auto && menuItem("Change the details", () => setOpen("edit"))}
                  {menuItem("Set due date and person", () => setOpen("due"))}
                  {!item.auto && menuItem("Attach a file", () => setOpen("attach"))}
                  {menuItem(item.note ? "Change the note" : "Add a note", () => setOpen("note"))}
                  {((!item.auto && closed) || (item.auto && item.skipped)) &&
                    menuItem(item.skipped ? "Don't skip" : "Untick", () =>
                      item.auto ? call("auto", target, { skipped: false }) : call("untick", target),
                    )}
                  {!closed && menuItem("Skip, with a reason", () => setOpen("skip"))}
                  {!item.auto &&
                    menuItem(
                      "Delete",
                      () => {
                        if (window.confirm(`Remove "${item.title}" from this order's checklist?`)) call("delete", target);
                      },
                      true,
                    )}
                </FloatingMenu>
              )}
            </>
          )}
        </div>
      )}

      {(open || (error && !open)) && (
        <div className="col-[1/-1] row-start-4 pt-2 sm:col-[2/-1]">
          {!open && error && <Alert tone="error">{error}</Alert>}
          {open === "tool" && item.auto && tool && <AutoForm tool={tool} onDone={close} />}
          {open === "tool" && !item.auto && <FillForm item={item} dealId={dealId} run={run} mode="tick" onDone={close} />}
          {(open === "edit" || open === "attach") && (
            <FillForm
              item={{ ...item, tool: open === "attach" ? "upload" : item.tool }}
              dealId={dealId}
              run={run}
              mode="edit"
              onDone={close}
            />
          )}
          {open === "due" && (
            <DueForm
              item={item}
              people={people}
              pending={pending}
              error={error}
              onDone={close}
              onSave={(b) => call(item.auto ? "auto" : "edit", target, b, close)}
            />
          )}
          {open === "note" && (
            <OneField
              label="Note"
              name="note"
              initial={item.note}
              long
              save="Save the note"
              pending={pending}
              error={error}
              onDone={close}
              onSave={(v) => call(item.auto ? "auto" : "edit", target, { note: v }, close)}
            />
          )}
          {open === "skip" && (
            <OneField
              label="Why is it not needed on this order?"
              name="reason"
              save="Skip it"
              pending={pending}
              error={error}
              onDone={close}
              onSave={(v) => call(item.auto ? "auto" : "skip", target, item.auto ? { skipped: true, skipReason: v } : { reason: v }, close)}
            />
          )}
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- the list */

/** "Add an item to Production…": a title, Enter adds it (Mark done; change its tool from ⋯). */
function AddItem({ step, label, run }: { step: FlowStep; label: string; run: ChecklistRun }) {
  const { call, pending, error } = useRun(run);
  const [title, setTitle] = useState("");
  const id = useId();
  return (
    <form
      className="flex flex-col gap-2 px-3 pt-1 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) call("add", step, { step, title: title.trim(), tool: "done" }, () => setTitle(""));
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex items-center gap-3">
        <Plus className="size-4 shrink-0 text-primary" aria-hidden />
        <label htmlFor={id} className="sr-only">
          Add an item to {label}
        </label>
        <input
          id={id}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder={`Add an item to ${label}…`}
          className="h-9 min-w-0 flex-1 rounded-lg border border-dashed border-line-strong bg-transparent px-3 text-sm placeholder:text-muted focus:border-primary focus:outline-none"
        />
        {title.trim() && (
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * A step's checklist (board OrderV3Item): one row per job with the tool to do
 * it and the data it collected. Round boxes tick themselves from the data;
 * square ones are the company's own, ticked with their tool. People without
 * orders.update see the rows only.
 */
export function Checklist({
  step,
  label,
  items,
  current,
  canEdit,
  run,
  dealId,
  people,
  tools = {},
  payNode,
  listHref,
  title = "Checklist",
}: {
  step: FlowStep;
  label: string;
  items: ChecklistItem[];
  /** This is the order's current step: its first open item is highlighted. */
  current: boolean;
  canEdit: boolean;
  run: ChecklistRun;
  dealId: string;
  people: { id: string; name: string }[];
  tools?: Record<string, AutoTool>;
  /** The step's payment form, for own items with the Pay tool. */
  payNode?: ReactNode;
  /** Settings › Order checklist, for people who keep the company's list. */
  listHref?: string;
  title?: string;
}) {
  const done = items.filter((i) => i.done || i.skipped).length;
  const open = items.filter((i) => !i.done && !i.skipped);
  const nowItem = current ? (open.find((i) => i.late) ?? open[0]) : undefined;
  return (
    <Card>
      <CardHeader
        title={
          <>
            {title} · {done} of {items.length}
          </>
        }
        description="Each item has the tool to do it. Fill it in and it ticks; round items tick themselves."
        actions={
          listHref ? (
            <Link href={listHref} className={buttonClass("ghost", "xs")}>
              Use the company list
            </Link>
          ) : undefined
        }
      />
      {items.length ? (
        <ul className="flex flex-col gap-1 divide-y divide-line/70 p-2">
          {items.map((i) => (
            <Row
              key={i.id ?? i.key}
              item={i}
              now={i === nowItem}
              canEdit={canEdit}
              tool={i.key ? tools[i.key] : undefined}
              payNode={payNode}
              run={run}
              dealId={dealId}
              people={people}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-muted">Nothing to tick in this step yet.</p>
      )}
      {canEdit && <AddItem step={step} label={label} run={run} />}
    </Card>
  );
}
