import { isMobileApp, newName, withBareOldNamesToo, withNewNames, withOldNamesToo } from "@kebo/shared";

/**
 * The API's side of the old names (see @kebo/shared old-names): history rows saved before "factory" became
 * "supplier", and requests that still use the old names.
 */

/** A history row as it was saved: its before and after snapshots read with the new names. */
export const savedHistory = <T extends { oldValues?: unknown; newValues?: unknown }>(row: T): T => ({
  ...row,
  ...("oldValues" in row ? { oldValues: withNewNames(row.oldValues) } : {}),
  ...("newValues" in row ? { newValues: withNewNames(row.newValues) } : {}),
});

interface NamedRequest {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  body?: unknown;
  /** The body as it was sent: a repeated save is recognised by it (see OnceInterceptor). */
  bodyAsSent?: unknown;
}
interface NamedResponse {
  json(body: unknown): unknown;
}

/**
 * Says it reads the new names. `x-names: supplier`: the compound ones (`supplierId`), the web from 27 Nov.
 * `x-names: supplier.2`: the bare word too (`supplier` for `factory`), the web from step B (28 Nov). No phone build
 * says either yet (the next release will).
 */
const namesOf = (headers: NamedRequest["headers"]) => String(headers["x-names"] ?? "");
const knowsNewNames = (headers: NamedRequest["headers"]): boolean => ["supplier", "supplier.2"].includes(namesOf(headers));
const knowsBareNames = (headers: NamedRequest["headers"]): boolean => namesOf(headers) === "supplier.2";

/**
 * Step R1b (28 Nov 2026): the API's addresses say supplier. The old ones are read as the new, from anyone: a phone
 * app installed before, an address the API gave out before (`voidPath`), the web of the day before during a deploy.
 * Only where the old routes had the word, as a whole segment: right after /api (`/api/factories/…`), or after
 * /api/orders/:id, /api/inquiries/:id or /api/insights/facts. Anywhere else it may be a value someone chose (a role
 * named "Factories" has the key `factories`), and `factory` alone is a stored kind (`/ledger/parties/factory/:id`).
 */
const OLD_SEGMENTS: Readonly<Record<string, string>> = {
  factories: "suppliers",
  "factory-facts": "supplier-facts",
  "factory-lines": "supplier-lines",
  "factory-order": "supplier-order",
  "factory-orders": "supplier-orders",
  "factory-payments": "supplier-payments",
  "factory-plan": "supplier-plan",
  "factory-quotes": "supplier-quotes",
  "factory-requests": "supplier-requests",
};

/** `/api/factory-quotes/q1/lines` → `/api/supplier-quotes/q1/lines`. Any other address comes back as it is. */
export function newPath(path: string): string {
  const s = path.split("/"); // ["", "api", first, second, third, …]
  if (s[1] !== "api") return path;
  const renameAt = (i: number) => {
    if (Object.hasOwn(OLD_SEGMENTS, s[i] ?? "")) s[i] = OLD_SEGMENTS[s[i]!]!;
  };
  renameAt(2);
  if (s[2] === "orders" || s[2] === "inquiries" || (s[2] === "insights" && s[3] === "facts")) renameAt(4);
  return s.join("/");
}

/** A phone app from before the change: the phone app's user agent, and no word that it knows the new names. */
export const isOldPhone = (headers: NamedRequest["headers"]): boolean =>
  isMobileApp(String(headers["user-agent"] ?? "")) && !knowsNewNames(headers);

/**
 * The API speaks both names. An old compound name in a body or in a query is read as the new one, from anyone (the
 * bare word never is: in a body it may be a key of a table looked up by a stored value). An answer carries the old
 * name beside each new one unless the asker says it reads the new names: phone apps installed before the change do
 * not say so, and neither does the web from before it, which runs beside the new API for the moments of a deploy
 * (without the old names it would read a form's fields as empty and save them empty).
 */
export function oldNames() {
  return (req: NamedRequest, res: NamedResponse, next: () => void) => {
    if (req.body !== undefined && req.body !== null && typeof req.body === "object") {
      req.bodyAsSent = req.body;
      // An old phone app sets the name it knows and sends the other back as it got it: its own name is the one meant.
      req.body = withNewNames(req.body, isOldPhone(req.headers) ? "old" : "new");
    }
    const atQuery = req.url.indexOf("?");
    const path = atQuery >= 0 ? req.url.slice(0, atQuery) : req.url;
    if (/factor(?:y|ies)/i.test(path)) req.url = newPath(path) + (atQuery >= 0 ? req.url.slice(atQuery) : "");
    const at = req.url.indexOf("?");
    if (at >= 0 && /factor(?:y|ies)/i.test(req.url.slice(at))) {
      const query = new URLSearchParams(req.url.slice(at + 1));
      const renamed = new URLSearchParams();
      for (const [key, v] of query) renamed.append(newName(key), v);
      req.url = `${req.url.slice(0, at)}?${renamed.toString()}`;
    }
    // The old twins in answers: the bare word (step B) for anyone who does not say `supplier.2` (an old phone; the
    // web of the day before, during a deploy), and the compound names too for anyone who says neither value.
    if (!knowsBareNames(req.headers)) {
      const compound = !knowsNewNames(req.headers);
      const json = res.json.bind(res);
      res.json = (body: unknown) => json(withBareOldNamesToo(compound ? withOldNamesToo(body) : body));
    }
    next();
  };
}
