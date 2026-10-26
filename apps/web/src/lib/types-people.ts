import type { CustomerType, InquiryStage, OrderStatus, Role } from "@kebo/shared";
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
  isActive: boolean;
  lastLoginAt: string | null;
  totpEnabledAt: string | null;
  createdAt: string;
}

export interface TwoStepStatus {
  on: boolean;
  since: string | null;
  recoveryCodesLeft: number;
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
