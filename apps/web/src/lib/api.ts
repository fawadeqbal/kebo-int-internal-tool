import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * The only way the web app talks to the API: on the server, with the person's
 * session token from the httpOnly cookie. Errors come back in the API's one
 * shape ({ error, code?, fieldErrors?, matches? }) as an ApiError.
 */
export const SESSION_COOKIE = "kebo_session";
/** The platform admin's session (the platform area, not any company). */
export const PLATFORM_COOKIE = "kebo_platform";

const base = () => (process.env.API_URL ?? "http://localhost:4000/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: {
      error?: string;
      code?: string;
      fieldErrors?: Record<string, string[] | undefined>;
      matches?: { id: string; label: string; detail?: string }[];
      choices?: string[];
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
  get code() {
    return this.body.code;
  }
}

async function token(platform = false) {
  return (await cookies()).get(platform ? PLATFORM_COOKIE : SESSION_COOKIE)?.value;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function url(path: string, query?: Query) {
  const u = new URL(`${base()}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

/**
 * The browser behind this request, passed on so the API records the person's
 * own device and address (sessions, sign-in history) rather than this server's.
 * The proxy in front sets X-Forwarded-For; the API trusts only its last hop (TRUST_PROXY).
 */
async function client(): Promise<Record<string, string>> {
  try {
    const h = await headers();
    const out: Record<string, string> = {};
    const ua = h.get("user-agent");
    const xff = h.get("x-forwarded-for");
    if (ua) out["user-agent"] = ua;
    if (xff) out["x-forwarded-for"] = xff;
    return out;
  } catch {
    return {};
  }
}

export async function apiFetch(path: string, init: RequestInit & { query?: Query; auth?: boolean; platform?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await client())) if (!headers.has(k)) headers.set(k, v);
  const t = init.auth === false ? undefined : await token(init.platform);
  if (t) headers.set("authorization", `Bearer ${t}`);
  if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
  return fetch(url(path, init.query), { ...init, headers, cache: "no-store" });
}

async function parse<T>(res: Response, platform = false): Promise<T> {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  // Their role needs two-step sign-in and they have not set it up: off to the setup, wherever they were.
  if (res.status === 403 && body?.code === "two_step_setup") redirect(platform ? "/platform/set-up-two-step" : "/login/set-up-two-step");
  // The platform session ended: sign in again.
  if (platform && res.status === 401) redirect("/platform/login");
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body ?? {});
  return body as T;
}

export const api = {
  get: async <T>(path: string, query?: Query) => parse<T>(await apiFetch(path, { query })),
  post: async <T>(path: string, body?: unknown) => parse<T>(await apiFetch(path, { method: "POST", body: JSON.stringify(body ?? {}) })),
  put: async <T>(path: string, body?: unknown) => parse<T>(await apiFetch(path, { method: "PUT", body: JSON.stringify(body ?? {}) })),
  patch: async <T>(path: string, body?: unknown) => parse<T>(await apiFetch(path, { method: "PATCH", body: JSON.stringify(body ?? {}) })),
  delete: async <T>(path: string) => parse<T>(await apiFetch(path, { method: "DELETE" })),
  /** Multipart upload (files). */
  upload: async <T>(path: string, form: FormData) => parse<T>(await apiFetch(path, { method: "POST", body: form })),
};

/** The platform admin's calls (/api/platform/…), with the platform session. */
export const platformApi = {
  get: async <T>(path: string, query?: Query) => parse<T>(await apiFetch(`/platform${path}`, { query, platform: true }), true),
  post: async <T>(path: string, body?: unknown) => parse<T>(await apiFetch(`/platform${path}`, { method: "POST", body: JSON.stringify(body ?? {}), platform: true }), true),
  put: async <T>(path: string, body?: unknown) => parse<T>(await apiFetch(`/platform${path}`, { method: "PUT", body: JSON.stringify(body ?? {}), platform: true }), true),
  patch: async <T>(path: string, body?: unknown) => parse<T>(await apiFetch(`/platform${path}`, { method: "PATCH", body: JSON.stringify(body ?? {}), platform: true }), true),
  delete: async <T>(path: string, body?: unknown) => parse<T>(await apiFetch(`/platform${path}`, { method: "DELETE", body: JSON.stringify(body ?? {}), platform: true }), true),
};
