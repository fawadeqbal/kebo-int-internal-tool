"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardBody, CardHeader, cn, Input, Select } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

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

/**
 * "Production steps · your own steps; not a checklist" (board OrderProduction): each step, its factory,
 * planned and done days and a note; + Add step; Save timeline. Saved in one go (PUT production).
 */
export function ProductionSteps({
  steps,
  factories,
  suggested,
  action,
  canEdit,
}: {
  steps: Omit<StepRow, "key">[];
  factories: { id: string; name: string }[];
  /** Names to start from when there are none yet. */
  suggested: string[];
  action: Action;
  canEdit: boolean;
}) {
  const first = factories[0]?.id ?? "";
  const start = (): StepRow[] =>
    steps.length ? steps.map((s) => ({ ...s, key: s.id ?? key() })) : suggested.map((title) => ({ id: null, key: key(), title, factoryId: first, plannedOn: "", doneOn: "", note: "" }));
  const [rows, setRows] = useState<StepRow[]>(start);
  const set = (k: string, patch: Partial<StepRow>) => setRows((r) => r.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const payload = {
    steps: rows
      .filter((r) => r.title.trim())
      .map((r) => ({ id: r.id, title: r.title.trim(), factoryId: r.factoryId || null, plannedOn: r.plannedOn || null, doneOn: r.doneOn || null, note: r.note.trim() || null })),
  };
  return (
    <Card>
      <CardHeader
        title={
          <>
            Production steps<span className="text-xs font-normal text-muted"> · your own steps; not a checklist</span>
          </>
        }
      />
      <CardBody>
        <ActionForm action={action} keepFields className="flex flex-col gap-3">
          {(s) => (
            <>
              <input type="hidden" name="payload" value={JSON.stringify(payload)} />
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
                          <Input aria-label={`Step ${i + 1}`} className={cell} value={r.title} maxLength={120} disabled={!canEdit} onChange={(e) => set(r.key, { title: e.target.value })} />
                        </td>
                        <td className="p-1.5">
                          <Select aria-label={`Factory of step ${i + 1}`} className={cn(cell, "bg-surface-2")} value={r.factoryId} disabled={!canEdit} onChange={(e) => set(r.key, { factoryId: e.target.value })}>
                            <option value="">—</option>
                            {factories.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="p-1.5">
                          <Input aria-label={`Planned for step ${i + 1}`} type="date" className={cell} value={r.plannedOn} disabled={!canEdit} onChange={(e) => set(r.key, { plannedOn: e.target.value })} />
                        </td>
                        <td className="p-1.5">
                          <Input aria-label={`Step ${i + 1} done on`} type="date" className={cell} value={r.doneOn} disabled={!canEdit} onChange={(e) => set(r.key, { doneOn: e.target.value })} />
                        </td>
                        <td className="p-1.5">
                          <Input aria-label={`Note on step ${i + 1}`} className={cell} placeholder="Note" value={r.note} maxLength={500} disabled={!canEdit} onChange={(e) => set(r.key, { note: e.target.value })} />
                        </td>
                        <td className="p-1.5">
                          {canEdit && (
                            <Button size="icon-xs" variant="ghost" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} aria-label={`Remove step ${i + 1}`}>
                              <Trash2 aria-hidden />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.errors && <p className="text-xs text-bad">{Object.values(s.errors).flat()[0]}</p>}
              {canEdit && (
                <>
                  <div>
                    <Button size="sm" variant="secondary" onClick={() => setRows((x) => [...x, { id: null, key: key(), title: "", factoryId: first, plannedOn: "", doneOn: "", note: "" }])}>
                      <Plus aria-hidden /> Add step
                    </Button>
                  </div>
                  <div className="flex items-center gap-2.5 border-t border-line pt-4">
                    <SubmitButton pendingText="Saving…">
                      <Check aria-hidden /> Save timeline
                    </SubmitButton>
                    <Button variant="ghost" onClick={() => setRows(start())}>
                      Cancel
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </ActionForm>
      </CardBody>
    </Card>
  );
}
