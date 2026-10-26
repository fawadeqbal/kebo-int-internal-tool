import { splitDescription } from "./line-items";

export interface ComparableLine {
  description: string;
  quantity: string | number;
  unit: string;
  unitPrice: string | number;
  queryItemId?: string | null;
}

export type LineChange =
  | { kind: "added"; name: string; quantity: number; unit: string; unitPrice: number }
  | { kind: "removed"; name: string }
  | { kind: "changed"; name: string; quantity?: [number, number]; unit?: [string, string]; unitPrice?: [number, number]; details?: true };

/**
 * What changed from one quotation version to the next, line by line. Lines
 * are matched by the requested item they answer, then by item name.
 */
export function compareLines(before: ComparableLine[], after: ComparableLine[]): LineChange[] {
  const keyOf = (l: ComparableLine) => (l.queryItemId ? `item:${l.queryItemId}` : `name:${splitDescription(l.description).name.toLowerCase()}`);
  const left = new Map<string, ComparableLine>();
  for (const l of before) if (!left.has(keyOf(l))) left.set(keyOf(l), l);
  const changes: LineChange[] = [];
  const seen = new Set<string>();
  for (const l of after) {
    const key = keyOf(l);
    const name = splitDescription(l.description).name || "Line";
    const old = seen.has(key) ? undefined : left.get(key);
    seen.add(key);
    if (!old) {
      changes.push({ kind: "added", name, quantity: Number(l.quantity), unit: l.unit, unitPrice: Number(l.unitPrice) });
      continue;
    }
    const c: Extract<LineChange, { kind: "changed" }> = { kind: "changed", name };
    if (Number(old.quantity) !== Number(l.quantity)) c.quantity = [Number(old.quantity), Number(l.quantity)];
    if (old.unit !== l.unit) c.unit = [old.unit, l.unit];
    if (Number(old.unitPrice) !== Number(l.unitPrice)) c.unitPrice = [Number(old.unitPrice), Number(l.unitPrice)];
    if (old.description.trim() !== l.description.trim()) c.details = true;
    if (c.quantity || c.unit || c.unitPrice || c.details) changes.push(c);
  }
  for (const [key, l] of left) if (!seen.has(key)) changes.push({ kind: "removed", name: splitDescription(l.description).name || "Line" });
  return changes;
}
