import { NextResponse } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { z, ZodError } from "zod";
import { getCurrentUser, getSessionUser, type SessionUser } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";
import { DomainError, ForbiddenError, NotFoundError } from "@/lib/utils/result";
import { isUuid } from "@/lib/utils/ids";
import { DuplicateCustomerError } from "@/modules/customers/service";

/**
 * JSON API used by the mobile app (/api/v1/*). Every endpoint calls the same
 * services as the web screens, so rules, permissions, validation messages and
 * the audit log are identical. Sign-in: "Authorization: Bearer <token>".
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const noStore = { "Cache-Control": "no-store" };

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: noStore });

/** Wrap a handler: turns business errors into { error, fieldErrors? } with the right status. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      unstable_rethrow(error);
      if (error instanceof ApiError) return json({ error: error.message, ...error.extra }, error.status);
      if (error instanceof DuplicateCustomerError) return json({ error: error.message, duplicates: error.matches }, 409);
      if (error instanceof NotFoundError) return json({ error: error.message }, 404);
      if (error instanceof ForbiddenError) return json({ error: error.message }, 403);
      if (error instanceof DomainError) return json({ error: error.message }, 400);
      if (error instanceof ZodError) return json({ error: error.issues[0]?.message ?? "Invalid input.", fieldErrors: z.flattenError(error).fieldErrors }, 422);
      console.error("[api]", error);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  };
}

/** The signed-in user (cookie or bearer token), or 401. */
export async function apiUser(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    if ((await getSessionUser())?.twoStepSetupRequired)
      throw new ApiError(403, "Set up two-step sign-in first.", { code: "two_step_setup_required" });
    throw new ApiError(401, "Please sign in again.", { code: "signed_out" });
  }
  if (permission && !can(user.role, permission)) throw new ApiError(403, "You do not have permission to do this.");
  return user;
}

/**
 * The JSON body in the shape the web forms send: every value a string (numbers,
 * booleans as text, null as ""), arrays/objects as JSON text (line items).
 * So the exact same Zod schemas validate app and web input.
 */
export async function formBody(request: Request): Promise<Record<string, string>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "Send a JSON body.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiError(400, "Send a JSON object.");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined) out[k] = "";
    else if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
    else out[k] = JSON.stringify(v);
  }
  return out;
}

/** Validate with a form schema; 422 with per-field messages like the web forms. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new ApiError(422, "Please fix the highlighted fields.", { fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> });
  return parsed.data;
}

/** Route param that must be a UUID. */
export async function idParam(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!isUuid(id)) throw new ApiError(404, "Not found");
  return id;
}

/** Query string as a plain object (for the shared list-filter parsers). */
export const searchParams = (request: Request) => Object.fromEntries(new URL(request.url).searchParams);

export const page = (v: string | undefined) => Math.max(1, Math.min(10_000, Number(v) || 1));
