import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Push notifications through Firebase Cloud Messaging (HTTP v1 API).
 * Needs the Firebase service-account key, either as a file
 * (FCM_SERVICE_ACCOUNT_FILE, default ./secrets/firebase.json — on the server
 * /opt/kebo-rfq/secrets/firebase.json) or as JSON in FCM_SERVICE_ACCOUNT_JSON.
 * Without one, push is simply off.
 */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let account: ServiceAccount | null | undefined;
function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  try {
    const raw =
      process.env.FCM_SERVICE_ACCOUNT_JSON ||
      (() => {
        const file = process.env.FCM_SERVICE_ACCOUNT_FILE || "./secrets/firebase.json";
        // The key file is read at run time only (not bundled into the build).
        return existsSync(/* turbopackIgnore: true */ file) ? readFileSync(/* turbopackIgnore: true */ file, "utf8") : "";
      })();
    const parsed = raw ? (JSON.parse(raw) as ServiceAccount) : null;
    account = parsed?.project_id && parsed.client_email && parsed.private_key ? parsed : null;
    if (raw && !account) console.error("[push] the Firebase service-account key is not valid; push is off");
  } catch (error) {
    console.error("[push] could not read the Firebase service-account key; push is off", error);
    account = null;
  }
  return account;
}

export const pushEnabled = () => serviceAccount() !== null;

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

let cached: { token: string; expires: number } | null = null;
async function accessToken(a: ServiceAccount): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const tokenUri = a.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({ iss: a.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: tokenUri, iat: now, exp: now + 3600 }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(a.private_key);
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) throw new Error(`Firebase sign-in failed: ${data.error_description ?? res.status}`);
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export interface PushMessage {
  title: string;
  body?: string | null;
  /** Small key/value data for the app, e.g. { link: "/queries/…" }. */
  data?: Record<string, string>;
}

/** Sends to each phone. Returns the tokens Firebase says are no longer valid (uninstalled / signed out). */
export async function sendPush(tokens: string[], message: PushMessage): Promise<string[]> {
  const a = serviceAccount();
  if (!a || tokens.length === 0) return [];
  const bearer = await accessToken(a);
  const url = `${process.env.FCM_API_BASE || "https://fcm.googleapis.com"}/v1/projects/${a.project_id}/messages:send`;
  const dead: string[] = [];
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: message.title.slice(0, 200), body: (message.body ?? "").slice(0, 500) },
              data: message.data ?? {},
              // Each push is its own notification (a unique tag), on the "Updates" channel, so several stack up in the shade.
              android: { priority: "high", notification: { sound: "default", channel_id: "kebo_updates", tag: `kebo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } },
              apns: { payload: { aps: { sound: "default" } } },
            },
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return;
        const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
        const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status;
        if (res.status === 404 || code === "UNREGISTERED" || (code === "INVALID_ARGUMENT" && /token/i.test(err.error?.message ?? ""))) {
          dead.push(token);
        } else {
          if (res.status === 401) cached = null;
          console.error(`[push] send failed (${res.status} ${code ?? ""}): ${err.error?.message ?? ""}`);
        }
      } catch (error) {
        console.error("[push] send failed", error);
      }
    }),
  );
  return dead;
}
