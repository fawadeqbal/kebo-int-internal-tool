"use client";

import { useState } from "react";
import { PAPER_SWITCH_GROUPS, PAPER_SWITCH_LABEL, PAPER_SWITCH_NOTE, PAPER_SWITCHES } from "@kebo/shared";
import { cn } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** One switch per paper, grouped (made by the app, from others); saved as a whole. */
export function PapersEditor({ off: initial, action }: { off: string[]; action: Action }) {
  const [off, setOff] = useState<string[]>(initial);
  const [saved, setSaved] = useState(initial);
  const dirty = [...off].sort().join() !== [...saved].sort().join();
  const on = PAPER_SWITCHES.length - off.length;
  return (
    <ActionForm action={action} keepFields onDone={() => setSaved(off)} className="flex flex-col gap-5">
      <input type="hidden" name="payload" value={JSON.stringify({ off })} />
      {PAPER_SWITCH_GROUPS.map((g) => (
        <section key={g.title} aria-labelledby={`papers-${g.title}`} className="flex flex-col gap-2">
          <div>
            <h3 id={`papers-${g.title}`} className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              {g.title}
            </h3>
            <p className="text-xs text-muted">{g.hint}</p>
          </div>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {g.keys.map((k) => {
              const used = !off.includes(k);
              const id = `paper-${k}`;
              return (
                <li key={k} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <label htmlFor={id} className="min-w-0 cursor-pointer">
                    <span className={cn("block text-sm font-medium", !used && "text-muted")}>{PAPER_SWITCH_LABEL[k]}</span>
                    {PAPER_SWITCH_NOTE[k] && <span className="block text-xs text-muted">{PAPER_SWITCH_NOTE[k]}</span>}
                  </label>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={cn("text-xs", used ? "text-ok" : "text-muted")} aria-hidden>
                      {used ? "On" : "Off"}
                    </span>
                    <button
                      id={id}
                      type="button"
                      role="switch"
                      aria-checked={used}
                      aria-label={`${PAPER_SWITCH_LABEL[k]}: ${used ? "used" : "not used"}`}
                      onClick={() => setOff((o) => (used ? [...o, k] : o.filter((x) => x !== k)))}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                        used ? "bg-primary-solid" : "bg-surface-3",
                      )}
                    >
                      <span className={cn("inline-block size-4 rounded-full bg-white shadow-card transition-transform", used ? "translate-x-[18px]" : "translate-x-0.5")} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <SubmitButton size="sm" pendingText="Saving…" disabled={!dirty}>
          Save the papers
        </SubmitButton>
        <span className="text-xs text-muted">
          {on} of {PAPER_SWITCHES.length} papers on.{dirty ? " Not saved yet." : ""}
        </span>
      </div>
    </ActionForm>
  );
}
