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

/** A phone app from before the change: the phone app's user agent, and no word that it knows the new names. */
export const isOldPhone = (headers: NamedRequest["headers"]): boolean =>
  isMobileApp(String(headers["user-agent"] ?? "")) && headers["x-names"] !== "supplier";

/**
 * For the release that changes the names, the API speaks both: an old name in a body or in a query is read as
 * the new one, and every answer carries the old name beside each new one. Phone apps installed before the change
 * need both for good. The web needs them for the moments of a deploy when the old web still runs beside the new
 * API: it would read a form's fields as empty and save them empty, and its own `factoryId` would be dropped
 * without a word. Once the release is out, the answers' old names are for old phone apps only (the next change).
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
    const json = res.json.bind(res);
    res.json = (body: unknown) => json(withOldNamesToo(body));
    next();
  };
}
