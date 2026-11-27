"use client";

import { useState, type ReactNode } from "react";
import { Check, Pencil } from "lucide-react";
import { PAYMENT_ROUTE_LABEL, PAYMENT_ROUTES, type PaymentRoute } from "@kebo/shared";
import { Button, cn, Field, Input, Select, Textarea, RULES } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelBody, SidePanel, useClosePanel, WhatHappens, WindowFooter } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import { money } from "@/lib/format";
import type { OptionView, QuoteOffers, RevisionDraft } from "@/lib/types-deals";
import { RevisionEditor, type QuoteStep } from "./revision-editor";
import type { Failed } from "@/lib/failed";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/* ---------------------------------------------------------------- the terms panel */

/**
 * The quotation's window, the same for "New quotation R1" and "Edit quotation R1": which offers to quote
 * (each ticked one is an option), then the quotation's terms in the groups every offer and order uses
 * (Delivery · Payment · Warranty · Conditions). The whole draft is saved. The prices are not here: they have
 * their own editor (Edit lines).
 */
export function TermsPanel({
  number,
  initial,
  offers,
  loadOffers,
  showCosts,
  action,
  create = false,
  tickAll = false,
  onSaved,
}: {
  number: number;
  initial: RevisionDraft;
  offers: QuoteOffers;
  loadOffers: (currency: string) => Promise<QuoteOffers | Failed | null>;
  showCosts: boolean;
  action: Action;
  /** A new revision ("Save draft"); else an edit of the draft ("Save changes"). */
  create?: boolean;
  /** A first revision: every offer with lines starts ticked. */
  tickAll?: boolean;
  onSaved?: () => void;
}) {
  const close = useClosePanel();
  return (
    <PanelBody>
      <RevisionEditor
        action={action}
        number={number}
        initial={initial}
        offers={offers}
        loadOffers={loadOffers}
        showCosts={showCosts}
        submitLabel={create ? "Save draft" : "Save changes"}
        requireChanges={!create}
        tickAll={tickAll}
        footNote={create ? "A draft is seen only inside the company. It can change until it is sent." : "Once sent, a change needs a new revision."}
        onDone={(state) => {
          close(state);
          onSaved?.();
        }}
        onCancel={() => close()}
      />
    </PanelBody>
  );
}

/**
 * The draft's steps window (design "one way, any number"): Lines · Delivery · Payment · Warranty & conditions,
 * opened on the step whose pencil was tapped; one Save sends every step.
 */
export function QuoteStepsPanel({
  number,
  initial,
  offers,
  loadOffers,
  showCosts,
  action,
  step,
  only = false,
  also,
  onAllSteps,
}: {
  number: number;
  initial: RevisionDraft;
  offers: QuoteOffers;
  loadOffers: (currency: string) => Promise<QuoteOffers | Failed | null>;
  showCosts: boolean;
  action: Action;
  step: QuoteStep;
  /** With `only`: another step in the same window (Delivery & payment). */
  also?: QuoteStep;
  /** Only that part (Edit on one part); when something to fix is in another part, onAllSteps opens every step. */
  only?: boolean;
  onAllSteps?: () => void;
}) {
  const close = useClosePanel();
  return (
    <PanelBody fill>
      <RevisionEditor
        action={action}
        number={number}
        initial={initial}
        offers={offers}
        loadOffers={loadOffers}
        showCosts={showCosts}
        submitLabel="Save"
        requireChanges
        stepsAt={step}
        only={only}
        also={also}
        onAllSteps={onAllSteps}
        onDone={(state) => close(state)}
        onCancel={() => close()}
      />
    </PanelBody>
  );
}

/** A box of the quotation's page: a step, or Delivery & payment (the two steps in one window). */
export type QuoteBox = QuoteStep | "terms";
/** A part's name in its window's title ("Delivery & payment · Q-2611-0007"). */
const PART_TITLE: Record<QuoteBox, string> = { lines: "Prices", delivery: "Delivery", payment: "Payment", terms: "Delivery & payment", warranty: "Warranty & conditions" };

/**
 * Edit, with its word, on the draft (design 17 Nov, edit one part): `only` opens just that part, sized to it,
 * with Cancel and Save (something to fix in another part turns the window into every step). Without `only`
 * (Edit all in ⋯): the steps.
 */
export function QuoteEdit({
  label,
  quoteRef,
  step,
  only = false,
  size = "xs",
  variant = "secondary",
  className,
  ...editor
}: {
  label: ReactNode;
  quoteRef: string;
  step: QuoteBox;
  only?: boolean;
  size?: "xs" | "sm";
  /** A box's Edit is the quiet green one (ghost). */
  variant?: "secondary" | "ghost";
  className?: string;
  number: number;
  initial: RevisionDraft;
  offers: QuoteOffers;
  loadOffers: (currency: string) => Promise<QuoteOffers | Failed | null>;
  showCosts: boolean;
  action: Action;
}) {
  const [open, setOpen] = useState(false);
  const [one, setOne] = useState(only);
  const width =
    !one || step === "lines" ? RULES.window.items : step === "warranty" ? RULES.window.part : step === "payment" ? RULES.window.table : RULES.window.wideRows;
  const at: QuoteStep = step === "terms" ? "delivery" : step;
  return (
    <>
      <Button size={size} variant={variant} onClick={() => (setOne(only), setOpen(true))} className={className}>
        <Pencil aria-hidden /> {label}
      </Button>
      {open && (
        <SidePanel title={one ? `${PART_TITLE[step]} · ${quoteRef}` : `Edit · ${quoteRef}`} description="Draft" onClose={() => setOpen(false)} className={width}>
          <QuoteStepsPanel {...editor} step={at} also={step === "terms" ? "payment" : undefined} only={one} onAllSteps={() => setOne(false)} />
        </SidePanel>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- the options */

/* ---------------------------------------------------------------- sending and the answer */

/**
 * "Customer accepted R2" (board QuoteAccept): which option (big cards with
 * lines, lead time and margin), the day, their PO or reference and how they
 * pay, then what happens. It makes the order.
 */
export function AcceptForm({
  options,
  currency,
  action,
  today,
  onOrder,
  route,
  others = [],
}: {
  options: OptionView[];
  currency: string;
  action: Action;
  today: string;
  onOrder: (o: { orderId: string; orderRefNo: string }) => void;
  /** The route the quotation's terms imply. */
  route: PaymentRoute | null;
  /** The deal's other quotations the customer has: they become "Not chosen". */
  others?: string[];
}) {
  const close = useClosePanel();
  const [optionId, setOptionId] = useState(options.length === 1 ? options[0]!.id : (options[0]?.id ?? ""));
  const chosen = options.find((o) => o.id === optionId);
  const rest = options.filter((o) => o.id !== optionId);
  const suppliers = chosen?.factory ? [chosen.factory.name] : [];
  return (
    <ActionForm
      action={action}
      onDone={(s) => {
        const data = s.data as { orderId?: string; orderRefNo?: string } | undefined;
        if (data?.orderId && data.orderRefNo) onOrder({ orderId: data.orderId, orderRefNo: data.orderRefNo });
        close();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      {(s) => (
        <>
          <input type="hidden" name="to" value="accepted" />
          <input type="hidden" name="optionId" value={optionId} />
          <PanelBody className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-md font-semibold">
                Which option did they accept?<span className="text-bad"> *</span>
              </legend>
              {options.map((o) => (
                <label
                  key={o.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3.5 rounded-xl border px-4 py-3.5",
                    optionId === o.id ? "border-2 border-primary bg-primary-soft/40" : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  <input type="radio" name="option-choice" checked={optionId === o.id} onChange={() => setOptionId(o.id)} className="size-[18px] accent-[var(--color-primary)]" />
                  <span className="min-w-0 flex-1">
                    <strong className="block text-base">
                      Option {o.letter}
                      {o.factory ? ` · ${o.factory.name}` : ""}
                    </strong>
                    <span className="block text-xs text-muted">
                      {[`${o.lines.length} item${o.lines.length === 1 ? "" : "s"}`, o.leadTime, o.costing?.marginPercent != null ? `margin ${o.costing.marginPercent.toFixed(1)}%` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <strong className="text-base whitespace-nowrap tabular">{money(o.total, currency)}</strong>
                </label>
              ))}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Accepted on" htmlFor="accept-on" required error={s.errors?.on}>
                <Input id="accept-on" name="on" type="date" max={today} defaultValue={s.values?.on ?? today} />
              </Field>
              <Field label="Customer's order no. / reference" htmlFor="accept-ref" error={s.errors?.customerRef}>
                <Input id="accept-ref" name="customerRef" maxLength={80} defaultValue={s.values?.customerRef ?? ""} />
              </Field>
              <Field label="Payment route" htmlFor="accept-route" error={s.errors?.route}>
                <Select id="accept-route" name="route" defaultValue={s.values?.route ?? route ?? "informal"}>
                  {PAYMENT_ROUTES.map((r) => (
                    <option key={r} value={r}>
                      {PAYMENT_ROUTE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {chosen && (
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-md text-text-2">
                <strong className="block text-text">What happens</strong>
                <span className="block">
                  · Sales order <strong className="text-text">SO-{today.slice(0, 4)}-…</strong> is made with Option {chosen.letter}&apos;s items, prices and terms.
                </span>
                {suppliers.length > 0 && (
                  <span className="block">
                    · A purchase order is opened for {suppliers.join(", ")} (sent later, from the order).
                  </span>
                )}
                {others.length > 0 && (
                  <span className="block">
                    · {others.join(", ")} {others.length === 1 ? "becomes" : "become"} <strong className="text-text">Not chosen</strong>, kept as sent.
                  </span>
                )}
                <span className="block">
                  · {rest.length ? `${rest.map((o) => `Option ${o.letter}`).join(", ")} ${rest.length === 1 ? "is" : "are"} marked “not chosen”; the` : "The"} inquiry becomes{" "}
                  <strong className="text-text">Won</strong>.
                </span>
              </div>
            )}
          </PanelBody>
          <WindowFooter outside>
            <SubmitButton pendingText="Saving…" disabled={!optionId}>
              <Check aria-hidden /> Accept and make the order
            </SubmitButton>
          </WindowFooter>
        </>
      )}
    </ActionForm>
  );
}


/** Expired: the validity passed without an answer. */
export function ExpiredForm({ action, today, number }: { action: Action; today: string; number: number }) {
  const close = useClosePanel();
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className={PANEL_FORM}>
        {(s) => (
          <>
            <input type="hidden" name="to" value="expired" />
            <Field label="Why" htmlFor="exp-reason" error={s.errors?.reason}>
              <Textarea id="exp-reason" name="reason" rows={2} className="min-h-0" defaultValue={s.values?.reason ?? "No answer before the validity passed"} />
            </Field>
            <Field label="Expired on" htmlFor="exp-on" optional error={s.errors?.on}>
              <Input id="exp-on" name="on" type="date" max={today} className="w-44" defaultValue={s.values?.on} />
            </Field>
            <WhatHappens lines={[<>R{number} is marked <strong>Expired</strong>.</>, "The inquiry stays open.", `“Do next” becomes “Start R${number + 1} from R${number}”.`]} />
            <WindowFooter>
              <SubmitButton pendingText="Saving…">
                Mark R{number} expired
              </SubmitButton>
            </WindowFooter>
          </>
        )}
      </ActionForm>
    </PanelBody>
  );
}

