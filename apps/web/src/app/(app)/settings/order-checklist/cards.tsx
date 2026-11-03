"use client";

import { Lock } from "lucide-react";
import { FLOW_STEP_LABEL, FLOW_STEPS, PAYMENT_ROUTE_SHORT, TOOL_LABEL, type FlowStep } from "@kebo/shared";
import { Card, CardHeader, cn } from "@kebo/ui";
import { EditButton } from "@/components/common/edit-button";
import { PanelBody, SidePanel, useSidePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { ChecklistSettings } from "@/lib/types-checklist";
import { ChecklistEditor } from "./editor";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Settings › Order checklist: one card per step with its items read-only
 * (yours, then the ones ticked from the data); ✎ Edit opens the checklist in
 * the side panel on that step.
 */
export function ChecklistCards({ value, action }: { value: ChecklistSettings; action: Action }) {
  const panel = useSidePanel("edit-checklist");
  const at = (FLOW_STEPS as readonly string[]).includes(panel.id ?? "") ? (panel.id as FlowStep) : "payment";
  return (
    <>
      {FLOW_STEPS.map((step, n) => {
        const mine = value.items.filter((i) => i.step === step);
        const auto = value.auto.find((a) => a.step === step)?.items ?? [];
        const shown = auto.filter((a) => !a.hidden).length;
        return (
          <Card key={step} id={`checklist-${step}`} className="scroll-mt-20">
            <CardHeader
              title={`${n + 1} · ${FLOW_STEP_LABEL[step]}`}
              description={`${mine.length ? `${mine.length} item${mine.length === 1 ? "" : "s"} of your own` : "None of your own"}${auto.length ? ` · ${shown} of ${auto.length} ticked from the data` : ""}`}
              className="max-sm:flex-row max-sm:gap-3"
              actions={<EditButton aria-label={`Edit the ${FLOW_STEP_LABEL[step]} checklist`} onClick={() => panel.openPanel(step)} />}
            />
            <ul className="flex flex-col divide-y divide-line">
              {mine.map((i, k) => (
                <li key={`${i.title}-${k}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm">
                  <span className="min-w-0 font-medium">{i.title}</span>
                  <span className="text-xs text-muted">
                    {TOOL_LABEL[i.tool]}
                    {i.route && ` · only ${PAYMENT_ROUTE_SHORT[i.route]} orders`}
                    {i.dueDays !== null && ` · due ${i.dueDays} days after the order`}
                  </span>
                </li>
              ))}
              {auto.map((a) => (
                <li key={a.key} className={cn("flex items-center justify-between gap-3 px-4 py-2.5 text-sm", a.hidden && "text-muted")}>
                  <span className={cn("flex min-w-0 items-center gap-2", a.hidden && "line-through")}>
                    {a.title}
                    <Lock className="size-3 shrink-0 text-muted" aria-hidden />
                  </span>
                  <span className="shrink-0 text-xs text-muted">{a.hidden ? "Hidden" : "Ticked from the data"}</span>
                </li>
              ))}
              {!mine.length && !auto.length && (
                <li className="px-4 py-3 text-sm text-muted">
                  Nothing in this step yet.{" "}
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => panel.openPanel(step)}>
                    + Add an item
                  </button>
                </li>
              )}
            </ul>
          </Card>
        );
      })}
      {panel.open && (
        <SidePanel
          title={`Edit the order checklist · ${FLOW_STEP_LABEL[at]}`}
          description="The items every new order starts with, and the tool each one has. Orders already started keep their own list."
          onClose={() => panel.close()}
        >
          <PanelBody>
            <ChecklistEditor initial={value} action={action} step={at} onSaved={() => panel.close()} />
          </PanelBody>
        </SidePanel>
      )}
    </>
  );
}
