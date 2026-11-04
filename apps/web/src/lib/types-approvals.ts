/** Money received or an expense sent for a manager to approve (GET /submissions). */
export interface Submission {
  id: string;
  kind: "payment" | "expense";
  status: SubmissionStatus;
  order: { id: string; refNo: string; customer: string } | null;
  customer: { id: string; name: string } | null;
  deal: { id: string; refNo: string } | null;
  amount: string | null;
  currency: string | null;
  paidOn: string | null;
  spentOn: string | null;
  method: string | null;
  reference: string | null;
  category: string | null;
  description: string | null;
  body: Record<string, unknown>;
  submittedBy: { id: string; name: string };
  submittedAt: string;
  hasFile: boolean;
  file: { name: string; type: string; size: number } | null;
  reason: string | null;
  decidedBy: { id: string; name: string } | null;
  decidedAt: string | null;
  createdId: string | null;
  can: { approve: boolean; sendBack: boolean; edit: boolean; withdraw: boolean; changeFile: boolean };
}

export type SubmissionStatus = "pending" | "approved" | "sent_back" | "withdrawn";

export interface SubmissionList {
  rows: Submission[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<SubmissionStatus | "all", number>;
  approves: ("payment" | "expense")[];
  canSubmit: boolean;
}
