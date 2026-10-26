import { REASON_CHOICES, type ReasonKind } from "@kebo/shared";
import { ReasonNeededError } from "@kebo/utils";

/**
 * A change that affects someone else, the customer, a factory or money needs a
 * reason. Without one the API answers 409 "reason_needed" with quick choices;
 * the form asks "Why?" and sends the same request again with `reason`.
 * Returns the reason, trimmed, for the audit record.
 */
export function requireReason(reason: string | null | undefined, kind: ReasonKind, why: string): string {
  const r = reason?.trim();
  if (!r) throw new ReasonNeededError(`Say why ${why}.`, REASON_CHOICES[kind]);
  return r;
}
