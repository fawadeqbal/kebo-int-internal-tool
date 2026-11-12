import type { BuyerSnapshot, FlowStep, OrderDocumentKind, PaperCheck, PaperDoc, PaperFixField, PaperKind, PaperOption, PaperState } from "@kebo/shared";

/** One paper of GET /orders/:id/papers (keep in step with apps/api/src/modules/papers). */
export interface PaperRow {
  key: string;
  /** A paper the app makes, the order's "proforma" / "packing-list", or a document-set kind others issue. */
  kind: string;
  source: "app" | "upload";
  label: string;
  step: FlowStep;
  state: PaperState;
  stateLabel: string;
  number: string | null;
  version: number | null;
  /** The latest made version (draft or final): Delete the draft, Versions. */
  paperId?: string | null;
  /** The latest version is a draft. */
  draft?: boolean;
  sub: string;
  ref: string | null;
  printable: boolean;
  makeable: boolean;
  live: boolean;
  /** Kept as sent (a payment request, a receipt): no draft and no Make page; `version` is the copy kept. */
  kept?: boolean;
  inSet: boolean;
  doc: { id: string; status: string; keptWhere: string | null; file: { id: string; name: string } | null; issuedOn: string | null } | null;
  docKind: OrderDocumentKind | null;
}

/** GET /orders/:id/papers */
export interface OrderPapers {
  orderId: string;
  refNo: string;
  canMake: boolean;
  /** Upload and "kept elsewhere" (the document set's module and documents.manage). */
  canRecord: boolean;
  papers: PaperRow[];
}

export interface PaperVersion {
  id: string;
  version: number;
  status: "draft" | "final";
  number: string;
  madeAt: string;
  finalAt: string | null;
}

/** GET /orders/:id/papers/:kind/checks — the Make page. */
export interface PaperChecks {
  orderId: string;
  refNo: string;
  kind: PaperKind;
  label: string;
  step: FlowStep;
  madeFrom: string;
  number: string;
  ref: string | null;
  factories: { id: string; name: string }[] | null;
  live: boolean;
  canMake: boolean;
  state: PaperState;
  ready: boolean;
  checks: PaperCheck[];
  hsLines: { id: string; description: string }[];
  fixes: Partial<Record<string, { label: string; type: "text" | "date"; saves: string }>>;
  options: { key: PaperOption; label: string; on: boolean }[];
  paper: PaperVersion | null;
  versions: PaperVersion[];
  /** The buyer the paper prints (as on the order) and what differs from the customer now; null: a paper to a factory. */
  buyer: { buyer: BuyerSnapshot; changes: string[] } | null;
  /** "Refresh from customer" (with a reason). */
  canRefreshBuyer: boolean;
  /** The quotation's payment text against the route, when they differ: printed too, or not (the default). */
  terms: { quoted: string; route: string; printed: boolean } | null;
}

/** GET /orders/:id/papers/:kind/doc */
export interface PaperDocView {
  orderId: string;
  refNo: string;
  label: string;
  live: boolean;
  /** Kept as sent: `final` is the copy that was sent; not final: how it would print now. */
  kept?: boolean;
  final: boolean;
  watermark: string | null;
  paper: PaperVersion | null;
  versions: PaperVersion[];
  doc: PaperDoc;
}

export type { PaperFixField };
