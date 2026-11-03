"use client";

import { useRef } from "react";
import { PAPER_SWITCH_GROUPS, PAPER_SWITCH_LABEL, PAPER_SWITCH_NOTE } from "@kebo/shared";
import { SwitchList } from "@/components/common/switch-list";
import type { ActionState } from "@/lib/actions";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * One switch per paper, grouped (made by the app, from others); each switch
 * saves at once (the API keeps the whole list of papers switched off).
 */
export function PapersEditor({ off: initial, action }: { off: string[]; action: Action }) {
  // The list as switched so far, so quick switches one after another each send all of them.
  const off = useRef<string[]>(initial);
  const save = async (key: string, on: boolean) => {
    const before = off.current;
    off.current = on ? before.filter((k) => k !== key) : [...before.filter((k) => k !== key), key];
    const form = new FormData();
    form.set("payload", JSON.stringify({ off: off.current }));
    const r = await action({}, form);
    if (r.ok === false) off.current = before;
    return r;
  };
  return (
    <div className="flex flex-col">
      {PAPER_SWITCH_GROUPS.map((g) => (
        <section key={g.title} aria-labelledby={`papers-${g.title}`} className="flex flex-col border-t border-line first:border-t-0">
          <div className="px-4 pt-3 pb-1">
            <h3 id={`papers-${g.title}`} className="text-[11px] font-semibold tracking-wide text-muted uppercase">
              {g.title}
            </h3>
            <p className="text-xs text-muted">{g.hint}</p>
          </div>
          <SwitchList
            label={g.title}
            items={g.keys.map((k) => ({ key: k, label: PAPER_SWITCH_LABEL[k], hint: PAPER_SWITCH_NOTE[k], on: !initial.includes(k) }))}
            save={save}
          />
        </section>
      ))}
    </div>
  );
}
