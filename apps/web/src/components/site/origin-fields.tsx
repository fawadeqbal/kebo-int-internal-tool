import type { LeadOrigin } from "@kebo/shared";
import { ORIGIN_FIELDS } from "@/lib/origin";

/** Where the visitor came from, sent along with a form (hidden). */
export function OriginFields({ origin }: { origin: LeadOrigin | null | undefined }) {
  if (!origin) return null;
  return <>{ORIGIN_FIELDS.map((k) => (origin[k] ? <input key={k} type="hidden" name={`origin.${k}`} value={origin[k] ?? ""} /> : null))}</>;
}
