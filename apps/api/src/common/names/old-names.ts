/**
 * "Factory" became "supplier" in the code's names (27 Nov 2026). Two things still speak the old names, and
 * this file is the one place that reads them:
 *  - JSON saved before the change (a submission's body, the history's snapshots, a remembered answer);
 *  - phone apps installed before it (they send `factoryId` and read `factoryTotal`).
 * Only compound names changed (`factoryId` → `supplierId`). The bare word (`factory`, `factories`) and
 * snake_case names (database names and stored values) are as they were, so they pass through untouched.
 * Goes away when the stored data is renamed and the old phone apps are gone.
 */
const OLD = /factor(?:y|ies)/i;
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

/** Plain JSON objects only: a date, a decimal or a buffer is a value, not a bag of names. */
const plain = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Old names read as new ones, all the way down. A new name already there wins over its old twin. */
export function withNewNames<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withNewNames) as T;
  if (!plain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const to = newName(key);
    if (to !== key && to in value) continue;
    out[to] = withNewNames(v);
  }
  return out as T;
}

/** Every new name with its old twin beside it, all the way down (an answer for an old phone app). */
export function withOldNamesToo<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withOldNamesToo) as T;
  if (!plain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    const w = withOldNamesToo(v);
    out[key] = w;
    const old = oldName(key);
    if (old !== key && !(old in value)) out[old] = w;
  }
  return out as T;
}

/** A list of field names saved before the change (the history's "what changed"). */
export const newNames = (keys: readonly string[]): string[] => keys.map(newName);

/** A history row as it was saved: its before and after snapshots read with the new names. */
export const savedHistory = <T extends { oldValues?: unknown; newValues?: unknown }>(row: T): T => ({
  ...row,
  ...("oldValues" in row ? { oldValues: withNewNames(row.oldValues) } : {}),
  ...("newValues" in row ? { newValues: withNewNames(row.newValues) } : {}),
});

interface OldPhoneRequest {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  body?: unknown;
}
interface OldPhoneResponse {
  json(body: unknown): unknown;
}

/** A phone app from before the change: Dart's own user agent, and no word that it knows the new names. */
export const isOldPhone = (headers: OldPhoneRequest["headers"]): boolean =>
  /^Dart\//.test(String(headers["user-agent"] ?? "")) && headers["x-names"] !== "supplier";

/**
 * For an old phone app: its field names (in the body and in the address's query) are read as the new ones, and
 * the answer carries the old names beside the new. Everyone else passes straight through.
 */
export function oldPhoneNames() {
  return (req: OldPhoneRequest, res: OldPhoneResponse, next: () => void) => {
    if (!isOldPhone(req.headers)) return next();
    if (req.body !== undefined) req.body = withNewNames(req.body);
    const at = req.url.indexOf("?");
    if (at >= 0 && OLD.test(req.url.slice(at))) {
      const query = new URLSearchParams(req.url.slice(at + 1));
      const renamed = new URLSearchParams();
      for (const [key, v] of query) renamed.append(newName(key), v);
      req.url = `${req.url.slice(0, at)}?${renamed.toString()}`;
    }
    const json = res.json.bind(res);
    res.json = (body: unknown) => json(withOldNamesToo(body));
    next();
  };
}
