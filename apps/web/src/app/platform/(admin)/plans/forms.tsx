"use client";

import { useState } from "react";
import { MODULE_PRESETS, PLAN_FEATURES, withPreset } from "@kebo/shared";
import { Button, Checkbox, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { Plan } from "@/lib/types-platform";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A plan's price, limits and features. */
export function PlanForm({ action, plan, onDone, submit }: { action: Action; plan?: Plan; onDone?: () => void; submit: string }) {
  const [features, setFeatures] = useState<string[]>(() => (plan ? [...plan.features] : Object.keys(PLAN_FEATURES)));
  const toggle = (k: string, on: boolean) => setFeatures((f) => (on ? [...f, k] : f.filter((x) => x !== k)));
  return (
    <ActionForm action={action} onDone={onDone} resetOnSuccess={!plan} keepFields className="flex flex-col gap-4">
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
          <div>
            <SubmitButton size="sm" variant="primary">
              {submit}
            </SubmitButton>
          </div>
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
          <Button key={p.key} type="button" size="xs" variant={same ? "primary" : "secondary"} title={p.hint} aria-pressed={same} onClick={() => onPick(withPreset(features, p))}>
            {p.name}
          </Button>
        );
      })}
    </div>
  );
}

export function EditPlan({ plan, action }: { plan: Plan; action: Action }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="border-t border-line p-4">
      <PlanForm action={action} plan={plan} onDone={() => setOpen(false)} submit="Save the plan" />
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  ) : (
    <div className="border-t border-line px-4 py-2">
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Edit
      </Button>
    </div>
  );
}
