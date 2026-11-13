import type { FatResult, FlowStep, RequestChannel, Tone } from "@kebo/shared";

/** One stage's line on the Overview (keep in step with @kebo/shared stageStands). */
export interface StageStandView {
  stage: FlowStep;
  label: string;
  word: string;
  tone: Tone;
  tab: string;
  fact: string;
  missing: string;
}

/** GET /orders/:id/sections */
export interface OrderSectionsView {
  orderId: string;
  status: string;
  /** The stages the company uses, in the tabs' order. */
  stages: FlowStep[];
  stands: StageStandView[];
  /** The small word beside each stage's tab. */
  tabs: Record<string, string>;
  /** Production, per factory of the order (one row, factory null, when the lines name none). */
  production: FactoryProduction[];
}

export interface FactoryProduction {
  factory: { id: string; name: string } | null;
  readyOn: string | null;
  readyToldOn: string | null;
  readyToldVia: RequestChannel | null;
  readyNote: string | null;
  fat: { plannedOn: string | null; attendedBy: { id: string; name: string } | null; doneOn: string | null; result: FatResult | null; remarks: string | null };
  goodsReceivedAt: string | null;
}
