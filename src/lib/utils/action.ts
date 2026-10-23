import { z, ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { DomainError, formToObject, type ActionState } from "./result";

/**
 * Wraps a server action: validates input with a Zod schema, turns business
 * errors into friendly messages, and keeps the user's typed values on error.
 */
export async function handleForm<S extends z.ZodTypeAny>(
  formData: FormData,
  schema: S,
  run: (data: z.infer<S>) => Promise<ActionState | void>,
): Promise<ActionState> {
  const raw = formToObject(formData);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      errors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
      values: raw,
    };
  }
  try {
    return (await run(parsed.data)) ?? { ok: true };
  } catch (error) {
    return { ...toActionError(error), values: raw };
  }
}

export function toActionError(error: unknown): ActionState {
  unstable_rethrow(error);
  if (error instanceof DomainError) return { ok: false, message: error.message };
  if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? "Invalid input." };
  console.error(error);
  return { ok: false, message: "Something went wrong. Please try again." };
}
