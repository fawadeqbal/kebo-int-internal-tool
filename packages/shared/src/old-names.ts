/**
 * "Factory" became "supplier" in the code's names (27 Nov 2026). Two things still speak the old names, and
 * these functions are how they are read:
 *  - JSON saved before the change (settings, a submission's body, the history's snapshots, a remembered answer);
 *  - phone apps installed before it (they send `factoryId` and read `factoryTotal`).
 * Only compound names changed (`factoryId` → `supplierId`). The bare word (`factory`, `factories`) and
 * snake_case names (database names and stored values) are as they were, so they pass through untouched.
 * Goes away when the stored data is renamed and the old phone apps are gone.
 */

/**
 * The word as one part of a camelCase name: at the start before a capital (`factoryId`), or capitalised after
 * a small letter (`newFactoryName`). Not the bare word, not snake_case, not a word that only holds it ("satisfactory").
 */
const swap = (key: string, start: RegExp, inside: RegExp, one: string, many: string) => {
  if (key.includes("_")) return key;
  const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);
  return key
    .replace(start, (m, plural: string | undefined) => (m[0] === m[0]!.toUpperCase() ? cap(plural ? many : one) : plural ? many : one))
    .replace(inside, (_m, plural: string | undefined) => cap(plural ? many : one));
};

/** `factoryId` → `supplierId`. Anything else comes back as it is. */
export const newName = (key: string): string =>
  swap(key, /^[fF]actor(?:y|(ies))(?=[A-Z0-9])/, /(?<=[a-z0-9])Factor(?:y|(ies))(?![a-z])/g, "supplier", "suppliers");

/** `supplierId` → `factoryId`: what a phone app from before the change calls it. */
export const oldName = (key: string): string =>
  swap(key, /^[sS]upplier(s)?(?=[A-Z0-9])/, /(?<=[a-z0-9])Supplier(s)?(?![a-z])/g, "factory", "factories");

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
