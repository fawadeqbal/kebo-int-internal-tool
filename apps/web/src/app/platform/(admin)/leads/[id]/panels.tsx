"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { LEAD_STATUS_LABEL, LIFECYCLE } from "@kebo/shared";
import { Checkbox, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import {
  PANEL_FORM,
  PanelActions,
  PanelBody,
  PanelKeys,
  PanelSection,
  SidePanel,
  useClosePanel,
  useSidePanel,
} from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { LeadDetail, LeadStatus, Plan } from "@/lib/types-platform";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const STEPS: LeadStatus[] = ["new", "contacted", "demo", "client", "lost"];
const ORDER: LeadStatus[] = ["new", "contacted", "demo", "client"];

/**
 * Where the client inquiry stands (design system: progress steps): New →
 * Contacted → Demo given → Client, or Lost. Each step is a button that moves
 * it there (Lost asks why, in its panel); the ones passed are ticked.
 */
export function ProgressSteps({ status, action }: { status: LeadStatus; action: Action }) {
  const lost = useSidePanel("lost");
  const at = ORDER.indexOf(status);
  return (
    <ActionForm
      action={action}
      showSuccess={false}
      onDone={(s) => toast(s.message && s.message !== "Saved." ? s.message : "Saved · status")}
    >
      <input type="hidden" name="_saved" value="Saved · status" />
      <ol aria-label="Progress" className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {STEPS.map((k, i) => {
          const current = k === status;
          const done = status !== "lost" && i < at;
          const cls = cn(
            "flex h-9 w-full items-center justify-center gap-1 rounded-lg px-2 text-[13px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            current
              ? k === "lost"
                ? "bg-bad-soft font-semibold text-bad"
                : "bg-primary-soft font-semibold text-primary"
              : done
                ? "bg-ok-soft text-ok hover:brightness-95"
                : "bg-surface-2 text-text-2 hover:text-text",
          );
          return (
            <li key={k} className={cn(k === "lost" && "max-sm:col-span-2")}>
              {current ? (
                <span aria-current="step" className={cls}>
                  {LEAD_STATUS_LABEL[k]}
                </span>
              ) : k === "lost" ? (
                <button type="button" className={cls} aria-haspopup="dialog" onClick={() => lost.openPanel()}>
                  {LEAD_STATUS_LABEL[k]}…
                </button>
              ) : (
                <SubmitButton name="status" value={k} variant="ghost" className={cls} aria-label={`Move to ${LEAD_STATUS_LABEL[k]}`}>
                  {done && <Check className="size-3.5" aria-hidden />}
                  {LEAD_STATUS_LABEL[k]}
                </SubmitButton>
              )}
            </li>
          );
        })}
      </ol>
    </ActionForm>
  );
}

function PanelForm({
  action,
  children,
  submit = "Save",
  message,
  onSaved,
  danger,
}: {
  action: Action;
  children: (s: ActionState) => ReactNode;
  submit?: string;
  message: string;
  onSaved: () => void;
  danger?: boolean;
}) {
  const close = useClosePanel();
  return (
    <ActionForm
      action={action}
      showSuccess={false}
      className={PANEL_FORM}
      onDone={(s) => {
        toast(s.message && s.message !== "Saved." ? s.message : message);
        onSaved();
      }}
    >
      {(s) => (
        <>
          {s.ok === false && s.errors && Object.keys(s.errors).length > 0 && (
            <p role="alert" className="text-sm text-bad">
              {s.message ?? "Some values need fixing."}
            </p>
          )}
          {children(s)}
          <PanelActions>
            <SubmitButton variant={danger ? "danger" : "primary"} pendingText="Saving…">
              {submit}
            </SubmitButton>
            <button type="button" className="text-sm font-medium text-text-2 hover:text-text" onClick={() => close()}>
              Cancel
            </button>
            <PanelKeys />
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}

function Panel({
  name,
  title,
  description,
  children,
}: {
  name: string;
  title: string;
  description?: string;
  children: (close: () => void) => ReactNode;
}) {
  const p = useSidePanel(name);
  if (!p.open) return null;
  return (
    <SidePanel title={title} description={description} onClose={() => p.close()}>
      <PanelBody>{children(() => p.close())}</PanelBody>
    </SidePanel>
  );
}

const val = (s: ActionState, k: string, v: string | null | undefined) => s.values?.[k] ?? v ?? "";

/** The client inquiry's side panels: Who, What they need, follow-up date, Mark as lost, Give a demo. */
export function LeadPanels({
  l,
  plans,
  suggested,
  update,
  demo,
}: {
  l: LeadDetail;
  plans: Plan[];
  suggested: string;
  update: Action;
  demo: Action;
}) {
  return (
    <>
      <Panel name="edit-who" title={`Edit who · ${l.companyName}`} description="Their company and how to reach them.">
        {(done) => (
          <PanelForm action={update} message="Saved · Who" onSaved={done}>
            {(s) => (
              <>
                <PanelSection first title="Company">
                  <Field label="Company" htmlFor="w-company" error={s.errors?.companyName}>
                    <Input id="w-company" name="companyName" required defaultValue={val(s, "companyName", l.companyName)} />
                  </Field>
                  <Field label="Country" htmlFor="w-country" optional error={s.errors?.country}>
                    <Input id="w-country" name="country" defaultValue={val(s, "country", l.country)} />
                  </Field>
                  <Field label="Team size" htmlFor="w-team" optional error={s.errors?.teamSize}>
                    <Select id="w-team" name="teamSize" defaultValue={val(s, "teamSize", l.teamSize)}>
                      <option value="">Not said</option>
                      {["1-5", "6-20", "21-50", "51+"].map((t) => (
                        <option key={t} value={t}>
                          {t} people
                        </option>
                      ))}
                    </Select>
                  </Field>
                </PanelSection>
                <PanelSection title="Contact">
                  <Field label="Name" htmlFor="w-name" error={s.errors?.name}>
                    <Input id="w-name" name="name" required defaultValue={val(s, "name", l.name)} />
                  </Field>
                  <Field label="Email" htmlFor="w-email" error={s.errors?.email}>
                    <Input id="w-email" name="email" type="email" required defaultValue={val(s, "email", l.email)} />
                  </Field>
                  <Field label="Phone / WhatsApp" htmlFor="w-phone" optional hint="With the country code" error={s.errors?.phone}>
                    <Input id="w-phone" name="phone" type="tel" defaultValue={val(s, "phone", l.phone)} />
                  </Field>
                </PanelSection>
              </>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="edit-need" title="Edit what they need" description={`${l.companyName} · in their words, and yours`}>
        {(done) => (
          <PanelForm action={update} message="Saved · What they need" onSaved={done}>
            {(s) => (
              <PanelSection first className="sm:grid-cols-1">
                <Field
                  label="What they need"
                  htmlFor="n-message"
                  optional
                  hint="Their request, with what you learned on calls"
                  error={s.errors?.message}
                >
                  <Textarea id="n-message" name="message" rows={8} defaultValue={val(s, "message", l.message)} />
                </Field>
              </PanelSection>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="follow-up" title="Next follow-up" description={`${l.companyName} · shown on the overview when it is due`}>
        {(done) => (
          <PanelForm action={update} message="Saved · follow-up" onSaved={done}>
            {(s) => (
              <PanelSection first className="sm:grid-cols-1">
                <Field label="Follow up on" htmlFor="f-date" optional hint="Empty: no follow-up" error={s.errors?.followUpOn}>
                  <Input id="f-date" name="followUpOn" type="date" defaultValue={val(s, "followUpOn", l.followUpOn)} />
                </Field>
              </PanelSection>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel
        name="lost"
        title={`Mark ${l.companyName} as lost`}
        description="It stays in the list (filter: Lost); you can move it back any time."
      >
        {(done) => (
          <PanelForm action={update} submit="Mark as lost" danger message={`${l.companyName}: lost`} onSaved={done}>
            {(s) => (
              <>
                <input type="hidden" name="status" value="lost" />
                <PanelSection first className="sm:grid-cols-1">
                  <Field
                    label="Why lost"
                    htmlFor="l-reason"
                    error={s.errors?.lostReason ?? (s.ok === false && !s.errors ? [s.message ?? ""] : undefined)}
                  >
                    <Input
                      id="l-reason"
                      name="lostReason"
                      required
                      placeholder="Too expensive, went with another tool…"
                      defaultValue={val(s, "lostReason", l.lostReason)}
                    />
                  </Field>
                </PanelSection>
              </>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel
        name="give-demo"
        title={`Give a demo · ${l.companyName}`}
        description="Their own space with sample data; they get an email to set a password."
      >
        {(done) => (
          <PanelForm action={demo} submit="Give a demo" message="The demo is ready" onSaved={done}>
            {(s) => (
              <>
                <PanelSection first>
                  <Field label="Short name" htmlFor="gd-slug" optional hint={`Empty: ${suggested}`} error={s.errors?.slug}>
                    <Input id="gd-slug" name="slug" placeholder={suggested} defaultValue={val(s, "slug", null)} />
                  </Field>
                  <Field label="Days" htmlFor="gd-days" error={s.errors?.days}>
                    <Input
                      id="gd-days"
                      name="days"
                      type="number"
                      min={1}
                      max={60}
                      defaultValue={val(s, "days", String(LIFECYCLE.demoDays))}
                    />
                  </Field>
                  <Field label="Plan" htmlFor="gd-plan" optional>
                    <Select id="gd-plan" name="planId" defaultValue={val(s, "planId", "")}>
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
                </PanelSection>
                <label className="flex items-center gap-2 text-sm">
                  <input type="hidden" name="sampleData" value="off" />
                  <Checkbox name="sampleData" value="on" defaultChecked /> Fill with sample data
                </label>
              </>
            )}
          </PanelForm>
        )}
      </Panel>
    </>
  );
}
