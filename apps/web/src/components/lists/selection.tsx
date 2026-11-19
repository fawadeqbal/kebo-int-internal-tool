"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Check, CheckSquare } from "lucide-react";
import { Button, cn } from "@kebo/ui";

/*
 * Select on a list (design "list pages" 18 Nov 2026): Select turns the start of each row into a tick box and a light
 * bar in the theme's main colour takes the filter row's place, with what can be done to the ticked ones; Done
 * ends it. The tick in the table's head ticks every row on the page. Nothing else on the page moves.
 */

interface Selection {
  on: boolean;
  start: () => void;
  stop: () => void;
  ticked: string[];
  isTicked: (id: string) => boolean;
  toggle: (id: string) => void;
  all: boolean;
  some: boolean;
  toggleAll: () => void;
}

const Ctx = createContext<Selection | null>(null);

export function useSelection() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSelection outside <SelectionFrame>");
  return s;
}

/** Holds what is ticked, for the rows on this page (`ids`, in their order). */
export function SelectionFrame({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const value = useMemo<Selection>(() => {
    // Only rows still on the page count (the list may have changed under the ticks).
    const ticked = ids.filter((id) => picked.has(id));
    return {
      on,
      start: () => setOn(true),
      stop: () => {
        setOn(false);
        setPicked(new Set());
      },
      ticked,
      isTicked: (id) => picked.has(id),
      toggle: (id) =>
        setPicked((p) => {
          const n = new Set(p);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        }),
      all: ids.length > 0 && ticked.length === ids.length,
      some: ticked.length > 0,
      toggleAll: () => setPicked((p) => (ids.every((id) => p.has(id)) ? new Set() : new Set(ids))),
    };
  }, [ids, on, picked]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Select, at the end of the filter row. */
export function SelectButton() {
  const s = useSelection();
  return (
    <Button variant="secondary" onClick={s.start}>
      <CheckSquare aria-hidden /> Select
    </Button>
  );
}

/** Shown only while selecting (the bar), or only while not (the filter row). */
export function WhenSelecting({ children, not }: { children: ReactNode; not?: boolean }) {
  const s = useSelection();
  return (not ? !s.on : s.on) ? <>{children}</> : null;
}

function Tick({ on, label, mixed, onChange }: { on: boolean; label: string; mixed?: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        "grid size-[18px] place-items-center rounded-[5px] border-[1.5px] align-middle outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        on || mixed ? "border-primary-solid bg-primary-solid text-white" : "border-line-strong bg-surface",
      )}
    >
      {on ? <Check className="size-3" strokeWidth={3.4} aria-hidden /> : mixed ? <span className="h-0.5 w-2 rounded bg-white" aria-hidden /> : null}
    </button>
  );
}

/** The tick box in the table's head (every row on the page), while selecting. */
export function SelectHead() {
  const s = useSelection();
  if (!s.on) return null;
  return (
    <th scope="col" className="w-11 pr-0 pl-[18px]">
      <Tick on={s.all} mixed={s.some && !s.all} label="Tick every row" onChange={s.toggleAll} />
    </th>
  );
}

/** A row's tick box, while selecting. */
export function SelectCell({ id, label }: { id: string; label: string }) {
  const s = useSelection();
  if (!s.on) return null;
  return (
    <td className="w-11 pr-0 pl-[18px]">
      <Tick on={s.isTicked(id)} label={`Tick ${label}`} onChange={() => s.toggle(id)} />
    </td>
  );
}

/** The light bar: how many are ticked, what can be done to them, and Done at its end (as the items table's bar). */
export function SelectBar({ children }: { children: (ticked: string[]) => ReactNode }) {
  const s = useSelection();
  return (
    <div role="toolbar" aria-label="Ticked rows" className="mb-4 flex min-h-11 flex-wrap items-center gap-2 rounded-[10px] border border-primary-line bg-primary-soft py-1.5 pr-1.5 pl-3.5 text-sm text-text">
      <b className="mr-1.5 font-bold text-primary" aria-live="polite">
        {s.ticked.length ? `${s.ticked.length} selected` : "Tick the rows"}
      </b>
      {s.ticked.length > 0 && children(s.ticked)}
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={s.stop}>
        Done
      </Button>
    </div>
  );
}
