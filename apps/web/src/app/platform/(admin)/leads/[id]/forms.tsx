"use client";

import { useState } from "react";
import { LEAD_STATUS_LABEL, LEAD_STATUSES, LIFECYCLE } from "@kebo/shared";
import { Checkbox, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { LeadStatus, Plan } from "@/lib/types-platform";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function LeadStatusForm({
  action,
  status,
  lostReason,
  followUpOn,
}: {
  action: Action;
  status: LeadStatus;
  lostReason: string | null;
  followUpOn: string | null;
}) {
  const [next, setNext] = useState<LeadStatus>(status);
  return (
    <ActionForm action={action} className="flex flex-col gap-3" keepFields>
      {(s) => (
        <>
          <Field label="Status" htmlFor="status" error={s.errors?.status}>
            <Select id="status" name="status" value={next} onChange={(e) => setNext(e.target.value as LeadStatus)}>
              {LEAD_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {LEAD_STATUS_LABEL[v]}
                </option>
              ))}
            </Select>
          </Field>
          {next === "lost" && (
            <Field label="Why lost" htmlFor="lostReason" error={s.errors?.lostReason}>
              <Input
                id="lostReason"
                name="lostReason"
                defaultValue={lostReason ?? ""}
                placeholder="Too expensive, went with another tool…"
              />
            </Field>
          )}
          <Field label="Follow up on" htmlFor="followUpOn" optional error={s.errors?.followUpOn}>
            <Input id="followUpOn" name="followUpOn" type="date" defaultValue={followUpOn ?? ""} />
          </Field>
          <div>
            <SubmitButton size="sm">Save</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function NoteForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-col gap-2">
      {(s) => (
        <>
          <Field label="Add a note" htmlFor="text" error={s.errors?.text}>
            <Textarea id="text" name="text" rows={3} placeholder="Called, sent the price list, wants a demo on Monday…" />
          </Field>
          <div>
            <SubmitButton size="sm">Add note</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function GiveDemoForm({ action, plans, suggested }: { action: Action; plans: Plan[]; suggested: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(s) => (
        <>
          <div className="grid gap-3">
            <Field label="Short name" htmlFor="gd-slug" optional hint="Empty: made from the company name" error={s.errors?.slug}>
              <Input id="gd-slug" name="slug" placeholder={suggested} />
            </Field>
            <Field label="Days" htmlFor="gd-days" error={s.errors?.days}>
              <Input id="gd-days" name="days" type="number" min={1} max={60} defaultValue={String(LIFECYCLE.demoDays)} />
            </Field>
            <Field label="Plan" htmlFor="gd-plan" optional>
              <Select id="gd-plan" name="planId" defaultValue="">
                <option value="">No plan (everything on)</option>
                {plans
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="hidden" name="sampleData" value="off" />
            <Checkbox name="sampleData" value="on" defaultChecked /> Fill with sample data
          </label>
          <div>
            <SubmitButton variant="primary" pendingText="Making the demo…">
              Give a demo
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
