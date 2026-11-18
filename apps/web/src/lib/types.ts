import type { AttachmentKind, InquiryChannel, InquiryStage, LostReason, OrderStatus, Priority, RevisionStatus } from "@kebo/shared";

/** The API's response shapes the screens use (the API is the source of truth; keep these in step with it). */

export interface Person {
  id: string;
  name: string;
}

/** Orders, their payments and documents: see ./types-orders.ts. */

export interface DealRow {
  id: string;
  refNo: string;
  title: string;
  category: string;
  channel: InquiryChannel;
  priority: Priority;
  stage: InquiryStage;
  onHold: boolean;
  /** Why it was lost (lost ones). */
  lostReason?: LostReason | null;
  requiredBy: string | null;
  overdue: boolean;
  customer: { id: string; name: string; country: string };
  assignee: Person | null;
  items: number;
  /** Factories asked for prices, and the offers in. */
  asked?: number;
  offers?: number;
  /** The quotation that speaks for the deal (accepted, else the lowest still waiting…; while all are drafts, A). */
  quotation: {
    refNo: string;
    /** `total` is the accepted option's, else the lowest option's; `totalUpTo` the highest when the options differ. */
    latest: { number: number; status: RevisionStatus; total: string; totalUpTo: string | null; totalOf: string; currency: string; sentOn: string | null } | null;
  } | null;
  /** How many quotations the deal has (A, B, C…). */
  quotations?: number;
  order: { id: string; refNo: string; status: OrderStatus } | null;
  /** The next follow-up still to do: its day, and whether that is today or already past (the company's day). */
  nextFollowUp: { dueOn: string; dueAt: string | null; title: string; today: boolean; late: boolean } | null;
  createdAt: string;
}

/** An item the customer asked for; a part (parentId) is numbered under its item ("2.1"). */
export interface DealItem {
  id: string;
  /** "1", "2", "2.1" */
  no: string;
  parentId: string | null;
  description: string;
  model: string | null;
  quantity: string;
  unit: string;
  targetPrice: string | null;
  /** A factory has priced it: changing or removing it asks why. */
  priced: boolean;
}

/** A file in the deal's URS & documents. */
export interface DealFile {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  kind: AttachmentKind;
  note: string | null;
  uploadedById: string;
  createdAt: string;
}

/** GET /history: who changed what, when, and why (newest first). */
export interface HistoryEntry {
  id: string;
  at: string;
  by: Person | null;
  action: string;
  entityType: string;
  summary: string | null;
  reason: string | null;
  changes: { field: string; from: string | null; to: string | null }[];
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  rows: T[];
}

export interface DealDetail {
  id: string;
  refNo: string;
  /** When it last changed: sent back with a save, so one over someone else's change is refused. */
  updatedAt: string;
  title: string;
  category: string;
  channel: InquiryChannel;
  priority: Priority;
  stage: InquiryStage;
  onHold: boolean;
  lostReason: LostReason | null;
  lostNote: string | null;
  requirements: string | null;
  requiredBy: string | null;
  customerId: string;
  contactId: string | null;
  customer: {
    id: string;
    name: string;
    country: string;
    contacts: { id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null; isPrimary: boolean }[];
  };
  contact: { id: string; name: string } | null;
  assignee: Person | null;
  createdBy: Person;
  createdAt: string;
  closedAt: string | null;
  /** In order, parts right after their item. */
  items: DealItem[];
  notes: { id: string; body: string; authorId: string; createdAt: string }[];
  attachments: DealFile[];
  stageChanges: {
    id: string;
    fromStage: InquiryStage | null;
    toStage: InquiryStage;
    cause: string;
    note: string | null;
    lostReason: LostReason | null;
    changedById: string | null;
    changedAt: string;
  }[];
  assignments: { id: string; assigneeId: string | null; assignedById: string; assignedAt: string }[];
  /** The quotation that speaks for the deal (accepted, else the lowest still waiting…; while all are drafts, A). */
  quotation: DealQuotation | null;
  /** Every quotation, A, B, C…, each with its revisions (newest first). */
  quotations: DealQuotation[];
  orders: { id: string; refNo: string; status: OrderStatus; orderedOn: string; total: string; currency: string; customerRef?: string | null }[];
  people: Record<string, string>;
  canWork: boolean;
  allowed: { edit: boolean; quote: boolean; source: boolean; assign: boolean; hold: boolean; reopen: boolean };
}

/** One of a deal's quotations (QUO-2026-0531-B) with its revisions, newest first. */
export interface DealQuotation {
  id: string;
  refNo: string;
  /** A, B … Z, AA (an older inquiry's first quotation is A, its number without the letter). */
  letter: string;
  revisions: {
    id: string;
    number: number;
    status: RevisionStatus;
    /** The accepted option's total, else the lowest option's; `totalUpTo` the highest when the options differ. */
    total: string;
    totalUpTo: string | null;
    totalOf: string;
    currency: string;
    validUntil: string;
    sentOn: string | null;
  }[];
}
