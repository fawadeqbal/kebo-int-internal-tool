"use server";

import { revalidatePath } from "next/cache";
import type { OrderFileAttachInput, OrderFileSource, OrderFileUpdateInput, PaperKind } from "@kebo/shared";
import { api } from "@/lib/api";
import { attempt, type ActionState } from "@/lib/actions";

/**
 * Documents v3: the tools on every file of an order (see the API's
 * /orders/:id/files). Called from the file chip, row, viewer and the bulk bar
 * with plain values; uploads and replacements go through /files/orders/… (server
 * actions cap bodies at 1 MB).
 */
const done = (orderId: string, r: ActionState) => {
  if (r.ok) revalidatePath(`/orders/${orderId}`, "layout");
  return r;
};

export async function fileUpdateAction(
  orderId: string,
  source: OrderFileSource,
  fileId: string,
  body: Partial<OrderFileUpdateInput>,
): Promise<ActionState> {
  return done(orderId, await attempt(null, () => api.patch(`/orders/${orderId}/files/${source}/${fileId}`, body), "Saved."));
}

export async function fileAttachAction(
  orderId: string,
  source: OrderFileSource,
  fileId: string,
  body: OrderFileAttachInput,
): Promise<ActionState> {
  return done(orderId, await attempt(null, () => api.post(`/orders/${orderId}/files/${source}/${fileId}/attach`, body), "Attached."));
}

export async function fileRemoveAction(orderId: string, source: OrderFileSource, fileId: string): Promise<ActionState> {
  return done(orderId, await attempt(null, () => api.delete(`/orders/${orderId}/files/${source}/${fileId}`), "Deleted."));
}

/** Notes a share in History; the app itself sends nothing. */
export async function filesShareAction(
  orderId: string,
  body: { files: string[]; papers: string[]; via: "share" | "download"; message?: string | null },
): Promise<ActionState> {
  return done(orderId, await attempt(null, () => api.post(`/orders/${orderId}/files/share`, body), "Noted in History."));
}

/** Make again: a new version of a final paper, as a draft. */
export async function paperAgainAction(orderId: string, kind: PaperKind, ref: string | null): Promise<ActionState> {
  return done(
    orderId,
    await attempt(null, () => api.post(`/orders/${orderId}/papers/${kind}/again`, ref ? { ref } : {}), "Version started as a draft."),
  );
}

/** Delete the draft (a final version stays as it was printed). */
export async function paperDeleteDraftAction(orderId: string, paperId: string): Promise<ActionState> {
  return done(orderId, await attempt(null, () => api.delete(`/papers/${paperId}`), "Draft deleted."));
}

/**
 * The order's own proforma and packing list: "again" starts the next version as a draft (same number),
 * "final" makes it final as it prints now (the proforma's draft is issued), "delete" drops the draft.
 */
export async function ownDocumentAction(orderId: string, kind: "proforma" | "packing-list", op: "again" | "final" | "delete"): Promise<ActionState> {
  const label = kind === "proforma" ? "Proforma" : "Packing list";
  return done(
    orderId,
    await attempt(
      null,
      () => (op === "delete" ? api.delete(`/orders/${orderId}/documents/${kind}/draft`) : api.post(`/orders/${orderId}/documents/${kind}/${op}`)),
      op === "again" ? `${label}: next version started as a draft.` : op === "final" ? `${label} made final.` : "Draft deleted.",
    ),
  );
}
