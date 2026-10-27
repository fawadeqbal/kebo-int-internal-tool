"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Clock, Download, FilePlus2, Printer, Send, XCircle } from "lucide-react";
import { Button, buttonClass, cn, Field, Input } from "@kebo/ui";
import { money } from "@/lib/format";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import type { ActionState } from "@/lib/actions";
import type { OptionView, QuoteOffers, RevisionDraft } from "@/lib/types-deals";
import { RevisionEditor } from "./revision-editor";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** "Start a new revision": opens the editor with the API's starting values (a copy of the latest, or R1 from factory costs). */
export function StartRevision({
  action,
  draft,
  offers,
  loadOffers,
  allowed,
  whyNot,
  showCosts,
  first,
}: {
  action: Action;
  draft: RevisionDraft | null;
  offers: QuoteOffers | null;
  loadOffers: (currency: string) => Promise<QuoteOffers | null>;
  allowed: boolean;
  whyNot: string | null;
  showCosts: boolean;
  first: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = first ? "Make the quotation (R1)" : `Start a new revision${draft ? ` (R${draft.number})` : ""}`;
  // Nothing to offer yet: no factory offer with lines, and no list from the customer to price by hand.
  const nothing = !!offers && offers.offers.length === 0 && offers.items.length === 0;
  if (nothing)
    return (
      <p className="text-sm text-muted">
        Add a factory offer with its lines on the Factory prices tab first; each offer becomes an option the customer can choose.
      </p>
    );
  if (!open || !draft || !offers)
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button variant={first ? "primary" : "secondary"} onClick={() => setOpen(true)} disabled={!allowed || !draft || !offers} aria-describedby={!allowed && whyNot ? "why-not-start" : undefined}>
          <FilePlus2 aria-hidden /> {label}
        </Button>
        {!allowed && whyNot && (
          <p id="why-not-start" className="text-xs text-muted">
            {whyNot}
          </p>
        )}
      </div>
    );
  return (
    <div className="w-full rounded-xl border border-primary/30 bg-primary-soft/20 p-4">
      <h3 className="mb-1 text-sm font-semibold">New revision R{draft.number}</h3>
      <p className="mb-4 text-xs text-muted">{first ? "Starts with the factory offer that covers the most at the lowest cost, priced at the default margin. Add more offers as Options B, C… for the customer to choose from." : "Starts as a copy of the latest revision. Change what is different, then save the draft."}</p>
      <RevisionEditor action={action} number={draft.number} initial={draft} offers={offers} loadOffers={loadOffers} showCosts={showCosts} submitLabel={`Save R${draft.number} as a draft`} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />
    </div>
  );
}

/** The open draft: edit it, send it, or throw it away. */
export function DraftPanel({
  number,
  initial,
  offers,
  loadOffers,
  showCosts,
  saveAction,
  deleteAction,
  moveAction,
  printHref,
  pdfHref,
  today,
}: {
  number: number;
  initial: RevisionDraft;
  offers: QuoteOffers;
  loadOffers: (currency: string) => Promise<QuoteOffers | null>;
  showCosts: boolean;
  saveAction: Action;
  deleteAction: Action;
  moveAction: Action;
  printHref: string;
  pdfHref: string;
  today: string;
}) {
  return (
    <RevisionEditor
      action={saveAction}
      number={number}
      initial={initial}
      offers={offers}
      loadOffers={loadOffers}
      showCosts={showCosts}
      submitLabel="Save draft"
      requireChanges
      footer={(dirty) => (
        <div className="mt-5 flex flex-col gap-4 border-t border-line pt-4 lg:flex-row lg:items-end lg:justify-between">
          <ActionForm action={moveAction} className="flex flex-wrap items-end gap-2">
            {(s) => (
              <>
                <input type="hidden" name="to" value="sent" />
                <Field label="Sent on" htmlFor={`sent-on-${number}`} optional hint="Today when empty" error={s.errors?.on}>
                  <Input id={`sent-on-${number}`} name="on" type="date" max={today} className="w-40" defaultValue={s.values?.on} />
                </Field>
                <div className="flex flex-col gap-1">
                  <ConfirmSubmit variant="primary" pendingText="Saving…" disabled={dirty} message={`Mark R${number} as sent? It can no longer be changed; a price change will need a new revision.`}>
                    <Send aria-hidden /> Mark as sent
                  </ConfirmSubmit>
                </div>
                {dirty && <p className="w-full text-xs text-warn">Save the draft first, so the customer gets what you see.</p>}
              </>
            )}
          </ActionForm>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={printHref} target="_blank" className={buttonClass("secondary")}>
              <Printer aria-hidden /> Preview
            </Link>
            <a href={pdfHref} className={buttonClass("secondary")}>
              <Download aria-hidden /> Download PDF
            </a>
            <ActionForm action={deleteAction} showSuccess={false}>
              <ConfirmSubmit variant="danger-ghost" pendingText="Deleting…" message={`Delete the R${number} draft? This cannot be undone.`}>
                Delete draft
              </ConfirmSubmit>
            </ActionForm>
          </div>
        </div>
      )}
    />
  );
}

const ANSWERS = [
  { to: "accepted", label: "Customer accepted", icon: CheckCircle2, variant: "primary" as const },
  { to: "rejected", label: "Customer rejected", icon: XCircle, variant: "secondary" as const },
  { to: "expired", label: "Mark expired", icon: Clock, variant: "ghost" as const },
];

/** The customer's answer on the live sent revision. Accepting means choosing exactly one option; it creates the order. */
export function AnswerPanel({ number, action, today, options, currency }: { number: number; action: Action; today: string; options: OptionView[]; currency: string }) {
  const [to, setTo] = useState<string | null>(null);
  const [optionId, setOptionId] = useState<string>(options.length === 1 ? options[0]!.id : "");
  const [order, setOrder] = useState<{ orderId: string; orderRefNo: string } | null>(null);
  const chosen = ANSWERS.find((a) => a.to === to);
  if (order)
    return (
      <p className="text-sm">
        Order {order.orderRefNo} was created.{" "}
        <Link href={`/orders/${order.orderId}`} className="font-medium text-primary underline">
          Go to the order
        </Link>
      </p>
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {ANSWERS.map((a) => (
          <Button key={a.to} size="sm" variant={a.variant} onClick={() => setTo(to === a.to ? null : a.to)} aria-pressed={to === a.to}>
            <a.icon aria-hidden /> {a.label}
          </Button>
        ))}
      </div>
      {chosen && (
        <ActionForm
          action={action}
          onDone={(s) => {
            const data = s.data as { orderId?: string; orderRefNo?: string } | undefined;
            if (data?.orderId && data.orderRefNo) setOrder({ orderId: data.orderId, orderRefNo: data.orderRefNo });
            setTo(null);
          }}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface-2/60 p-3"
        >
          {(s) => (
            <>
              <input type="hidden" name="to" value={chosen.to} />
              {chosen.to === "accepted" && options.length > 1 && (
                <fieldset className="w-full">
                  <legend className="mb-1.5 text-sm font-medium">Which option did the customer accept?</legend>
                  <div className="flex flex-wrap gap-2">
                    {options.map((o) => (
                      <label key={o.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", optionId === o.id ? "border-primary bg-primary-soft" : "border-line bg-surface")}>
                        <input type="radio" name="optionId" value={o.id} checked={optionId === o.id} onChange={() => setOptionId(o.id)} className="accent-[var(--color-primary)]" />
                        <span>
                          <span className="font-semibold">Option {o.letter}</span> <span className="tabular">{money(o.total, currency)}</span>
                          {o.factory && <span className="block text-xs text-muted">{o.factory.name}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted">The other options are marked not chosen. The order is made from this option only.</p>
                </fieldset>
              )}
              {chosen.to === "accepted" && options.length === 1 && <input type="hidden" name="optionId" value={options[0]!.id} />}
              <Field label={chosen.to === "expired" ? "Expired on" : "Answered on"} htmlFor={`answer-on-${number}`} optional hint="Today when empty" error={s.errors?.on}>
                <Input id={`answer-on-${number}`} name="on" type="date" max={today} className="w-40" defaultValue={s.values?.on} />
              </Field>
              <div className="flex gap-2">
                <SubmitButton size="md" variant={chosen.to === "accepted" ? "primary" : "secondary"} pendingText="Saving…" disabled={chosen.to === "accepted" && !optionId}>
                  {chosen.to === "accepted" ? `Confirm: ${options.length > 1 ? (optionId ? `Option ${options.find((o) => o.id === optionId)!.letter}` : "choose an option") : `R${number}`} accepted, create the order` : chosen.to === "rejected" ? "Confirm the rejection" : "Confirm expired"}
                </SubmitButton>
                <Button variant="ghost" onClick={() => setTo(null)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
