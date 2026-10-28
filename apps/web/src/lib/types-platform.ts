/** What the platform API returns (see apps/api/src/platform). */
export type CompanyKind = "client" | "demo" | "trial";
export type CompanyStatus = "active" | "read_only" | "off" | "deleted";
export type Billing = "trial" | "active" | "overdue" | "off";
export type LeadStatus = "new" | "contacted" | "demo" | "client" | "lost";

export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
  twoStepOn: boolean;
}

export interface PlanRef {
  id: string;
  name: string;
  maxUsers: number | null;
  maxStorageMb: number | null;
}

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  kind: CompanyKind;
  status: CompanyStatus;
  statusReason: string | null;
  statusManual: boolean;
  plan: PlanRef | null;
  startsOn: string | null;
  renewsOn: string | null;
  endsAt: string | null;
  billing: Billing;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  deletedAt: string | null;
  previousSlug: string | null;
  usage: { users: number; inquiries?: number; storageMb: number } | null;
}

export interface LogEntry {
  id: string;
  adminName: string | null;
  action: string;
  companyId: string | null;
  leadId: string | null;
  summary: string;
  at: string;
}

export interface CompanyDetail extends CompanyRow {
  warnings: string[];
  activity: {
    signInsLast30Days: number;
    lastSignIn: { at: string; email: string } | null;
    inquiries: number;
    inquiriesLast30Days: number;
    orders: number;
    people: { id: string; name: string; email: string; active: boolean; lastLoginAt: string | null; role: string; tenantAdmin: boolean }[];
  } | null;
  payments: {
    id: string;
    amountMinor: number;
    currency: string;
    paidOn: string;
    paidUntil: string;
    note: string | null;
    createdAt: string;
  }[];
  log: LogEntry[];
  leads: { id: string; name: string; companyName: string; status: LeadStatus }[];
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  period: string;
  maxUsers: number | null;
  maxStorageMb: number | null;
  features: string[];
  isActive: boolean;
  companies: number;
}

export interface LeadRow {
  id: string;
  companyName: string;
  name: string;
  email: string;
  phone: string | null;
  country: string | null;
  teamSize: string | null;
  message: string | null;
  source: "form" | "sign_up" | "manual";
  status: LeadStatus;
  lostReason: string | null;
  followUpOn: string | null;
  company: { id: string; slug: string; name: string; kind: CompanyKind; status: CompanyStatus; endsAt: string | null } | null;
  notes: number;
  createdAt: string;
}

export interface LeadDetail extends Omit<LeadRow, "notes"> {
  notes: { id: string; text: string; byName: string | null; createdAt: string }[];
  log: LogEntry[];
}

export interface Overview {
  counts: { kind: CompanyKind; status: CompanyStatus; count: number }[];
  newLeads: number;
  followUps: { id: string; name: string; companyName: string; status: LeadStatus; followUpOn: string }[];
  ending: { id: string; name: string; slug: string; kind: CompanyKind; status: CompanyStatus; endsAt: string }[];
  renewals: { id: string; name: string; slug: string; status: CompanyStatus; renewsOn: string }[];
  recent: LogEntry[];
}
