import type { FlowStep, Tone } from "@kebo/shared";

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
}
