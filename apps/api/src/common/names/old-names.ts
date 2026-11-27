import { isMobileApp, newName, withNewNames, withOldNamesToo } from "@kebo/shared";

/**
 * The API's side of the old names (see @kebo/shared old-names): history rows saved before "factory" became
 * "supplier", and phone apps installed before it.
 */

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
  /** The body as the phone sent it: a repeated save is recognised by it (see OnceInterceptor). */
  bodyAsSent?: unknown;
}
interface OldPhoneResponse {
  json(body: unknown): unknown;
}

/** A phone app from before the change: the phone app's user agent, and no word that it knows the new names. */
export const isOldPhone = (headers: OldPhoneRequest["headers"]): boolean =>
  isMobileApp(String(headers["user-agent"] ?? "")) && headers["x-names"] !== "supplier";

/**
 * For an old phone app: its field names (in the body and in the address's query) are read as the new ones, and
 * the answer carries the old names beside the new. Everyone else passes straight through.
 */
export function oldPhoneNames() {
  return (req: OldPhoneRequest, res: OldPhoneResponse, next: () => void) => {
    if (!isOldPhone(req.headers)) return next();
    if (req.body !== undefined) {
      req.bodyAsSent = req.body;
      // The app sets the name it knows and sends the other back as it got it: its own name is the one meant.
      req.body = withNewNames(req.body, "old");
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
