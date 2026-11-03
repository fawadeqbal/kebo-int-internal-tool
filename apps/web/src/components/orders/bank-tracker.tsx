"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Alert, Button, Card, CardHeader, cn } from "@kebo/ui";
import type { ActionState } from "@/lib/actions";
import { LightForm, sendTo, TapButton, type LightChip, type LightField, type LightTap } from "./light-form";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export interface BankStepLine {
  step: string;
  label: string;
  /** Done: its date (shown as "12 Jan"). */
  done: string | null;
  /** Under the name: the bank, the tracking number, "starts the 90 days", "records the payment". */
  sub: string | null;
}

/** The current step's button: one tap, a small form (the courier's tracking no.), or a form that opens itself (record the payment). */
export type BankStepTool =
  | { kind: "tap"; tap: LightTap }
  | { kind: "light"; label: string; action: Action; fields: LightField[]; chips?: LightChip[] }
  | { kind: "node"; node: ReactNode };

/**
 * Documents › Through the banks: the route's bank steps, each once, as a
 * tracker; only today's step (the first not done) has its button, done steps
 * show their date. On a phone: a list of the current step and the next, and
 * "+ n more".
 */
export function BankTracker({
  title,
  description,
  steps,
  tool,
  dealId,
}: {
  title: string;
  description: string;
  steps: BankStepLine[];
  tool: BankStepTool | null;
  dealId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const at = steps.findIndex((s) => !s.done);
  const button = (primary: boolean) =>
    !tool ? null : tool.kind === "tap" ? (
      <TapButton tap={tool.tap} primary={primary} onError={setError} />
    ) : tool.kind === "node" ? (
      tool.node
    ) : (
      <Button size="xs" variant={primary ? "primary" : "secondary"} onClick={() => setForm(true)}>
        {tool.label}
      </Button>
    );
  const lightForm =
    form && tool?.kind === "light" ? (
      <div className="rounded-lg border border-line bg-surface p-3">
        <LightForm
          fields={tool.fields}
          chips={tool.chips}
          dealId={dealId}
          fileNote={steps[at]?.label ?? ""}
          onSubmit={sendTo(tool.action)}
          onDone={() => setForm(false)}
        />
      </div>
    ) : null;
  const rest = at < 0 ? 0 : steps.length - at - 2;
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="flex flex-col gap-3 px-4 py-4">
        {error && <Alert tone="error">{error}</Alert>}
        {/* A computer: the whole route, left to right. */}
        <ol className="hidden gap-3 sm:flex" aria-label={title}>
          {steps.map((s, i) => {
            const now = i === at;
            return (
              <li key={s.step} className="flex min-w-0 flex-1 flex-col gap-1.5" aria-current={now ? "step" : undefined}>
                <span className="flex items-center">
                  <span
                    className={cn(
                      "grid size-[26px] shrink-0 place-items-center rounded-full text-xs font-bold",
                      s.done
                        ? "bg-ok text-white"
                        : now
                          ? "bg-primary text-primary-fg"
                          : "border-[1.5px] border-line-strong bg-surface text-muted",
                    )}
                  >
                    {s.done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "ml-1.5 h-0.5 flex-1",
                      s.done ? "bg-ok" : now ? "bg-primary" : "bg-line-strong",
                      i === steps.length - 1 && "invisible",
                    )}
                  />
                </span>
                <b className={cn("text-[13px] leading-snug", now || s.done ? "font-semibold" : "font-medium text-text-2")}>{s.label}</b>
                {(s.done || s.sub) && <span className="text-xs text-text-2">{[s.done, s.sub].filter(Boolean).join(" · ")}</span>}
                {now && <span className="flex flex-wrap">{button(true)}</span>}
              </li>
            );
          })}
        </ol>
        {/* A phone: done so far, today's step with its button, the next one, and how many more. */}
        <ol className="flex flex-col divide-y divide-line sm:hidden">
          {at > 0 && (
            <li className="py-2 text-xs text-muted">
              {at} done · last: {steps[at - 1]!.label} {steps[at - 1]!.done}
            </li>
          )}
          {(at < 0 ? steps.slice(-1) : steps.slice(at, at + 2)).map((s, j) => {
            const now = at >= 0 && j === 0;
            return (
              <li key={s.step} className="flex items-start gap-2.5 py-2.5">
                <span
                  className={cn(
                    "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full",
                    s.done ? "bg-ok text-white" : "border-[1.5px] border-line-strong bg-surface",
                  )}
                  aria-hidden
                >
                  {s.done && <Check className="size-3" strokeWidth={3.5} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {steps.indexOf(s) + 1} · {s.label}
                  </span>
                  <span className="block text-xs text-muted">{s.done ? `done ${s.done}` : now ? s.sub : "next"}</span>
                  {now && <span className="mt-1.5 flex flex-wrap">{button(true)}</span>}
                </span>
              </li>
            );
          })}
          {rest > 0 && <li className="py-2 text-xs text-muted">+ {rest} more steps</li>}
        </ol>
        {lightForm}
        {at < 0 && <p className="text-xs text-ok">Every bank step is done.</p>}
      </div>
    </Card>
  );
}
