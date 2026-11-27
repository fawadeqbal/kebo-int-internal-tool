import { isMobileApp, newName, withNewNames, withOldNamesToo } from "@kebo/shared";

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

/** Says it reads the new names (this web, a newer phone app): `x-names: supplier`. */
const knowsNewNames = (headers: NamedRequest["headers"]): boolean => headers["x-names"] === "supplier";

/** A phone app from before the change: the phone app's user agent, and no word that it knows the new names. */
export const isOldPhone = (headers: NamedRequest["headers"]): boolean =>
  isMobileApp(String(headers["user-agent"] ?? "")) && !knowsNewNames(headers);

/**
 * The API speaks both names. An old name in a body or in a query is read as the new one, from anyone. An answer
 * carries the old name beside each new one unless the asker says it reads the new names: phone apps installed
 * before the change do not say so, and neither does the web from before it, which runs beside the new API for
 * the moments of a deploy (without the old names it would read a form's fields as empty and save them empty).
 */
export function oldNames() {
  return (req: NamedRequest, res: NamedResponse, next: () => void) => {
    if (req.body !== undefined && req.body !== null && typeof req.body === "object") {
      req.bodyAsSent = req.body;
      // An old phone app sets the name it knows and sends the other back as it got it: its own name is the one meant.
      req.body = withNewNames(req.body, isOldPhone(req.headers) ? "old" : "new");
    }
    const at = req.url.indexOf("?");
    if (at >= 0 && /factor(?:y|ies)/i.test(req.url.slice(at))) {
      const query = new URLSearchParams(req.url.slice(at + 1));
      const renamed = new URLSearchParams();
      for (const [key, v] of query) renamed.append(newName(key), v);
      req.url = `${req.url.slice(0, at)}?${renamed.toString()}`;
    }
    if (!knowsNewNames(req.headers)) {
      const json = res.json.bind(res);
      res.json = (body: unknown) => json(withOldNamesToo(body));
    }
    next();
  };
}
