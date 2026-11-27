/**
 * "Factory" became "supplier" in the code's names (27 Nov 2026). Two things still speak the old names, and
 * these functions are how they are read:
 *  - JSON saved before the change (settings, a submission's body, the history's snapshots, a remembered answer);
 *  - phone apps installed before it (they send `factoryId` and read `factoryTotal`).
 * Only compound names changed (`factoryId` → `supplierId`): the 225 of them are listed in old-names.renamed.ts.
 * The bare word (`factory`, `factories`), snake_case names (database names and stored values) and names that
 * always said supplier (`supplierCode`) are not in the list, so they pass through untouched.
 * Goes away when the stored data is renamed and the old phone apps are gone.
 */
import { RENAMED } from "./old-names.renamed";

/** The names that changed, both ways. A Map: a key such as "constructor" is not a name that changed. */
const NEW_OF = new Map(Object.entries(RENAMED));
const OLD_OF = new Map(Object.entries(RENAMED).map(([old, now]) => [now, old]));

/** `factoryId` → `supplierId`. A name that did not change comes back as it is. */
export const newName = (key: string): string => NEW_OF.get(key) ?? key;

/** `supplierId` → `factoryId`: what a phone app from before the change calls it. `supplierCode` stays: it was always that. */
export const oldName = (key: string): string => OLD_OF.get(key) ?? key;

/** A list of field names saved before the change (the history's "what changed"). */
export const newNames = (keys: readonly string[]): string[] => keys.map(newName);

/** Plain JSON objects only: a date, a decimal or a buffer is a value, not a bag of names. */
const plain = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Old names read as new ones, all the way down. When a thing carries both spellings of one name, `wins` says
 * which value is kept: "new" for saved JSON; "old" for a body from an old phone app, which sets only the name it
 * knows and sends the other back as it got it.
 */
export function withNewNames<T>(value: T, wins: "new" | "old" = "new"): T {
  if (Array.isArray(value)) return value.map((v) => withNewNames(v, wins)) as T;
  if (!plain(value)) return value;
  const entries: [string, unknown][] = [];
  for (const [key, v] of Object.entries(value)) {
    const to = newName(key);
    if (wins === "new" && to !== key && Object.hasOwn(value, to)) continue; // its new twin is here: that one is kept
    if (wins === "old" && to === key && Object.hasOwn(value, oldName(key)) && oldName(key) !== key) continue; // its old twin is here
    entries.push([to, withNewNames(v, wins)]);
  }
  // fromEntries defines each key as the object's own (a key named __proto__ is data here, never a prototype).
  return Object.fromEntries(entries) as T;
}

/** Every new name with its old twin beside it, all the way down (an answer for an old phone app). */
export function withOldNamesToo<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withOldNamesToo) as T;
  if (!plain(value)) return value;
  const entries: [string, unknown][] = [];
  for (const [key, v] of Object.entries(value)) {
    const w = withOldNamesToo(v);
    entries.push([key, w]);
    const old = oldName(key);
    if (old !== key && !Object.hasOwn(value, old)) entries.push([old, w]);
  }
  return Object.fromEntries(entries) as T;
}
