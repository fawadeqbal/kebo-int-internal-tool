"use client";

import { useState } from "react";
import { MODULE_PRESETS, PLAN_FEATURES, withPreset } from "@kebo/shared";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton, toast } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { EditButton } from "@/components/common/edit-button";
import { MoreMenu } from "@/components/common/more-menu";
import { PANEL_FORM, PanelActions, PanelBody, PanelKeys, SidePanel, useClosePanel, useSidePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import type { Plan } from "@/lib/types-platform";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A plan's price, limits and features. */
export function PlanForm({ action, plan, onDone, submit }: { action: Action; plan?: Plan; onDone?: () => void; submit: string }) {
  const close = useClosePanel();
  const [features, setFeatures] = useState<string[]>(() => (plan ? [...plan.features] : Object.keys(PLAN_FEATURES)));
  const toggle = (k: string, on: boolean) => setFeatures((f) => (on ? [...f, k] : f.filter((x) => x !== k)));
  return (
    <ActionForm
      action={action}
      onDone={(r) => {
        toast(r.message ?? "Saved");
        onDone?.();
      }}
      showSuccess={false}
      keepFields
      className={PANEL_FORM}
    >
      {(s) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor={`name-${plan?.id ?? "new"}`} error={s.errors?.name}>
              <Input
                id={`name-${plan?.id ?? "new"}`}
                name="name"
                required
                defaultValue={plan?.name}
                placeholder="Starter, Team, Business…"
              />
            </Field>
            <div className="grid grid-cols-[1fr_5rem_7rem] gap-2">
              <Field label="Price" htmlFor={`price-${plan?.id ?? "new"}`} error={s.errors?.price}>
                <Input
                  id={`price-${plan?.id ?? "new"}`}
                  name="price"
                  inputMode="decimal"
                  defaultValue={plan ? String(plan.priceMinor / 100) : ""}
                />
              </Field>
              <Field label="Currency" htmlFor={`cur-${plan?.id ?? "new"}`}>
                <Input id={`cur-${plan?.id ?? "new"}`} name="currency" maxLength={3} defaultValue={plan?.currency ?? "USD"} />
              </Field>
              <Field label="Per" htmlFor={`per-${plan?.id ?? "new"}`}>
                <Select id={`per-${plan?.id ?? "new"}`} name="period" defaultValue={plan?.period ?? "month"}>
                  <option value="month">month</option>
                  <option value="year">year</option>
                </Select>
              </Field>
            </div>
            <Field label="People" htmlFor={`users-${plan?.id ?? "new"}`} optional hint="Empty: no limit" error={s.errors?.maxUsers}>
              <Input id={`users-${plan?.id ?? "new"}`} name="maxUsers" type="number" min={1} defaultValue={plan?.maxUsers ?? ""} />
            </Field>
            <Field label="Files (GB)" htmlFor={`gb-${plan?.id ?? "new"}`} optional hint="Empty: no limit" error={s.errors?.maxStorageMb}>
              <Input
                id={`gb-${plan?.id ?? "new"}`}
                name="maxStorageGb"
                inputMode="decimal"
                defaultValue={plan?.maxStorageMb ? String(Math.round((plan.maxStorageMb / 1024) * 100) / 100) : ""}
              />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Included</legend>
            <PresetButtons features={features} onPick={setFeatures} />
            {Object.entries(PLAN_FEATURES).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <Checkbox name="features" value={key} checked={features.includes(key)} onChange={(e) => toggle(key, e.target.checked)} /> {label}
              </label>
            ))}
            <p className="text-xs text-muted">Inquiries, quotations, orders, payments and documents are in every plan.</p>
          </fieldset>
          <Field label="Description" htmlFor={`desc-${plan?.id ?? "new"}`} optional>
            <Textarea id={`desc-${plan?.id ?? "new"}`} name="description" rows={2} defaultValue={plan?.description ?? ""} />
          </Field>
          {plan && (
            <label className="flex items-center gap-2 text-sm">
              <input type="hidden" name="isActive" value="off" />
              <Checkbox name="isActive" value="on" defaultChecked={plan.isActive} /> Offered for new companies
            </label>
          )}
          <PanelActions>
            <SubmitButton pendingText="Saving…">{submit}</SubmitButton>
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

/** One click sets the order-flow modules to a preset; the other features stay as they are. */
export function PresetButtons({ features, onPick }: { features: readonly string[]; onPick: (features: string[]) => void }) {
  return (
    <div className="mb-1 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">Order-flow modules:</span>
      {MODULE_PRESETS.map((p) => {
        const same = withPreset(features, p).sort().join() === [...features].sort().join();
        return (
          <Button key={p.key} type="button" size="xs" variant="secondary" className="aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary" title={p.hint} aria-pressed={same} onClick={() => onPick(withPreset(features, p))}>
            {p.name}
          </Button>
        );
      })}
    </div>
  );
}

/** ✎ Edit and ⋯ (Delete, only for a plan no company uses) in a plan card's header. */
export function PlanActions({ plan, remove }: { plan: Plan; remove?: Action }) {
  const panel = useSidePanel("edit-plan");
  return (
    <>
      <EditButton aria-label={`Edit the plan ${plan.name}`} onClick={() => panel.openPanel(plan.id)} />
      {remove && (
        <MoreMenu
          label={`More for the plan ${plan.name}`}
          items={[{ label: "Delete the plan…", danger: true, confirm: { title: `Delete the plan ${plan.name}?`, body: "No company uses it.", confirmLabel: "Delete the plan" }, action: remove }]}
        />
      )}
    </>
  );
}

/** "New plan" and "Edit plan · name" in the side panel (?panel=new-plan, ?panel=edit-plan&id=…). */
export function PlanPanels({ plans, create, update }: { plans: Plan[]; create: Action; update: Record<string, Action> }) {
  const add = useSidePanel("new-plan");
  const edit = useSidePanel("edit-plan");
  const plan = plans.find((p) => p.id === edit.id);
  if (add.open)
    return (
      <SidePanel title="New plan" description="A price, limits on people and files, and the features included." onClose={() => add.close()}>
        <PanelBody>
          <PlanForm action={create} onDone={() => add.close()} submit="Make the plan" />
        </PanelBody>
      </SidePanel>
    );
  if (edit.open && plan)
    return (
      <SidePanel title={`Edit plan · ${plan.name}`} description="Companies on it get the change at once." onClose={() => edit.close()}>
        <PanelBody>
          <PlanForm action={update[plan.id]!} plan={plan} onDone={() => edit.close()} submit="Save the plan" />
        </PanelBody>
      </SidePanel>
    );
  return null;
}
