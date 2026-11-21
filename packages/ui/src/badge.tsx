import type { ComponentProps, ReactNode } from "react";
import {
  INQUIRY,
  inquiryStateOf,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  REVISION_STATUS_LABEL,
  REVISION_STATUS_TONE,
  type InquiryStage,
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

/** Colour is never the only signal: every badge carries its words. `sm`: the small pill inside a line of text. */
export function Badge({
  tone = "neutral",
  dot,
  size = "md",
  children,
  className,
  ...props
}: { tone?: keyof typeof TONES; dot?: boolean; size?: "md" | "sm"; children: ReactNode; className?: string } & Omit<ComponentProps<"span">, "children" | "className">) {
  return (
    <span
      data-badge=""
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold whitespace-nowrap [&_svg]:size-3",
        size === "sm" ? "h-5 px-2 align-middle text-2xs" : "h-6 px-2.5 text-xs",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/** The five things a status can mean, and nothing else (design system, principle 6). */
export type StatusMeaning = Tone;

/** Any tone used in the app, as one of the five meanings ("primary": moving → info; "outline": neutral). */
export function meaningOf(tone: keyof typeof TONES): StatusMeaning {
  return tone === "primary" ? "info" : tone === "outline" ? "neutral" : tone;
}

/**
 * A status: its word and a dot, in the colour of what it means — neutral (Draft,
 * not started), info (Sent, In progress), ok (Done, Paid), warn (Due soon,
 * Check), bad (Late, Failed). The word is always there; the colour only repeats it.
 */
export function StatusBadge({ meaning, children, className }: { meaning: StatusMeaning; children: ReactNode; className?: string }) {
  return (
    <Badge tone={meaning} dot className={className}>
      {children}
    </Badge>
  );
}

/** An inquiry's stage, as every list shows it (the inquiry record type): On hold in place of an open stage. */
export const StageBadge = ({ stage, onHold }: { stage: InquiryStage; onHold?: boolean }) => {
  const s = INQUIRY.states[inquiryStateOf({ stage, onHold: !!onHold })];
  return <Badge tone={s.tone}>{s.words}</Badge>;
};

export const RevisionBadge = ({ status }: { status: RevisionStatus }) => (
  <Badge tone={REVISION_STATUS_TONE[status]} dot>
    {status === "superseded" ? "Replaced" : REVISION_STATUS_LABEL[status]}
  </Badge>
);


export const PriorityBadge = ({ priority }: { priority: Priority }) =>
  priority === "normal" ? null : <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
