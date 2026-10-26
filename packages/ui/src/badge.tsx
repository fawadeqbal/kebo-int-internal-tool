import type { ReactNode } from "react";
import {
  INQUIRY_STAGE_LABEL,
  INQUIRY_STAGE_TONE,
  ORDER_STAGE_LABEL,
  ORDER_STAGE_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  REVISION_STATUS_LABEL,
  REVISION_STATUS_TONE,
  type InquiryStage,
  type OrderStage,
  type Priority,
  type RevisionStatus,
  type Tone,
} from "@kebo/shared";
import { cn } from "./cn";

/** Meaning (from @kebo/shared) → palette (from theme.css). */
const TONES: Record<Tone | "primary" | "outline", string> = {
  neutral: "bg-surface-3 text-text-2",
  info: "bg-info-soft text-info",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  primary: "bg-primary-soft text-primary",
  outline: "border border-line text-text-2",
};

/** Colour is never the only signal: every badge carries its words. */
export function Badge({ tone = "neutral", dot, children, className }: { tone?: keyof typeof TONES; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-5.5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3", TONES[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export const StageBadge = ({ stage, onHold }: { stage: InquiryStage; onHold?: boolean }) => (
  <span className="inline-flex items-center gap-1">
    <Badge tone={INQUIRY_STAGE_TONE[stage]} dot>
      {INQUIRY_STAGE_LABEL[stage]}
    </Badge>
    {onHold && <Badge tone="outline">On hold</Badge>}
  </span>
);

export const RevisionBadge = ({ status }: { status: RevisionStatus }) => (
  <Badge tone={REVISION_STATUS_TONE[status]} dot>
    {status === "superseded" ? "Replaced" : REVISION_STATUS_LABEL[status]}
  </Badge>
);

export const OrderStageBadge = ({ stage }: { stage: OrderStage }) => (
  <Badge tone={ORDER_STAGE_TONE[stage]} dot>
    {ORDER_STAGE_LABEL[stage]}
  </Badge>
);

export const PriorityBadge = ({ priority }: { priority: Priority }) =>
  priority === "normal" ? null : <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
