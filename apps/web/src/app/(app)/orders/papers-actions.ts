"use server";

import { revalidatePath } from "next/cache";
import type { PaperKind } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, formBody, type ActionState } from "@/lib/actions";
import type { PaperChecks } from "@/lib/types-papers";

/**
 * The papers the app makes (see the API's /orders/:id/papers). One action for
 * every change on the Make page, bound to the order and the paper: draft (Save
 * as draft), final (Make final), again (Make again) and fix (missing data typed
 * there, saved where it belongs). Forms send a JSON `payload`.
 */
export type PaperOp = "draft" | "final" | "again" | "fix" | "buyer" | "quotedTerms";

const DONE: Record<PaperOp, string> = {
  draft: "Saved as a draft.",
  final: "Made final.",
  again: "Version started as a draft.",
  fix: "Saved.",
  buyer: "Buyer refreshed from the customer: documents made from now on print it.",
  quotedTerms: "Saved.",
};

export async function paperAction(
  orderId: string,
  kind: PaperKind,
  ref: string | null,
  op: PaperOp,
  paperId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const body = formBody(form);
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const call = () => {
    switch (op) {
      case "draft":
        return api.post<PaperChecks>(`/orders/${orderId}/papers/${kind}`, { ...body, ...(ref ? { ref } : {}) });
      case "final":
        return api.post<PaperChecks>(`/papers/${paperId}/final`, body);
      case "again":
        return api.post<PaperChecks>(`/orders/${orderId}/papers/${kind}/again`, ref ? { ref } : {});
      case "fix":
        return api.post<PaperChecks>(`/orders/${orderId}/papers/${kind}/fix${q}`, body);
      case "buyer":
        return api.post(`/orders/${orderId}/buyer`, body);
      case "quotedTerms":
        return api.post(`/orders/${orderId}/quoted-terms`, body);
    }
  };
  const r = await attempt(form, call, DONE[op]);
  if (!r.ok) return r;
  revalidatePath(`/orders/${orderId}`, "layout");
  revalidatePath("/orders");
  // Named: the paper and its number; once final, its PDF.
  const p = r.data as { label?: string; number?: string } | undefined;
  const name = p?.label ? `${p.label}${p.number ? ` ${p.number}` : ""}` : null;
  if (!name || (op !== "draft" && op !== "final" && op !== "again")) return r;
  const pdf = `/pdf/${kind}/${orderId}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
  if (op === "final") return { ...r, message: `${name} made final`, detail: "It is kept exactly as it is now", next: [{ label: "Download PDF", href: pdf }] };
  return { ...r, message: op === "draft" ? `${name} saved as a draft` : `${name}: a new version started as a draft` };
}
