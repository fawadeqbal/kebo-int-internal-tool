"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp, Lock, Plus, Trash2, X } from "lucide-react";
import {
  checklistPaperOf,
  CHECKLIST_FIELD_TYPES,
  CHECKLIST_TOOLS,
  FLOW_STEP_LABEL,
  FLOW_STEPS,
  PAPER_KINDS,
  PAPER_LABEL,
  PAYMENT_ROUTE_SHORT,
  PAYMENT_ROUTES,
  REPORT_PAPERS,
  TOOL_HINT,
  TOOL_LABEL,
  type ChecklistField,
  type ChecklistFieldType,
  type ChecklistTool,
  type FlowStep,
  type PaperKind,
  type PaymentRoute,
} from "@kebo/shared";
import { Button, cn, Input, Select } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelActions, PanelKeys, useClosePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { ChecklistSettings } from "@/lib/types-checklist";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;
type Item = ChecklistSettings["items"][number] & { uid: string };

let seq = 0;
const uid = () => `i${++seq}`;
const FIELD_TYPE_LABEL: Record<ChecklistFieldType, string> = { text: "Text", date: "Date", number: "Number", file: "File" };

/** A field's key from its label ("Approved by" → approvedBy), kept unique in the item. */
function keyOf(label: string, taken: string[]) {
  const words = label
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let base = words.map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("") || "field";
  if (!/^[a-zA-Z]/.test(base)) base = `f${base}`;
  base = base.slice(0, 36);
  let k = base;
  for (let n = 2; taken.includes(k); n++) k = `${base}${n}`;
  return k;
}

/** The fields of a Fill in item: a label and a type each. */
function FieldsEditor({ fields, onChange }: { fields: ChecklistField[]; onChange: (f: ChecklistField[]) => void }) {
  const set = (i: number, p: Partial<ChecklistField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface-2/60 p-2">
      <span className="text-xs font-medium text-text-2">Fields to fill in</span>
      {fields.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            aria-label="Field name"
            value={f.label}
            maxLength={60}
            onChange={(e) =>
              set(i, {
                label: e.target.value,
                key: keyOf(
                  e.target.value,
                  fields.filter((_, j) => j !== i).map((x) => x.key),
                ),
              })
            }
            className="h-8 min-w-0 flex-1 text-sm"
          />
          <Select
            aria-label="Field type"
            value={f.type}
            onChange={(e) => set(i, { type: e.target.value as ChecklistFieldType })}
            className="h-8 w-24 text-sm"
          >
            {CHECKLIST_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove ${f.label || "the field"}`}
            onClick={() => onChange(fields.filter((_, j) => j !== i))}
          >
            <X aria-hidden />
          </Button>
        </div>
      ))}
      {fields.length < 8 && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="w-fit"
          onClick={() =>
            onChange([
              ...fields,
              {
                key: keyOf(
                  "Field",
                  fields.map((x) => x.key),
                ),
                label: "",
                type: "text",
              },
            ])
          }
        >
          <Plus aria-hidden /> Add a field
        </Button>
      )}
    </div>
  );
}

/**
 * The company's list, step by step: each item's name, tool, route and due
 * days; reorder, rename, remove, add. The automatic items of the step are
 * listed with a switch to hide them. Saved as a whole.
 */
/**
 * The whole checklist, in the side panel opened from a step's card (`step`:
 * the one it opens on; the others are a click away). Saves all steps at once.
 */
export function ChecklistEditor({ initial, action, step: first = "production", onSaved }: { initial: ChecklistSettings; action: Action; step?: FlowStep; onSaved?: () => void }) {
  const id = useId();
  const close = useClosePanel();
  const [step, setStep] = useState<FlowStep>(first);
  const [items, setItems] = useState<Item[]>(() => initial.items.map((i) => ({ ...i, uid: uid() })));
  const [hidden, setHidden] = useState<string[]>(initial.hidden);
  const mine = items.filter((i) => i.step === step);
  const auto = initial.auto.find((a) => a.step === step)?.items ?? [];

  const patch = (u: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.uid === u ? { ...i, ...p } : i)));
  const move = (u: string, by: -1 | 1) =>
    setItems((list) => {
      const inStep = list.filter((i) => i.step === step);
      const at = inStep.findIndex((i) => i.uid === u);
      const to = at + by;
      if (to < 0 || to >= inStep.length) return list;
      const swapped = [...inStep];
      [swapped[at], swapped[to]] = [swapped[to]!, swapped[at]!];
      return [...list.filter((i) => i.step !== step), ...swapped];
    });
  const payload = JSON.stringify({
    items: FLOW_STEPS.flatMap((s) => items.filter((i) => i.step === s)).map(({ uid: _uid, ...i }) => ({
      ...i,
      fields: i.tool === "fill" ? i.fields.filter((f) => f.label.trim()) : [],
      paper: checklistPaperOf(i.tool, i.paper),
    })),
    hidden,
  });

  return (
    <ActionForm
      action={action}
      keepFields
      showSuccess={false}
      className={cn(PANEL_FORM, "gap-4")}
      onDone={(r) => {
        toast(r.message ?? "Saved · Order checklist");
        onSaved?.();
      }}
    >
      {(s) => (
        <>
          <input type="hidden" name="payload" value={payload} />
          <div
            role="tablist"
            aria-label="Step"
            className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5"
          >
            {FLOW_STEPS.map((x, n) => (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={x === step}
                onClick={() => setStep(x)}
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted hover:text-text",
                  x === step && "bg-surface text-text shadow-card",
                )}
              >
                {n + 1} · {FLOW_STEP_LABEL[x]}
                <span className="ml-1 text-muted tabular">{items.filter((i) => i.step === x).length || ""}</span>
              </button>
            ))}
          </div>
          {s.errors && Object.keys(s.errors).length > 0 && (
            <p className="text-sm text-bad">{Object.values(s.errors).flat().filter(Boolean)[0]}</p>
          )}

          <section aria-labelledby={`${id}-own`} className="flex flex-col gap-2">
            <h3 id={`${id}-own`} className="text-sm font-semibold">
              Your items in {FLOW_STEP_LABEL[step]}
            </h3>
            {mine.length === 0 && (
              <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-muted">No items of your own here.</p>
            )}
            <ul className="flex flex-col gap-2">
              {mine.map((i, n) => (
                <li key={i.uid} className="flex flex-col gap-2 rounded-lg border border-line p-3">
                  <div className="flex items-start gap-2">
                    <span aria-hidden className="mt-2 size-4 shrink-0 rounded-[4px] border-[1.5px] border-line-strong" />
                    <Input
                      aria-label="What has to be done"
                      value={i.title}
                      maxLength={200}
                      onChange={(e) => patch(i.uid, { title: e.target.value })}
                      className="min-w-0 flex-1"
                    />
                    <span className="flex shrink-0">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Up"
                        disabled={n === 0}
                        onClick={() => move(i.uid, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Down"
                        disabled={n === mine.length - 1}
                        onClick={() => move(i.uid, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${i.title}`}
                        onClick={() => setItems((l) => l.filter((x) => x.uid !== i.uid))}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </span>
                  </div>
                  <div className="grid gap-2 pl-6 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Tool
                      <Select
                        value={i.tool}
                        onChange={(e) => patch(i.uid, { tool: e.target.value as ChecklistTool })}
                        title={TOOL_HINT[i.tool]}
                        className="h-8 text-sm"
                      >
                        {CHECKLIST_TOOLS.map((t) => (
                          <option key={t} value={t}>
                            {TOOL_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Only for
                      <Select
                        value={i.route ?? ""}
                        onChange={(e) => patch(i.uid, { route: (e.target.value || null) as PaymentRoute | null })}
                        className="h-8 text-sm"
                      >
                        <option value="">Every order</option>
                        {PAYMENT_ROUTES.map((r) => (
                          <option key={r} value={r}>
                            {PAYMENT_ROUTE_SHORT[r]} orders
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Due, days after the order
                      <Input
                        type="number"
                        min={0}
                        max={3650}
                        value={i.dueDays ?? ""}
                        placeholder="No due date"
                        onChange={(e) =>
                          patch(i.uid, {
                            dueDays: e.target.value === "" ? null : Math.max(0, Math.min(3650, Math.round(Number(e.target.value)))),
                          })
                        }
                        className="h-8 text-sm"
                      />
                    </label>
                  </div>
                  <p className="pl-6 text-xs text-muted">{TOOL_HINT[i.tool]}</p>
                  {(i.tool === "make" || i.tool === "send") && (
                    <label className="flex flex-col gap-1 pl-6 text-xs text-muted sm:max-w-xs">
                      The paper
                      <Select
                        value={i.paper ?? ""}
                        onChange={(e) => patch(i.uid, { paper: (e.target.value || null) as PaperKind | null })}
                        className="h-8 text-sm"
                      >
                        <option value="">None (ticked by hand)</option>
                        {PAPER_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {PAPER_LABEL[k]}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                  {i.tool === "fill" && (
                    <div className="flex flex-col gap-2 pl-6">
                      <label className="flex flex-col gap-1 text-xs text-muted sm:max-w-xs">
                        The report it fills
                        <Select
                          value={checklistPaperOf(i.tool, i.paper) ?? ""}
                          onChange={(e) => patch(i.uid, { paper: (e.target.value || null) as PaperKind | null })}
                          className="h-8 text-sm"
                        >
                          <option value="">None</option>
                          {REPORT_PAPERS.map((k) => (
                            <option key={k} value={k}>
                              {PAPER_LABEL[k]}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <FieldsEditor fields={i.fields} onChange={(f) => patch(i.uid, { fields: f })} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="w-fit"
              onClick={() => setItems((l) => [...l, { uid: uid(), step, title: "", tool: "done", fields: [], paper: null, route: null, dueDays: null }])}
            >
              <Plus aria-hidden /> Add an item to {FLOW_STEP_LABEL[step]}
            </Button>
          </section>

          {auto.length > 0 && (
            <section aria-labelledby={`${id}-auto`} className="flex flex-col gap-2">
              <h3 id={`${id}-auto`} className="text-sm font-semibold">
                Ticked from the data
              </h3>
              <p className="text-xs text-muted">These tick themselves when the data is in. Hide the ones your company does not use.</p>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {auto.map((a) => {
                  const off = hidden.includes(a.key);
                  return (
                    <li key={a.key} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className={cn("flex items-center gap-2 text-sm", off && "text-muted line-through")}>
                        <span aria-hidden className="size-4 shrink-0 rounded-full border-[1.5px] border-line-strong" />
                        {a.title}
                        <Lock className="size-3 text-muted" aria-hidden />
                      </span>
                      <label className="flex shrink-0 items-center gap-2 text-xs text-text-2">
                        <input
                          type="checkbox"
                          checked={!off}
                          onChange={(e) => setHidden((h) => (e.target.checked ? h.filter((k) => k !== a.key) : [...h, a.key]))}
                          className="size-4 accent-[var(--color-primary)]"
                        />
                        Show
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="text-xs text-muted">
            {initial.saved ? "New orders start with this list." : "This is the usual list; save it to make it your own."}
          </p>
          <PanelActions>
            <SubmitButton pendingText="Saving…" disabled={items.some((i) => !i.title.trim())}>
              Save the checklist
            </SubmitButton>
            <button type="button" className="text-sm font-medium text-text-2 hover:text-text" onClick={() => close()}>
              Cancel
            </button>
            <PanelKeys />
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}
