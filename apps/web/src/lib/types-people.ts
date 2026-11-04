import type { CustomerType, InquiryStage, OrderStage, OrderStatus, Permission, Role, SignInResult } from "@kebo/shared";
import type { Person } from "./types";

/** API response shapes for customers, factories, people and administration (keep in step with apps/api). */

export interface Contact {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  wechat: string | null;
  isPrimary: boolean;
}

export interface CustomerRow {
  id: string;
  name: string;
  type: CustomerType;
  country: string;
  primaryContact: Contact | null;
  openDeals: number;
  openOrders: number;
}

export interface CustomerDetail {
  id: string;
  type: CustomerType;
  name: string;
  country: string;
  address: string | null;
  taxNo: string | null;
  regNo: string | null;
  /** Letters on documents (proforma numbers); null: from the name. */
  initials: string | null;
  defaultCurrency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  contacts: Contact[];
  inquiries: {
    id: string;
    refNo: string;
    title: string;
    stage: InquiryStage;
    onHold: boolean;
    createdAt: string;
    assignee: Person | null;
    /** Quotation revisions sent to them, newest first. */
    sent: { number: number; sentOn: string; by: Person }[];
  }[];
  orders: {
    id: string;
    refNo: string;
    status: OrderStatus;
    stage: OrderStage;
    total: string;
    currency: string;
    orderedOn: string;
    /** The latest of its factories' ready dates. */
    readyOn: string | null;
  }[];
}

export interface Factory {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  wechat: string | null;
  email: string | null;
  address: string | null;
  bankBeneficiary: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankSwift: string | null;
  /** Other bank details (free text, from before the fields above). */
  bankDetails: string | null;
  notes: string | null;
  /** The person in our team who looks after this factory. */
  ownerId: string | null;
  owner: { id: string; name: string } | null;
  createdAt: string;
}

export interface FactoryRow extends Factory {
  _count: { quotes: number };
}

export interface FactoryContact {
  id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  isPrimary: boolean;
}

/** GET /factories/:id/purchases: its purchase orders with paid and balance due, payments made, readiness. */
export interface FactoryPurchases {
  today: string;
  mainCurrency: string;
  orders: {
    id: string;
    refNo: string;
    customer: { id: string; name: string };
    stage: OrderStage;
    status: OrderStatus;
    orderedOn: string;
    production: "on_track" | "overdue_step" | "ready" | "delivered" | "cancelled";
    readyOn: string | null;
    readyActual: string | null;
    onTime: boolean | null;
    daysLate: number | null;
    currency: string | null;
    total: string | null;
    paid: string | null;
    balanceDue: string | null;
    mainCurrency: string;
    totalMain: string;
    paidMain: string;
    balanceDueMain: string;
    lateSteps: { title: string; dueOn: string | null }[];
    open: { label: string; due: string | null; open: string; currency: string; status: string }[];
  }[];
  payments: {
    id: string;
    order: { id: string; refNo: string };
    kind: string;
    amount: string;
    currency: string;
    paidOn: string;
    method: string;
    reference: string | null;
    voided: boolean;
    hasFile: boolean;
  }[];
  readiness: { onTime: number; known: number; avgDaysLate: number | null };
  totals: { currency: string; orders: number; total: string; paid: string; balanceDue: string }[];
  waiting: { id: string; inquiry: { id: string; refNo: string; title: string }; sentOn: string; replyBy: string | null }[];
}

export interface FactoryDetail extends Factory {
  contacts: FactoryContact[];
  quotes: {
    id: string;
    receivedOn: string;
    currency: string;
    inquiry: { id: string; refNo: string; title: string };
    _count: { lines: number };
  }[];
  /** How it works with us: answers when asked for a price, and what it is making now. */
  record: {
    asked: number;
    answered: number;
    declined: number;
    noReply: number;
    avgDaysToAnswer: number | null;
    openOrders: { id: string; refNo: string; customer: string; readyOn: string | null }[];
    lateSteps: number;
  };
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  access: { name: string; superAdmin: boolean; requireTwoStep: boolean };
  isActive: boolean;
  lastLoginAt: string | null;
  totpEnabledAt: string | null;
  createdAt: string;
}

export interface TwoStepStatus {
  on: boolean;
  since: string | null;
  recoveryCodesLeft: number;
  /** Their role needs it: it cannot be turned off. */
  required: boolean;
  roleName: string;
}

/* ---------------------------------------------------------------- security */

/** GET /roles */
export interface RoleRow {
  key: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  superAdmin: boolean;
  /** Admin, Manager, Staff: cannot be removed. */
  preset: boolean;
  /** Made by the company, while its plan leaves out custom roles: its people keep working, but it cannot be changed or given. */
  frozen: boolean;
  /** Saved in the role but not in the company's plan: nobody has them until the plan includes them again. */
  notInPlan: Permission[];
  requireTwoStep: boolean;
  /** Active people in it, and how many of them have no two-step sign-in. */
  people: number;
  withoutTwoStep: number;
  /** The signed-in person may give this role (it allows nothing more than theirs). */
  givable: boolean;
}

/** GET /roles/:key */
export interface RoleDetail extends RoleRow {
  members: { id: string; name: string; email: string; isActive: boolean; totpEnabledAt: string | null; lastLoginAt: string | null }[];
}

/** GET /security/overview */
export interface SecurityOverview {
  liveSessions: number;
  people: number;
  withTwoStep: number;
  failedLastDay: number;
  blockedIpsLastDay: number;
  mustSetUp: { id: string; name: string; role: string }[];
}

/** A signed-in browser or phone (GET /security/sessions, GET /me/sessions). */
export interface SessionRow {
  id: string;
  user: { id: string; name: string; email: string };
  device: string;
  userAgent: string | null;
  ip: string | null;
  signedInAt: string;
  lastSeenAt: string;
  expiresAt: string;
  waitingForCode: boolean;
  current: boolean;
}

/** One sign-in attempt (GET /security/sign-ins, GET /me/sign-ins). */
export interface SignInRow {
  id: string;
  at: string;
  email: string;
  user: { id: string; name: string } | null;
  result: SignInResult;
  detail: string | null;
  ip: string;
  device: string;
}

export interface AuditRow {
  id: string;
  userId: string | null;
  userName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
