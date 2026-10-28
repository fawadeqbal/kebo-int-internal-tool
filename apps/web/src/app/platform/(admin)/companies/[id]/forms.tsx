"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { CompanyDetail, Plan } from "@/lib/types-platform";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function CopyLink({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Set-password link" />
      <Button
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(link).then(() => setDone(true));
        }}
      >
        <Copy aria-hidden /> {done ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function DetailsForm({ c, plans, action }: { c: CompanyDetail; plans: Plan[]; action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      {(s) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" error={s.errors?.name}>
              <Input id="name" name="name" defaultValue={c.name} required />
            </Field>
            <Field label="Short name" htmlFor="slug" hint="Renaming keeps the old one working for 30 days" error={s.errors?.slug}>
              <Input id="slug" name="slug" defaultValue={c.slug} required />
            </Field>
            <Field label="Plan" htmlFor="planId" optional error={s.errors?.planId}>
              <Select id="planId" name="planId" defaultValue={c.plan?.id ?? ""}>
                <option value="">No plan (no limits, every feature)</option>
                {plans
                  .filter((p) => p.isActive || p.id === c.plan?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {c.kind === "client" && (
              <Field label="Paid until" htmlFor="renewsOn" optional hint="Recording a payment sets it too" error={s.errors?.renewsOn}>
                <Input id="renewsOn" name="renewsOn" type="date" defaultValue={c.renewsOn ?? ""} />
              </Field>
            )}
            <Field label="Contact name" htmlFor="contactName" optional>
              <Input id="contactName" name="contactName" defaultValue={c.contactName ?? ""} />
            </Field>
            <Field
              label="Contact email"
              htmlFor="contactEmail"
              optional
              hint="Gets the demo, trial and payment emails"
              error={s.errors?.contactEmail}
            >
              <Input id="contactEmail" name="contactEmail" type="email" defaultValue={c.contactEmail ?? ""} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="notes" optional>
            <Textarea id="notes" name="notes" rows={3} defaultValue={c.notes ?? ""} />
          </Field>
          <div>
            <SubmitButton size="sm">Save</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** One button that sends a form (switch on, read-only, off, end…), optionally with a reason. */
export function ActionButton({
  action,
  label,
  variant = "secondary",
  confirm,
  reason,
}: {
  action: Action;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  confirm?: string;
  reason?: boolean;
}) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      {reason && <Input name="reason" placeholder="Why (optional)" className="h-8 w-48 text-sm" aria-label="Why" />}
      <SubmitButton
        size="sm"
        variant={variant}
        onClick={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault();
        }}
      >
        {label}
      </SubmitButton>
    </ActionForm>
  );
}

export function ExtendForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-2">
      {(s) => (
        <>
          <Field label="More days" htmlFor="days" error={s.errors?.days} className="w-28">
            <Input id="days" name="days" type="number" min={1} max={90} defaultValue="3" />
          </Field>
          <SubmitButton size="sm">Extend</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function MakeRealForm({ action, plans }: { action: Action; plans: Plan[] }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(s) => (
        <>
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1 font-medium">Their data</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="keepData" value="keep" defaultChecked className="accent-[var(--color-primary)]" /> Keep everything
              they made
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="keepData" value="clear" className="accent-[var(--color-primary)]" /> Start clean (inquiries,
              customers, orders… removed; people, roles and settings kept)
            </label>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plan" htmlFor="mr-plan" optional error={s.errors?.planId}>
              <Select id="mr-plan" name="planId" defaultValue="">
                <option value="">Keep the current plan</option>
                {plans
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Paid until" htmlFor="mr-renews" optional error={s.errors?.renewsOn}>
              <Input id="mr-renews" name="renewsOn" type="date" />
            </Field>
          </div>
          <div>
            <SubmitButton size="sm" variant="primary">
              Make it a client
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function PaymentForm({ action, today, currency }: { action: Action; today: string; currency: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_6rem_1fr_1fr] sm:items-end">
      {(s) => (
        <>
          <Field label="Amount" htmlFor="amount" error={s.errors?.amount}>
            <Input id="amount" name="amount" inputMode="decimal" required />
          </Field>
          <Field label="Currency" htmlFor="currency" error={s.errors?.currency}>
            <Input id="currency" name="currency" defaultValue={currency} maxLength={3} />
          </Field>
          <Field label="Paid on" htmlFor="paidOn" error={s.errors?.paidOn}>
            <Input id="paidOn" name="paidOn" type="date" defaultValue={today} />
          </Field>
          <Field label="Now paid until" htmlFor="paidUntil" error={s.errors?.paidUntil}>
            <Input id="paidUntil" name="paidUntil" type="date" required />
          </Field>
          <Field label="Note" htmlFor="note" optional className="sm:col-span-3">
            <Input id="note" name="note" placeholder="Bank transfer ref., invoice no.…" />
          </Field>
          <div>
            <SubmitButton size="sm" variant="primary">
              Record payment
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function AdminPasswordForm({ action, admins }: { action: Action; admins: { id: string; name: string; email: string }[] }) {
  return (
    <ActionForm action={action} showSuccess className="flex flex-col gap-2">
      {(s) => (
        <>
          <div className="flex flex-wrap items-end gap-2">
            {admins.length > 1 && (
              <Field label="Tenant admin" htmlFor="userId" className="min-w-56">
                <Select id="userId" name="userId">
                  {admins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.email})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <SubmitButton size="sm">Send a set-password link</SubmitButton>
          </div>
          {s.ok && (s.data as { link?: string } | undefined)?.link && <CopyLink link={(s.data as { link: string }).link} />}
        </>
      )}
    </ActionForm>
  );
}

export function DeleteForm({ action, slug }: { action: Action; slug: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      {(s) => (
        <>
          <p className="text-sm text-text-2">
            Removes all its data and files for good. Export it first if anyone may need it. Type{" "}
            <span className="font-mono font-medium text-text">{slug}</span> to confirm.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Short name" htmlFor="confirm" error={s.errors?.confirm} className="w-56">
              <Input id="confirm" name="confirm" autoComplete="off" />
            </Field>
            <Field label="Why" htmlFor="del-reason" optional className="w-64">
              <Input id="del-reason" name="reason" />
            </Field>
            <SubmitButton size="sm" variant="danger" pendingText="Deleting…">
              Delete the company
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Switch on, read-only, off, or back to the automatic rules: one reason, one button per choice. */
export function StatusForm({ action, status, manual, name }: { action: Action; status: string; manual: boolean; name: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3">
      <Field label="Why" htmlFor="status-reason" optional hint="Shown to the company's people">
        <Input id="status-reason" name="reason" placeholder="Payment late, asked to pause…" />
      </Field>
      <div className="flex flex-wrap gap-2">
        {status !== "active" && (
          <SubmitButton size="sm" variant="primary" name="status" value="active">
            Switch on
          </SubmitButton>
        )}
        {status !== "read_only" && (
          <SubmitButton size="sm" name="status" value="read_only">
            Make read-only
          </SubmitButton>
        )}
        {status !== "off" && (
          <SubmitButton
            size="sm"
            variant="danger"
            name="status"
            value="off"
            onClick={(e) => {
              if (!window.confirm(`Switch off ${name}? Nobody can sign in until it is switched on.`)) e.preventDefault();
            }}
          >
            Switch off
          </SubmitButton>
        )}
        {manual && (
          <SubmitButton size="sm" variant="ghost" name="status" value="auto">
            Back to the automatic rules
          </SubmitButton>
        )}
      </div>
      <p className="text-xs text-muted">Read-only: people can look, not change. Off: nobody can sign in. Nothing is deleted.</p>
    </ActionForm>
  );
}
