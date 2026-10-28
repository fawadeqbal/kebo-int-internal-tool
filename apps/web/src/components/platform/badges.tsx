import { BILLING_LABEL, COMPANY_KIND_LABEL, COMPANY_STATUS_LABEL, LEAD_STATUS_LABEL } from "@kebo/shared";
import { Badge } from "@kebo/ui";
import type { Billing, CompanyKind, CompanyStatus, LeadStatus } from "@/lib/types-platform";

const STATUS_TONE = { active: "ok", read_only: "warn", off: "bad", deleted: "neutral" } as const;
const LEAD_TONE = { new: "info", contacted: "neutral", demo: "primary", client: "ok", lost: "bad" } as const;
const BILLING_TONE = { trial: "info", active: "ok", overdue: "warn", off: "bad" } as const;

export const CompanyStatusBadge = ({ status }: { status: CompanyStatus }) => (
  <Badge tone={STATUS_TONE[status]} dot>
    {COMPANY_STATUS_LABEL[status]}
  </Badge>
);
export const KindBadge = ({ kind }: { kind: CompanyKind }) => (
  <Badge tone={kind === "client" ? "neutral" : "info"}>{COMPANY_KIND_LABEL[kind]}</Badge>
);
export const LeadStatusBadge = ({ status }: { status: LeadStatus }) => <Badge tone={LEAD_TONE[status]}>{LEAD_STATUS_LABEL[status]}</Badge>;
export const BillingBadge = ({ billing }: { billing: Billing }) => <Badge tone={BILLING_TONE[billing]}>{BILLING_LABEL[billing]}</Badge>;
