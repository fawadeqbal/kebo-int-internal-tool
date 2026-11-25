import { isPaperKind, paperDone, type FlowStep } from "@kebo/shared";
import type { DocState } from "@/components/window/doc-window";
import { UUID } from "./ids";
import type { PaperRow } from "./types-papers";

/**
 * Where an order's documents open (one window, 26 Nov 2026): /orders/:id/papers/:kind. Every document of the
 * order has its window there, whatever it is: a paper the app makes (with ?ref= for the payment or the supplier
 * it is for), the proforma and the packing list, the quotation, and the papers others issue (the bill of lading,
 * a certificate: ?doc= the one recorded, when there are several of a kind).
 */
export function orderWindowHref(
  orderId: string,
  kind: string,
  q: { ref?: string | null; doc?: string | null; v?: string | null; copy?: string | null; lang?: string | null; back?: string | null } = {},
) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) s.set(k, v);
  return `/orders/${orderId}/papers/${kind}${s.size ? `?${s}` : ""}`;
}

/** The order's own documents (not PaperKind) that print at /print/orders/:id/:kind. */
const OWN = ["proforma", "packing-list"];

/**
 * A link to an order's paper as printed (/print/orders/:id/:kind?…) as the order's window for it, coming back to
 * `back`; null when it is not one (a quotation, a ledger's paper, a payment's receipt open in the viewer).
 */
export function orderWindowOfPrint(href: string, back: string): string | null {
  const url = new URL(href, "http://x");
  const m = /^\/print\/orders\/([^/]+)\/([\w-]+)$/.exec(url.pathname);
  if (!m || !UUID.test(m[1]!) || !(isPaperKind(m[2]!) || OWN.includes(m[2]!))) return null;
  const q = url.searchParams;
  return orderWindowHref(m[1]!, m[2]!, { ref: q.get("ref"), v: q.get("v"), copy: q.get("copy"), lang: q.get("lang"), back });
}

/** Where one of the order's documents stands, as the window's badge and the strip's mark draw it. */
export function docStateOf(r: Pick<PaperRow, "state" | "source" | "live" | "draft">): DocState {
  if (r.live) return "live";
  if (r.source === "upload") return r.state === "up" ? "file" : r.state === "miss" ? "needed" : paperDone(r.state) ? "final" : "todo";
  if (r.draft || r.state === "draft") return "draft";
  return paperDone(r.state) ? "final" : "todo";
}

/** The window of one of the order's rows (Documents, the strip), coming back to `back`. */
export const rowWindowHref = (orderId: string, r: Pick<PaperRow, "kind" | "ref" | "source" | "doc">, back: string) =>
  orderWindowHref(orderId, r.kind, { ref: r.ref, doc: r.source === "upload" && r.doc ? r.doc.id : null, back });

/** The order's documents in the order of its steps (as Documents groups them): the strip goes through them so. */
const STEP_ORDER: FlowStep[] = ["payment", "factory", "production", "shipping", "documents", "delivery"];
export const byStep = <T extends { step: FlowStep }>(rows: T[]): T[] =>
  rows.map((r, i) => ({ r, i })).sort((a, b) => STEP_ORDER.indexOf(a.r.step) - STEP_ORDER.indexOf(b.r.step) || a.i - b.i).map((x) => x.r);
