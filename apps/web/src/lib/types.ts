import type { BalanceTerms, Incoterm, InquiryChannel, InquiryStage, LostReason, OrderPlan, OrderStage, OrderStatus, Priority, RevisionStatus } from "@kebo/shared";

/** The API's response shapes the screens use (the API is the source of truth; keep these in step with it). */

export interface Person {
  id: string;
  name: string;
}

export interface OrderView {
  id: string;
  refNo: string;
  status: OrderStatus;
  stage: OrderStage;
  inquiry: { id: string; refNo: string; title: string; assigneeId: string | null; assignee: Person | null };
  customer: { id: string; name: string; country: string };
  orderedOn: string;
  shipBy: string | null;
  readyOn: string | null;
  currency: string;
  total: string;
  depositPercent: number;
  balanceTerms: BalanceTerms;
  incoterm: Incoterm;
  incotermPlace: string | null;
  customerPayments: { dueMinor: number; settledMinor: number; outstandingMinor: number; depositOutstandingMinor: number; status: string };
  plan: OrderPlan;
}

export interface OrderRow {
  id: string;
  refNo: string;
  customer: { id: string; name: string; country: string };
  inquiry: { id: string; refNo: string; title: string; assignee: Person | null };
  stage: OrderStage;
  next: { key: string; title: string; due: string | null; overdue: boolean; blockedBy: { message: string } | null } | null;
  progress: { done: number; total: number };
  overdue: number;
}

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
  customer: { id: string; name: string; country: string; contacts: { id: string; name: string; email: string | null; phone: string | null; whatsapp: string | null; isPrimary: boolean }[] };
  contact: { id: string; name: string } | null;
  assignee: Person | null;
  createdBy: Person;
  createdAt: string;
  closedAt: string | null;
  items: { id: string; description: string; model: string | null; quantity: string; unit: string; targetPrice: string | null }[];
  notes: { id: string; body: string; authorId: string; createdAt: string }[];
  attachments: { id: string; fileName: string; size: number; mimeType: string; uploadedById: string; createdAt: string; milestoneId: string | null }[];
  stageChanges: { id: string; fromStage: InquiryStage | null; toStage: InquiryStage; cause: string; note: string | null; lostReason: LostReason | null; changedById: string | null; changedAt: string }[];
  assignments: { id: string; assigneeId: string | null; assignedById: string; assignedAt: string }[];
  quotation: { id: string; refNo: string; revisions: { id: string; number: number; status: RevisionStatus; total: string; currency: string; validUntil: string; sentOn: string | null }[] } | null;
  orders: { id: string; refNo: string; status: OrderStatus; orderedOn: string; total: string; currency: string }[];
  people: Record<string, string>;
  canWork: boolean;
  allowed: { edit: boolean; quote: boolean; source: boolean; assign: boolean; hold: boolean; reopen: boolean };
}
