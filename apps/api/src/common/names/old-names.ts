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
 * Old names on the way in, from anyone: a field in the body or a name in the address's query that still says
 * `factoryId` is read as `supplierId`. Phone apps installed before the change send them, and so does the web
 * for the moments of a deploy when the old web still runs beside the new API (an unknown name would be dropped
 * without a word). On the way out, only an old phone app gets the old names beside the new ones.
 */
export function oldNames() {
  return (req: NamedRequest, res: NamedResponse, next: () => void) => {
    const phone = isOldPhone(req.headers);
    if (req.body !== undefined && req.body !== null && typeof req.body === "object") {
      req.bodyAsSent = req.body;
      // An old phone app sets the name it knows and sends the other back as it got it: its own name is the one meant.
      req.body = withNewNames(req.body, phone ? "old" : "new");
    }
    const at = req.url.indexOf("?");
    if (at >= 0 && /factor(?:y|ies)/i.test(req.url.slice(at))) {
      const query = new URLSearchParams(req.url.slice(at + 1));
      const renamed = new URLSearchParams();
      for (const [key, v] of query) renamed.append(newName(key), v);
      req.url = `${req.url.slice(0, at)}?${renamed.toString()}`;
    }
    if (phone) {
      const json = res.json.bind(res);
      res.json = (body: unknown) => json(withOldNamesToo(body));
    }
    next();
  };
}
