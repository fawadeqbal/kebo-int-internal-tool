import type { AttachmentKind, FlowStep, OrderFileGroup, OrderFileLink, OrderFileSource } from "@kebo/shared";

/** One file of GET /orders/:id/files (keep in step with apps/api/src/modules/files). */
export interface OrderFile {
  /** "attachment:<uuid>", "payment:<uuid>", "factory_payment:<uuid>", "expense:<uuid>". */
  id: string;
  source: OrderFileSource;
  sourceId: string;
  name: string;
  size: number;
  type: string;
  kind: AttachmentKind | null;
  kindLabel: string | null;
  note: string | null;
  attachedTo: { link: OrderFileLink; label: string; href: string };
  step: FlowStep | null;
  stepLabel: string;
  group: OrderFileGroup;
  by: { id: string; name: string } | null;
  at: string;
  href: string;
  viewHref: string | null;
  version: number;
  versions: { id: string; name: string; version: number; at: string; href: string }[];
  can: { rename: boolean; describe: boolean; attach: boolean; replace: boolean; remove: boolean };
}

export interface AttachTarget {
  to: "paper" | "checklist" | "step";
  target: string;
  label: string;
  step: FlowStep;
}

/** GET /orders/:id/files */
export interface OrderFiles {
  orderId: string;
  refNo: string;
  dealId: string;
  canUpload: boolean;
  groups: { key: OrderFileGroup; label: string; count: number }[];
  files: OrderFile[];
  targets: AttachTarget[];
}
