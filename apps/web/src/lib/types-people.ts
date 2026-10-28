import type { CustomerType, InquiryStage, OrderStatus, Permission, Role, SignInResult } from "@kebo/shared";
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
  }[];
  orders: { id: string; refNo: string; status: OrderStatus; total: string; currency: string; orderedOn: string }[];
}

export interface Factory {
  id: string;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  wechat: string | null;
  email: string | null;
  address: string | null;
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

export interface FactoryDetail extends Factory {
  quotes: {
    id: string;
    receivedOn: string;
    currency: string;
    inquiry: { id: string; refNo: string; title: string };
    _count: { lines: number };
  }[];
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
