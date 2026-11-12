"use client";

import { useEffect, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Alert, Button, cn, Input, Select } from "@kebo/ui";
import { PanelActions, PanelBody, useClosePanel, useReportDirty } from "@/components/common/panel";
import { EditsChip, editedMark } from "@/components/edits/edits";
import { useEditSave } from "@/components/edits/use-edit-save";
import { ViewCard } from "@/components/orders/step-view";
import type { ActionState } from "@/lib/actions";
import type { EditCard, EditRef } from "@/lib/types-edits";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface StepRow {
  id: string | null;
  key: string;
  title: string;
  factoryId: string;
  plannedOn: string;
  doneOn: string;
  note: string;
}

const key = () => Math.random().toString(36).slice(2);
const cell = "h-[38px] text-[13px]";

const blankRow = (factoryId: string): StepRow => ({ id: null, key: key(), title: "", factoryId, plannedOn: "", doneOn: "", note: "" });
const DAY = (v: string) => (v ? new Date(`${v}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

/**
 * "Production steps · your own steps; not a checklist" (board OrderProduction): read only on the page; Edit
 * opens them in the panel (each step, its factory, planned and done days and a note; + Add step), saved in
 * one go (PUT production) with Save changes. Changing a saved day or name asks why.
 */
export function ProductionSteps({
  steps,
  factories,
  suggested,
  action,
  canEdit,
  edit,
  card,
}: {
  steps: Omit<StepRow, "key">[];
  factories: { id: string; name: string }[];
  /** Names to start from when there are none yet. */
  suggested: string[];
  action: Action;
  canEdit: boolean;
  edit?: EditRef;
  card?: EditCard | null;
}) {
  const factoryName = (id: string) => factories.find((f) => f.id === id)?.name ?? "";
  return (
    <ViewCard
      title={
        <>
          Production steps<span className="text-xs font-normal text-muted"> · your own steps; not a checklist</span>
        </>
      }
      canEdit={canEdit}
      editLabel={steps.length ? "Edit" : "Add steps"}
      actions={<EditsChip card={card} title="Production steps" />}
      panel={{
        title: "Edit production steps",
        description: "Your own timeline with the factory. Nothing is saved until Save changes.",
        className: "md:w-[980px]",
        body: <StepsEditor steps={steps} factories={factories} suggested={suggested} action={action} edit={edit} card={card} />,
      }}
    >
      {steps.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-surface-2 text-left text-muted">
                <th scope="col" className="px-4 py-2 font-semibold">Step</th>
                <th scope="col" className="px-2 py-2 font-semibold">Factory</th>
                <th scope="col" className="px-2 py-2 font-semibold">Planned</th>
                <th scope="col" className="px-2 py-2 font-semibold">Done</th>
                <th scope="col" className="px-2 py-2 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((r) => (
                <tr key={r.id ?? r.title} className="border-t border-line">
                  <td className="px-4 py-2 font-medium">
                    {r.title}
                    {r.id && editedMark(card, r.id)}
                  </td>
                  <td className="px-2 py-2">{factoryName(r.factoryId) || "—"}</td>
                  <td className="px-2 py-2 tabular">{DAY(r.plannedOn) || "—"}</td>
                  <td className="px-2 py-2 tabular">
                    {r.doneOn ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <Check className="size-3.5" aria-hidden /> {DAY(r.doneOn)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2 text-text-2">{r.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-5 text-sm text-text-2">No steps yet. {canEdit ? "Add steps to follow the factory's work." : ""}</p>
      )}
    </ViewCard>
  );
}

function StepsEditor({
  steps,
  factories,
  suggested,
  action,
  edit,
  card,
}: {
  steps: Omit<StepRow, "key">[];
  factories: { id: string; name: string }[];
  suggested: string[];
  action: Action;
  edit?: EditRef;
  card?: EditCard | null;
}) {
  const first = factories[0]?.id ?? "";
  const close = useClosePanel();
  const reportDirty = useReportDirty();
  const start = (): StepRow[] =>
    steps.length ? steps.map((s) => ({ ...s, key: s.id ?? key() })) : suggested.map((title) => ({ ...blankRow(first), title }));
  const [rows, setRows] = useState<StepRow[]>(start);
  const [touched, setTouched] = useState(false);
  const saver = useEditSave({ edit, card, what: "steps" });
  const set = (k: string, patch: Partial<StepRow>) => {
    setTouched(true);
    setRows((r) => r.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  };
  useEffect(() => {
    reportDirty(touched);
    return () => reportDirty(null);
  }, [touched, reportDirty]);
  const factoryName = (id: string) => factories.find((f) => f.id === id)?.name || "—";

  const saveAll = () => {
    const kept = rows.filter((r) => r.title.trim());
    const was = new Map(steps.filter((s) => s.id).map((s) => [s.id!, s]));
    const changes: string[] = [];
    const keys: string[] = [];
    let filledChanged = false;
    for (const s of steps)
      if (s.id && !kept.some((r) => r.id === s.id)) {
        changes.push(`Removed step · ${s.title}`);
        filledChanged = true;
      }
    for (const r of kept) {
      const old = r.id ? was.get(r.id) : undefined;
      if (!old) {
        changes.push(`Added step · ${r.title.trim()}`);
        continue;
      }
      const diffs: string[] = [];
      const cmp = (label: string, a: string, b: string, show = (v: string) => v) => {
        if (a.trim() === b.trim()) return;
        if (a.trim()) filledChanged = true;
        diffs.push(`${label} ${show(a) || "empty"} → ${show(b) || "empty"}`);
      };
      cmp("Name", old.title, r.title);
      cmp("Factory", old.factoryId, r.factoryId, factoryName);
      cmp("Planned", old.plannedOn, r.plannedOn, DAY);
      cmp("Done", old.doneOn, r.doneOn, DAY);
      cmp("Note", old.note, r.note);
      if (diffs.length) {
        keys.push(r.id!);
        changes.push(`${old.title} · ${diffs.join(", ")}`);
      }
    }
    if (!changes.length) return close({ ok: true });
    const payload = {
      steps: kept.map((r) => ({
        id: r.id,
        title: r.title.trim(),
        factoryId: r.factoryId || null,
        plannedOn: r.plannedOn || null,
        doneOn: r.doneOn || null,
        note: r.note.trim() || null,
      })),
    };
    void saver.save({
      changes,
      keys,
      askWhy: steps.length > 0 && filledChanged,
      run: async (reason) => {
        const form = new FormData();
        form.set("payload", JSON.stringify(payload));
        if (reason) form.set("reason", reason);
        const st = await action({}, form);
        if (st.ok) return { ok: true };
        const first = Object.values(st.errors ?? {}).flat()[0];
        return { ok: false, message: first ?? st.message ?? "Something went wrong. Please try again." };
      },
    });
  };

  return (
    <PanelBody className="gap-3">
      {saver.error && <Alert tone="error">{saver.error}</Alert>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-left text-muted">
              <th scope="col" className="px-2 py-2.5 font-semibold">Step *</th>
              <th scope="col" className="w-[190px] px-2 py-2.5 font-semibold">Factory</th>
              <th scope="col" className="w-[150px] px-2 py-2.5 font-semibold">Planned</th>
              <th scope="col" className="w-[150px] px-2 py-2.5 font-semibold">Done</th>
              <th scope="col" className="w-[140px] px-2 py-2.5 font-semibold">Note</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-line">
                <td className="p-1.5">
                  <Input aria-label={`Step ${i + 1}`} className={cell} value={r.title} maxLength={120} onChange={(e) => set(r.key, { title: e.target.value })} />
                </td>
                <td className="p-1.5">
                  <Select aria-label={`Factory of step ${i + 1}`} className={cn(cell, "bg-surface-2")} value={r.factoryId} onChange={(e) => set(r.key, { factoryId: e.target.value })}>
                    <option value="">—</option>
                    {factories.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="p-1.5">
                  <Input aria-label={`Planned for step ${i + 1}`} type="date" className={cell} value={r.plannedOn} onChange={(e) => set(r.key, { plannedOn: e.target.value })} />
                </td>
                <td className="p-1.5">
                  <Input aria-label={`Step ${i + 1} done on`} type="date" className={cell} value={r.doneOn} onChange={(e) => set(r.key, { doneOn: e.target.value })} />
                </td>
                <td className="p-1.5">
                  <Input aria-label={`Note on step ${i + 1}`} className={cell} placeholder="Note" value={r.note} maxLength={500} onChange={(e) => set(r.key, { note: e.target.value })} />
                </td>
                <td className="p-1.5">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => {
                      setTouched(true);
                      setRows((x) => x.filter((y) => y.key !== r.key));
                    }}
                    aria-label={`Remove step ${i + 1}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setTouched(true);
            setRows((x) => [...x, blankRow(first)]);
          }}
        >
          <Plus aria-hidden /> Add step
        </Button>
      </div>
      <PanelActions>
        <Button size="sm" onClick={saveAll} disabled={saver.busy || (!touched && steps.length > 0)}>
          {saver.busy ? "Saving…" : "Save changes"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => close()} disabled={saver.busy}>
          Cancel
        </Button>
        <span className="text-xs text-muted">{steps.length ? "Changing a saved day or name asks why." : "Steps without a name are left out."}</span>
      </PanelActions>
      {saver.dialog}
    </PanelBody>
  );
}
