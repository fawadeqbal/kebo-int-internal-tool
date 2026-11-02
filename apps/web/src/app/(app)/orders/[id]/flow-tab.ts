import type { FlowStep } from "@kebo/shared";

/** The tab each step of the order flow is worked on. */
export const FLOW_TAB: Record<FlowStep, string> = {
  payment: "/money",
  factory: "/factory",
  production: "/factory",
  shipping: "/shipping",
  documents: "/documents",
  delivery: "/delivery",
};
