import "server-only";
import { cookies } from "next/headers";

/**
 * The only way the web app talks to the API: on the server, with the person's
 * session token from the httpOnly cookie. Errors come back in the API's one
 * shape ({ error, code?, fieldErrors?, matches? }) as an ApiError.
 */
export const SESSION_COOKIE = "kebo_session";

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

async function token() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function url(path: string, query?: Query) {
  const u = new URL(`${base()}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  return u.toString();
}

export async function apiFetch(path: string, init: RequestInit & { query?: Query; auth?: boolean } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const t = init.auth === false ? undefined : await token();
  if (t) headers.set("authorization", `Bearer ${t}`);
  if (init.body && typeof init.body === "string") headers.set("content-type", "application/json");
  return fetch(url(path, init.query), { ...init, headers, cache: "no-store" });
}

async function parse<T>(res: Response): Promise<T> {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
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
