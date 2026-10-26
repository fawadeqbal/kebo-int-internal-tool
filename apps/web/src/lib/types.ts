import type { InquiryChannel, InquiryStage, LostReason, OrderStatus, Priority, RevisionStatus } from "@kebo/shared";

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
  items: { id: string; description: string; model: string | null; quantity: string; unit: string; targetPrice: string | null }[];
  notes: { id: string; body: string; authorId: string; createdAt: string }[];
  attachments: { id: string; fileName: string; size: number; mimeType: string; uploadedById: string; createdAt: string }[];
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
