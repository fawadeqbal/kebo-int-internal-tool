"use client";


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

/** Plain number text from what was typed ("1,200.5" → "1200.5"); the API checks the rest. */
export const numberText = (v: string) => v.replace(/,/g, "").trim();

