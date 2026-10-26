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
  requiredBy: string | null;
  overdue: boolean;
  customer: { id: string; name: string; country: string };
  assignee: Person | null;
  items: number;
  quotation: { refNo: string; latest: { number: number; status: RevisionStatus; total: string; currency: string } | null } | null;
  order: { id: string; refNo: string; status: OrderStatus } | null;
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
  quotation: {
    id: string;
    refNo: string;
    revisions: {
      id: string;
      number: number;
      status: RevisionStatus;
      total: string;
      currency: string;
      validUntil: string;
      sentOn: string | null;
    }[];
  } | null;
  orders: { id: string; refNo: string; status: OrderStatus; orderedOn: string; total: string; currency: string }[];
  people: Record<string, string>;
  canWork: boolean;
  allowed: { edit: boolean; quote: boolean; source: boolean; assign: boolean; hold: boolean; reopen: boolean };
}
