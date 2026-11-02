import type { ChecklistField, ChecklistTool, FlowStep, PaperKind, PaymentRoute, StepState } from "@kebo/shared";

/** One item of GET /orders/:id/steps (keep in step with apps/api/src/modules/checklist). */
export interface ChecklistItem {
  /** The stored row (an own item, or an automatic item's overrides); null: an automatic item with none. */
  id: string | null;
  /** The automatic item's key; null for own items. */
  key: string | null;
  auto: boolean;
  step: FlowStep;
  title: string;
  tool: ChecklistTool | null;
  /** Make and Send items: the paper the app makes. */
  paper: PaperKind | null;
  fields: ChecklistField[];
  values: Record<string, string>;
  /** label / value pairs; a YYYY-MM-DD value is a date. */
  data: [string, string][];
  needs: string | null;
  done: boolean;
  doneOn: string | null;
  doneBy: { id: string; name: string } | null;
  skipped: boolean;
  skipReason: string | null;
  dueOn: string | null;
  late: boolean;
  assignee: { id: string; name: string } | null;
  note: string | null;
  file: { id: string; name: string } | null;
  route: PaymentRoute | null;
  sort: number;
}

export interface StepView {
  key: FlowStep;
  number: number;
  label: string;
  state: StepState;
  stateLabel: string;
  done: number;
  total: number;
  line: string;
  next: { title: string; dueOn: string | null; late: boolean } | null;
}

/** GET /orders/:id/steps */
export interface OrderSteps {
  orderId: string;
  refNo: string;
  canEdit: boolean;
  steps: StepView[];
  doNow: {
    step: FlowStep;
    label: string;
    id: string | null;
    key: string | null;
    title: string;
    needs: string | null;
    dueOn: string | null;
    late: boolean;
  } | null;
  items: ChecklistItem[];
}

/** GET /settings/checklist */
export interface ChecklistSettings {
  saved: boolean;
  hidden: string[];
  items: {
    step: FlowStep;
    title: string;
    tool: ChecklistTool;
    fields: ChecklistField[];
    paper: PaperKind | null;
    route: PaymentRoute | null;
    dueDays: number | null;
  }[];
  auto: { step: FlowStep; items: { key: string; title: string; hidden: boolean }[] }[];
}
