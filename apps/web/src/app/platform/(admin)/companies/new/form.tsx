"use client";

import { useState } from "react";
import { LIFECYCLE, suggestSlug } from "@kebo/shared";
import { Checkbox, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { Plan } from "@/lib/types-platform";
import { createCompanyAction } from "@/app/platform/actions";

export interface Prefill {
  kind?: "client" | "demo";
  name?: string;
  adminName?: string;
  adminEmail?: string;
  leadId?: string;
}

/** A client or a demo, with its tenant admin (who gets an email to set a password). */
export function NewCompanyForm({ plans, prefill }: { plans: Plan[]; prefill: Prefill }) {
  const [kind, setKind] = useState<"client" | "demo">(prefill.kind ?? "client");
  const [slug, setSlug] = useState(prefill.name ? suggestSlug(prefill.name) + (prefill.kind === "demo" ? "-demo" : "") : "");
  const [touched, setTouched] = useState(false);
  return (
    <ActionForm action={createCompanyAction} className="flex flex-col gap-5" keepFields>
      {(s) => (
        <>
          <input type="hidden" name="leadId" value={prefill.leadId ?? ""} />
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-2 text-sm font-medium">What is it?</legend>
            {(
              [
                ["client", "A client", "Pays for a plan; never ends by itself."],
                ["demo", "A demo", `Ends after ${LIFECYCLE.demoDays} days (or what you choose); can be made real later.`],
              ] as const
            ).map(([k, label, hint]) => (
              <label
                key={k}
                className="flex flex-1 basis-64 cursor-pointer items-start gap-2.5 rounded-xl border border-line p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40"
              >
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="mt-1 accent-[var(--color-primary)]"
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name" htmlFor="name" error={s.errors?.name}>
              <Input
                id="name"
                name="name"
                required
                defaultValue={s.values?.name ?? prefill.name}
                onChange={(e) => !touched && setSlug(e.target.value ? suggestSlug(e.target.value) + (kind === "demo" ? "-demo" : "") : "")}
              />
            </Field>
            <Field
              label="Short name"
              htmlFor="slug"
              hint="Small letters, numbers, dashes. Its future address: name.rfq…"
              error={s.errors?.slug}
            >
              <Input
                id="slug"
                name="slug"
                required
                value={slug}
                onChange={(e) => {
                  setTouched(true);
                  setSlug(e.target.value.toLowerCase());
                }}
              />
            </Field>
            <Field label="Tenant admin's name" htmlFor="adminName" error={s.errors?.adminName}>
              <Input id="adminName" name="adminName" required defaultValue={s.values?.adminName ?? prefill.adminName} />
            </Field>
            <Field label="Tenant admin's email" htmlFor="adminEmail" hint="Gets a link to set a password" error={s.errors?.adminEmail}>
              <Input id="adminEmail" name="adminEmail" type="email" required defaultValue={s.values?.adminEmail ?? prefill.adminEmail} />
            </Field>
            <Field label="Plan" htmlFor="planId" optional hint="No plan: no limits, every feature" error={s.errors?.planId}>
              <Select id="planId" name="planId" defaultValue={s.values?.planId ?? ""}>
                <option value="">No plan</option>
                {plans
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {kind === "demo" ? (
              <Field label="Days" htmlFor="days" error={s.errors?.days}>
                <Input id="days" name="days" type="number" min={1} max={60} defaultValue={s.values?.days ?? String(LIFECYCLE.demoDays)} />
              </Field>
            ) : (
              <Field label="Paid until" htmlFor="renewsOn" optional hint="After it, the company is overdue" error={s.errors?.renewsOn}>
                <Input id="renewsOn" name="renewsOn" type="date" defaultValue={s.values?.renewsOn} />
              </Field>
            )}
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox name="sampleData" defaultChecked={kind === "demo"} key={kind} className="mt-0.5" />
            <span>
              <span className="font-medium">Fill with sample data</span>
              <span className="block text-xs text-muted">Customers, factories, inquiries, quotations and orders to try things with.</span>
            </span>
          </label>
          <Field label="Notes" htmlFor="notes" optional error={s.errors?.notes}>
            <Textarea id="notes" name="notes" rows={3} defaultValue={s.values?.notes} />
          </Field>
          <div>
            <SubmitButton pendingText="Making it…">{kind === "demo" ? "Make the demo" : "Make the company"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
