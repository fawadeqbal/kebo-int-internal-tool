"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@kebo/ui";

/** Small pieces shared by the deal-work forms (line editors, errors). */

let seq = 0;
/** A client-only key for list rows (rows have no id until saved). */
export const rowKey = () => `row-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

export function ErrorText({ error, id }: { error?: string[] | string; id?: string }) {
  const message = Array.isArray(error) ? error[0] : error;
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-bad">
      {message}
    </p>
  );
}

/** Up / down / remove buttons for one row of a line editor. */
export function RowButtons({ index, count, onMove, onRemove, label, minRows = 1 }: { index: number; count: number; onMove: (to: number) => void; onRemove: () => void; label: string; minRows?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      <Button size="icon-xs" variant="ghost" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label={`Move ${label} up`}>
        <ArrowUp aria-hidden />
      </Button>
      <Button size="icon-xs" variant="ghost" onClick={() => onMove(index + 1)} disabled={index === count - 1} aria-label={`Move ${label} down`}>
        <ArrowDown aria-hidden />
      </Button>
      <Button size="icon-xs" variant="danger-ghost" onClick={onRemove} disabled={count <= minRows} aria-label={`Remove ${label}`}>
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}

/** Plain number text from what was typed ("1,200.5" → "1200.5"); the API checks the rest. */
export const numberText = (v: string) => v.replace(/,/g, "").trim();

/** Small grey label above compact controls inside line rows. */
export function MiniLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-muted">
      {children}
    </label>
  );
}
