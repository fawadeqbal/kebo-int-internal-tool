"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { LIFECYCLE } from "@kebo/shared";
import { Field, Input, Select, Textarea } from "@kebo/ui";
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
import type { CompanyDetail, Plan } from "@/lib/types-platform";
import { CopyLink } from "./forms";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** The company's actions, bound to it on the server (page.tsx). */
export interface CompanyActions {
  update: Action;
  status: Action;
  extend: Action;
  end: Action;
  makeReal: Action;
  remove: Action;
  adminPassword: Action;
  payment: Action;
  modules: Action;
}

export type PanelCompany = Pick<
  CompanyDetail,
  | "id"
  | "name"
  | "slug"
  | "kind"
  | "status"
  | "statusManual"
  | "plan"
  | "renewsOn"
  | "endsAt"
  | "contactName"
  | "contactEmail"
  | "contactPhone"
  | "notes"
  | "previousSlug"
  | "address"
> & { people: { id: string; name: string; email: string; tenantAdmin: boolean }[]; currency: string };

/** Which card a saved panel lights up for 2 seconds (?saved=…). */
export type SavedCard = "company" | "contact" | "address" | "notes" | "plan" | "billing";

/* ---------------------------------------------------------------- one form in a panel */

/**
 * A side panel's form: the fields in titled groups, an error summary at the
 * top when something needs fixing, Save / Cancel pinned at the bottom. Saved:
 * the panel closes, a toast says so and the card it changed lights up.
 */
function PanelForm({
  action,
  children,
  submit = "Save",
  danger,
  saved,
  message,
  onSaved,
  stay,
}: {
  action: Action;
  children: (s: ActionState) => ReactNode;
  submit?: string;
  danger?: boolean;
  saved?: SavedCard;
  message: string;
  onSaved: (then?: Record<string, string>) => void;
  /** Stays open after sending, showing the answer (a link to copy). */
  stay?: boolean;
}) {
  const close = useClosePanel();
  return (
    <ActionForm
      action={action}
      showSuccess={!!stay}
      className={PANEL_FORM}
      onDone={(s) => {
        if (stay) return;
        toast(s.message && s.message !== "Saved." ? s.message : message);
        onSaved(saved ? { saved } : undefined);
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
              {stay && s.ok ? "Close" : "Cancel"}
            </button>
            <PanelKeys />
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}

/** A URL side panel of this page (?panel=<name>), drawn while it is open. */
function Panel({
  name,
  title,
  description,
  children,
}: {
  name: string;
  title: string;
  description?: ReactNode;
  children: (close: (then?: Record<string, string>) => void, id: string | null) => ReactNode;
}) {
  const p = useSidePanel(name);
  if (!p.open) return null;
  return (
    <SidePanel title={title} description={description} onClose={() => p.close()}>
      <PanelBody>{children((then) => p.close(then), p.id)}</PanelBody>
    </SidePanel>
  );
}

const text = (s: ActionState, k: string, fallback: string | null | undefined) => s.values?.[k] ?? fallback ?? "";

/* ---------------------------------------------------------------- every panel of the page */

const STATUS = {
  active: {
    title: "Switch on",
    body: "Everyone can sign in and work again. The automatic rules leave it alone until you go back to them.",
    submit: "Switch it on",
  },
  read_only: {
    title: "Make read-only",
    body: "People can sign in and look, but nothing can be changed. Nothing is deleted.",
    submit: "Make it read-only",
  },
  off: { title: "Switch off", body: "Nobody can sign in until it is switched on again. Nothing is deleted.", submit: "Switch it off" },
  auto: {
    title: "Back to the automatic rules",
    body: "The rules decide again (overdue: read-only after 7 days, off after 30; demos end on their date).",
    submit: "Back to the rules",
  },
} as const;

/**
 * The company page's side panels (design system: side panel), all in the URL
 * so a link opens one and Back closes it: the group cards' ✎ Edit, Change
 * plan, Record payment, the paid-until date, ⋯'s Switch on / off / read-only
 * and Delete, a demo's Extend and Make it a client, and the tenant admin's
 * set-password link.
 */
export function CompanyPanels({ c, plans, today, actions }: { c: PanelCompany; plans: Plan[]; today: string; actions: CompanyActions }) {
  const params = useSearchParams();
  const which = params.get("panel");
  if (!which) return null;
  const offered = plans.filter((p) => p.isActive || p.id === c.plan?.id);
  return (
    <>
      <Panel
        name="edit-company"
        title={`Edit company · ${c.name}`}
        description="Its name, as it shows in the app, on its sign-in page and in emails."
      >
        {(done) => (
          <PanelForm action={actions.update} message="Saved · Company" saved="company" onSaved={done}>
            {(s) => (
              <PanelSection first className="sm:grid-cols-1">
                <Field label="Name" htmlFor="co-name" error={s.errors?.name}>
                  <Input id="co-name" name="name" required defaultValue={text(s, "name", c.name)} />
                </Field>
              </PanelSection>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="edit-contact" title="Edit main contact" description={`${c.name} · gets the demo, trial, renewal and payment emails`}>
        {(done) => (
          <PanelForm action={actions.update} message="Saved · Main contact" saved="contact" onSaved={done}>
            {(s) => (
              <PanelSection first className="sm:grid-cols-1">
                <Field label="Name" htmlFor="ct-name" optional error={s.errors?.contactName}>
                  <Input id="ct-name" name="contactName" defaultValue={text(s, "contactName", c.contactName)} autoComplete="off" />
                </Field>
                <Field
                  label="Email"
                  htmlFor="ct-email"
                  optional
                  hint="Renewal reminders and payment emails go here"
                  error={s.errors?.contactEmail}
                >
                  <Input
                    id="ct-email"
                    name="contactEmail"
                    type="email"
                    defaultValue={text(s, "contactEmail", c.contactEmail)}
                    autoComplete="off"
                  />
                </Field>
                <Field label="Phone / WhatsApp" htmlFor="ct-phone" optional hint="With the country code" error={s.errors?.contactPhone}>
                  <Input
                    id="ct-phone"
                    name="contactPhone"
                    type="tel"
                    placeholder="+92 300 …"
                    defaultValue={text(s, "contactPhone", c.contactPhone)}
                    autoComplete="off"
                  />
                </Field>
              </PanelSection>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="edit-address" title="Edit web address" description={`${c.name} · where their people sign in`}>
        {(done) => (
          <PanelForm action={actions.update} message="Saved · Web address" saved="address" onSaved={done}>
            {(s) => (
              <PanelSection first className="sm:grid-cols-1">
                <Field
                  label="Short name"
                  htmlFor="ad-slug"
                  hint={`Its address and sign-in name. After a change the old one keeps working for ${LIFECYCLE.renameRedirectDays} days.`}
                  error={s.errors?.slug}
                >
                  <Input id="ad-slug" name="slug" required defaultValue={text(s, "slug", c.slug)} autoComplete="off" spellCheck={false} />
                </Field>
              </PanelSection>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="edit-notes" title="Edit notes" description={`${c.name} · only platform admins see them`}>
        {(done) => (
          <PanelForm action={actions.update} message="Saved · Notes" saved="notes" onSaved={done}>
            {(s) => (
              <PanelSection first className="sm:grid-cols-1">
                <Field label="Notes" htmlFor="nt-notes" optional error={s.errors?.notes}>
                  <Textarea id="nt-notes" name="notes" rows={6} defaultValue={text(s, "notes", c.notes)} />
                </Field>
              </PanelSection>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="change-plan" title={`Change plan · ${c.name}`} description="The limits and modules change at once; nothing is deleted.">
        {(done) => (
          <PanelForm action={actions.update} message="Saved · Plan" saved="plan" onSaved={done}>
            {(s) => (
              <>
                <input type="hidden" name="_saved" value="Saved · Plan" />
                <PanelSection first className="sm:grid-cols-1">
                  <Field label="Plan" htmlFor="pl-plan" optional hint="No plan: no limits and every module" error={s.errors?.planId}>
                    <Select id="pl-plan" name="planId" defaultValue={text(s, "planId", c.plan?.id)}>
                      <option value="">No plan (no limits, every module)</option>
                      {offered.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.currency} {(p.priceMinor / 100).toLocaleString("en-US")} a {p.period} ·{" "}
                          {p.maxUsers ? `${p.maxUsers} people` : "any number of people"}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </PanelSection>
              </>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="paid-until" title="Change the paid-until date" description={`${c.name} · recording a payment sets it too`}>
        {(done) => (
          <PanelForm action={actions.update} message="Saved · Paid until" saved="billing" onSaved={done}>
            {(s) => (
              <PanelSection first className="sm:grid-cols-1">
                <Field
                  label="Paid until"
                  htmlFor="pu-date"
                  optional
                  hint="After it the company is overdue: read-only 7 days later, off after 30"
                  error={s.errors?.renewsOn}
                >
                  <Input id="pu-date" name="renewsOn" type="date" defaultValue={text(s, "renewsOn", c.renewsOn)} />
                </Field>
              </PanelSection>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="record-payment" title="Record payment" description={`${c.name} · each payment sets the paid-until date`}>
        {(done) => (
          <PanelForm action={actions.payment} submit="Record payment" message="Payment recorded" saved="billing" onSaved={done}>
            {(s) => (
              <>
                <PanelSection first title="Payment">
                  <Field label="Amount" htmlFor="py-amount" error={s.errors?.amount}>
                    <Input
                      id="py-amount"
                      name="amount"
                      inputMode="decimal"
                      required
                      defaultValue={text(s, "amount", c.plan ? String(c.plan.priceMinor / 100) : "")}
                    />
                  </Field>
                  <Field label="Currency" htmlFor="py-currency" error={s.errors?.currency}>
                    <Input id="py-currency" name="currency" maxLength={3} defaultValue={text(s, "currency", c.currency)} />
                  </Field>
                  <Field label="Paid on" htmlFor="py-on" error={s.errors?.paidOn}>
                    <Input id="py-on" name="paidOn" type="date" defaultValue={text(s, "paidOn", today)} />
                  </Field>
                  <Field label="Now paid until" htmlFor="py-until" error={s.errors?.paidUntil}>
                    <Input id="py-until" name="paidUntil" type="date" required defaultValue={text(s, "paidUntil", null)} />
                  </Field>
                </PanelSection>
                <PanelSection title="Note" className="sm:grid-cols-1">
                  <Field label="Note" htmlFor="py-note" optional hint="Bank transfer ref., invoice no.…">
                    <Input id="py-note" name="note" defaultValue={text(s, "note", null)} />
                  </Field>
                </PanelSection>
              </>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="status" title={STATUS[(params.get("id") ?? "off") as keyof typeof STATUS]?.title ?? "Switch off"} description={c.name}>
        {(done, id) => {
          const key = (id && id in STATUS ? id : "off") as keyof typeof STATUS;
          const st = STATUS[key];
          return (
            <PanelForm action={actions.status} submit={st.submit} danger={key === "off"} message={`Done · ${st.title}`} onSaved={done}>
              {(s) => (
                <>
                  <input type="hidden" name="status" value={key} />
                  <p className="text-sm text-text-2">{st.body}</p>
                  {key !== "auto" && (
                    <PanelSection className="sm:grid-cols-1">
                      <Field label="Why" htmlFor="st-reason" optional hint="Shown to the company's people" error={s.errors?.reason}>
                        <Input
                          id="st-reason"
                          name="reason"
                          placeholder="Payment late, asked to pause…"
                          defaultValue={text(s, "reason", null)}
                        />
                      </Field>
                    </PanelSection>
                  )}
                </>
              )}
            </PanelForm>
          );
        }}
      </Panel>

      <Panel
        name="extend"
        title={`Extend the ${c.kind === "trial" ? "trial" : "demo"}`}
        description={`${c.name} · from its end, or from now when it already ended`}
      >
        {(done) => (
          <PanelForm action={actions.extend} submit="Extend" message="Extended" onSaved={done}>
            {(s) => (
              <PanelSection first className="sm:grid-cols-1">
                <Field label="More days" htmlFor="ex-days" error={s.errors?.days}>
                  <Input id="ex-days" name="days" type="number" min={1} max={90} defaultValue={text(s, "days", "3")} />
                </Field>
              </PanelSection>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="make-real" title="Make it a client" description={`${c.name} · it stops ending, and payments can be recorded`}>
        {(done) => (
          <PanelForm action={actions.makeReal} submit="Make it a client" message="It is a client now" onSaved={done}>
            {(s) => (
              <>
                <fieldset className="flex flex-col gap-2 text-sm">
                  <legend className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Their data</legend>
                  <label className="flex items-start gap-2">
                    <input type="radio" name="keepData" value="keep" defaultChecked className="mt-1 accent-[var(--color-primary)]" /> Keep
                    everything they made
                  </label>
                  <label className="flex items-start gap-2">
                    <input type="radio" name="keepData" value="clear" className="mt-1 accent-[var(--color-primary)]" /> Start clean
                    (inquiries, customers, orders… removed; people, roles and settings kept)
                  </label>
                </fieldset>
                <PanelSection title="Plan and payment">
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
                </PanelSection>
              </>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="delete" title={`Delete ${c.name}?`} description="All its data and files, for good. A copy is kept in storage first.">
        {(done) => (
          <PanelForm action={actions.remove} submit="Delete the company" danger message="Company deleted" onSaved={done}>
            {(s) => (
              <>
                <p className="text-sm text-text-2">
                  Export it first if anyone may need it. Type <span className="font-mono font-medium text-text">{c.slug}</span> to confirm.
                </p>
                <PanelSection className="sm:grid-cols-1">
                  <Field label="Short name" htmlFor="del-confirm" error={s.errors?.confirm}>
                    <Input id="del-confirm" name="confirm" autoComplete="off" spellCheck={false} defaultValue={text(s, "confirm", null)} />
                  </Field>
                  <Field label="Why" htmlFor="del-reason" optional>
                    <Input id="del-reason" name="reason" defaultValue={text(s, "reason", null)} />
                  </Field>
                </PanelSection>
              </>
            )}
          </PanelForm>
        )}
      </Panel>

      <Panel name="password-link" title="Send a link to set a new password" description={c.name}>
        {(done, id) => {
          const who = c.people.find((p) => p.id === id && p.tenantAdmin) ?? c.people.find((p) => p.tenantAdmin);
          if (!who) return <p className="text-sm text-text-2">This company has no tenant admin.</p>;
          return (
            <PanelForm action={actions.adminPassword} submit="Send the link" message="Link sent" onSaved={done} stay>
              {(s) => (
                <>
                  <input type="hidden" name="userId" value={who.id} />
                  <p className="text-sm text-text-2">
                    <span className="font-medium text-text">{who.name}</span> ({who.email}) gets an email with a link to set a new password.
                    It works once, for 7 days; their current password keeps working until they use it.
                  </p>
                  {s.ok && (s.data as { link?: string } | undefined)?.link && <CopyLink link={(s.data as { link: string }).link} />}
                </>
              )}
            </PanelForm>
          );
        }}
      </Panel>
    </>
  );
}
