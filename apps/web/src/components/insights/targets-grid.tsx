"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button, cn, Input } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface TargetRow {
  month: string;
  label: string;
  /** "company" and "p:<userId>" → amount as typed ("" when none). */
  values: Record<string, string>;
  sold: string | null;
  percent: number | null;
  current: boolean;
  past: boolean;
}

const fmt = (v: string) => (v ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—");

/**
 * Monthly targets for a year: the company's and each person's, one row per
 * month; a row opens for editing on its own and is saved as one.
 */
export function TargetsGrid({ rows, people, actions, currency }: { rows: TargetRow[]; people: { id: string; name: string }[]; actions: Record<string, Action>; currency: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  const cols = ["company", ...people.map((p) => `p:${p.id}`)];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="sticky left-0 z-10 bg-surface px-3 py-2 font-medium">Month</th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Company ({currency})</th>
            {people.map((p) => (
              <th key={p.id} className="px-3 py-2 text-right font-medium whitespace-nowrap" title={p.name}>
                {p.name.split(" ")[0]}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Sold</th>
            <th className="px-3 py-2 text-right font-medium">Progress</th>
            <th className="w-24 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) =>
            editing === r.month ? (
              <tr key={r.month} className="border-b border-line bg-primary-soft/30">
                <td colSpan={cols.length + 4} className="px-3 py-2">
                  <ActionForm action={actions[r.month]!} onDone={() => setEditing(null)} className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{r.label}</span>
                    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(9rem, 1fr))` }}>
                      {cols.map((k, i) => (
                        <label key={k} className="flex flex-col gap-1 text-xs text-muted">
                          {i === 0 ? "Company" : people[i - 1]!.name}
                          <Input name={k} inputMode="decimal" defaultValue={r.values[k] ?? ""} placeholder="—" className="tabular" />
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <SubmitButton size="sm" pendingText="Saving…">
                        Save {r.label}
                      </SubmitButton>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </ActionForm>
                </td>
              </tr>
            ) : (
              <tr key={r.month} className={cn("border-b border-line", r.current && "bg-surface-2")}>
                <td className={cn("sticky left-0 z-10 px-3 py-2", r.current ? "bg-surface-2 font-semibold" : "bg-surface")}>{r.label}</td>
                {cols.map((k) => (
                  <td key={k} className={cn("px-3 py-2 text-right tabular", !r.values[k] && "text-muted")}>
                    {fmt(r.values[k] ?? "")}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular">{r.sold === null ? "" : fmt(r.sold)}</td>
                <td className={cn("px-3 py-2 text-right tabular", r.percent !== null && r.percent >= 100 && "font-semibold text-ok", r.percent !== null && r.past && r.percent < 100 && "text-bad")}>
                  {r.percent === null ? "" : `${r.percent}%${r.percent >= 100 ? " · reached" : ""}`}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="xs" variant="ghost" onClick={() => setEditing(r.month)} aria-label={`Change the targets for ${r.label}`}>
                    <Pencil aria-hidden /> {Object.values(r.values).some(Boolean) ? "Change" : "Set"}
                  </Button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
