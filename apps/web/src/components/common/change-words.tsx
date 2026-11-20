import type { ReactNode } from "react";
import { Undo2 } from "lucide-react";
import { cn } from "@kebo/ui";

/**
 * The words for changes, one rule everywhere (canvas group 9, "The words for changes: Added, Changed, Removed"):
 *
 * - An empty field given a value is **Added**: a quiet green word, not a change. It is not counted and never asks Why?.
 * - A saved value replaced by another is **Changed · was X**; a saved value cleared is **Removed · was X**. Both
 *   count, and Save asks Why? once.
 * - Typed and put back as it was: nothing.
 *
 * The values compared are the words shown for them, with an empty value as "" (never "empty" or "none").
 */
export type ChangeKind = "added" | "changed" | "removed";

const blank = (v: string | null | undefined) => !v || !v.trim();

/** What happened to one value between how it was saved (`was`) and now. */
export function changeKind(was: string | null | undefined, now: string | null | undefined): ChangeKind | null {
  const a = (was ?? "").trim();
  const b = (now ?? "").trim();
  if (a === b) return null;
  if (blank(a)) return "added";
  if (blank(b)) return "removed";
  return "changed";
}

/** How many of a list are changes (changed or removed) and how many only added. */
export function countChanges(list: { from: string; to: string }[]): { changed: number; added: number } {
  let changed = 0;
  let added = 0;
  for (const c of list) {
    const k = changeKind(c.from, c.to);
    if (k === "added") added += 1;
    else if (k) changed += 1;
  }
  return { changed, added };
}

/**
 * The save button's words: "No changes" (nothing done), "Save" (only added: no count, no Why?), "Save 2 changes".
 * A new record never says "Save changes": its button names the thing (`create`: "Add the customer").
 */
export function changeWords({ changed, added = 0, create }: { changed: number; added?: number; create?: string }): string {
  if (create) return create;
  if (changed) return `Save ${changed} change${changed === 1 ? "" : "s"}`;
  return added ? "Save" : "No changes";
}

/** "2 changes · 1 added", "1 added", or "" — the quiet count beside a window's buttons and on its Changes step. */
export function changeCount({ changed, added = 0 }: { changed: number; added?: number }): string {
  return [changed ? `${changed} change${changed === 1 ? "" : "s"}` : "", added ? `${added} added` : ""].filter(Boolean).join(" · ");
}

/** One change as a line for the Why? sheet and the history: "Changed · Lead time: 35 days → 40 days". */
export function changeLine(label: string, was: string, now: string): string {
  const k = changeKind(was, now);
  if (k === "added") return `Added · ${label}: ${now.trim()}`;
  if (k === "removed") return `Removed · ${label} · was ${was.trim()}`;
  return `Changed · ${label}: ${was.trim()} → ${now.trim()}`;
}

/** The orange edge on a field that was changed or removed (an added one gets none). */
export const changedFieldClass = "[&_:is(input,select,textarea)]:border-action/70 [&_[aria-checked=true]]:border-action";
export const changedClassOf = (was: string, now: string) => {
  const k = changeKind(was, now);
  return k === "changed" || k === "removed" ? changedFieldClass : undefined;
};

/**
 * The one hint under a field that differs from how it was saved: "Added" (green), "Changed · was 35 days" or
 * "Removed · was FOB" (orange), with Undo when the form can put it back. Nothing when it is as saved.
 */
export function ChangeHint({ was, now, onUndo, className }: { was: string; now: string; onUndo?: () => void; className?: string }) {
  const k = changeKind(was, now);
  if (!k) return null;
  const words: ReactNode = k === "added" ? "Added" : `${k === "changed" ? "Changed" : "Removed"} · was ${was.trim()}`;
  return (
    <span data-was="" className={cn("flex flex-wrap items-center gap-x-1.5 text-xs font-semibold", k === "added" ? "text-ok" : "text-action", className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", k === "added" ? "bg-ok" : "bg-action-solid")} />
      {words}
      {onUndo && k !== "added" && (
        <button type="button" onClick={onUndo} className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
          <Undo2 className="size-3" aria-hidden /> Undo
        </button>
      )}
    </span>
  );
}

/** The "Was" cell of a Changes table: the old value struck through, or "Added" when it was empty. */
export function Was({ was }: { was: string }) {
  return was.trim() ? <s className="text-muted">{was}</s> : <span className="font-semibold text-ok">Added</span>;
}

/** The "Now" cell of a Changes table: the new value, or "Removed" when it was cleared. */
export function Now({ now }: { now: string }) {
  return now.trim() ? <b className="font-semibold">{now}</b> : <span className="font-semibold text-action">Removed</span>;
}

/**
 * One saved change as it reads in a box's clock, the edits list and History: its word (Added green; Changed and
 * Removed orange), then "Label: old → new" with the old struck through and the new bold.
 */
export function ChangeText({ text }: { text: string }) {
  const m = /^(Added|Changed|Removed) · /.exec(text);
  const kind = m?.[1];
  const rest = m ? text.slice(m[0].length) : text;
  const arrow = rest.lastIndexOf(" → ");
  let body: ReactNode = rest;
  if (arrow >= 0) {
    const left = rest.slice(0, arrow);
    const colon = left.indexOf(": ");
    body = (
      <>
        {colon >= 0 ? (
          <>
            {left.slice(0, colon + 2)}
            <s className="text-muted">{left.slice(colon + 2)}</s>
          </>
        ) : (
          left
        )}{" "}
        → <b className="font-semibold">{rest.slice(arrow + 3)}</b>
      </>
    );
  }
  return (
    <span>
      {kind && <span className={cn("font-semibold", kind === "Added" ? "text-ok" : "text-action")}>{kind} · </span>}
      {body}
    </span>
  );
}
