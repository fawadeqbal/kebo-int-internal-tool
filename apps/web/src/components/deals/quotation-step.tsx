"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Eye, Lock, Pencil, Plus, Send } from "lucide-react";
import { BASIS_STEP_LABEL, LINE_TYPE_LABEL, LOST_REASON_LABEL, LOST_REASONS, PAYMENT_ROUTES, SENT_VIA, SENT_VIA_LABEL, SENT_VIA_TEXT, type PaymentRoute, type SentVia } from "@kebo/shared";
import { Badge, Button, buttonClass, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PanelButton, ViewCard } from "@/components/orders/step-view";
import { NextCard } from "./inquiry-nav";
import { PANEL_FORM, PanelActions, PanelBody, useClosePanel } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import { money, qty } from "@/lib/format";
import type { OptionView, QuoteOffers, RevisionDraft, RevisionView } from "@/lib/types-deals";
import { shortName } from "./offer-facts";
import { CostingBox, RevisionEditor } from "./revision-editor";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** "USD 63,000.00" without the cents when there are none. */
const total = (v: string, currency: string) => money(v, currency);

/* ---------------------------------------------------------------- the terms panel */

/** The revision's terms (today's editor, terms only) in the Edit side panel; the whole draft is saved. */
export function TermsPanel({
  number,
  initial,
  offers,
  loadOffers,
  showCosts,
  action,
}: {
  number: number;
  initial: RevisionDraft;
  offers: QuoteOffers;
  loadOffers: (currency: string) => Promise<QuoteOffers | null>;
  showCosts: boolean;
  action: Action;
}) {
  const close = useClosePanel();
  return (
    <PanelBody>
      <RevisionEditor
        part="terms"
        action={action}
        number={number}
        initial={initial}
        offers={offers}
        loadOffers={loadOffers}
        showCosts={showCosts}
        submitLabel="Save terms"
        requireChanges
        onDone={close}
        onCancel={close}
      />
    </PanelBody>
  );
}

/* ---------------------------------------------------------------- the options */

const coverText = (o: OptionView) => (!o.factory ? null : o.coverage.missing.length ? `Missing item ${o.coverage.missing.join(", ")}` : "Covers all");

/**
 * "Options" (board InqV4Quotation): the options as cards (name · factory,
 * total, margin, what they cover); the chosen one's lines read only with its
 * totals and the internal costing folded into one line. On a draft: "Price at
 * a margin" / "Edit prices" open today's editor for the options in place, and
 * "+ Add an option" opens it with the offers to add.
 */
export function OptionsCard({
  r,
  edit,
}: {
  r: RevisionView;
  /** The draft's price editor (people who may change it), null otherwise: "Edit prices" turns the page into it. */
  edit: {
    showCosts: boolean;
    /** Another offer (or the customer's items) can still become an option. */
    canAdd: boolean;
    /** The page in price-editing mode (then "&option=1", "&add=1"). */
    pricesHref: string;
  } | null;
}) {
  const [at, setAt] = useState(() => Math.max(0, r.options.findIndex((o) => o.status === "accepted")));
  const o = r.options[Math.min(at, r.options.length - 1)];
  const canAdd = !!edit && edit.canAdd;

  return (
    <ViewCard
      id="options"
      title="Options"
      canEdit={false}
      actions={
        edit ? (
          <>
            <Link href={`${edit.pricesHref}&option=${at}`} className={buttonClass("ghost", "xs")}>
              <Pencil aria-hidden /> Edit lines
            </Link>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {/* Wide: cards side by side; phone: one row each. */}
        <div role="tablist" aria-label="Options" className="grid gap-2 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
          {r.options.map((x, i) => {
            const on = x === o;
            const cover = coverText(x);
            return (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setAt(i)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left transition-colors",
                  on ? "border-primary bg-primary-soft/50 ring-1 ring-primary" : "border-line bg-surface hover:border-line-strong",
                  x.status === "not_chosen" && "opacity-70",
                )}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-semibold" title={x.factory?.name}>
                    {x.letter}
                    {x.factory ? ` · ${shortName(x.factory.name)}` : r.options.length === 1 ? " · the offer" : ""}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular">{total(x.total, r.currency)}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-2">
                  {x.costing?.marginPercent !== null && x.costing?.marginPercent !== undefined && (
                    <span className={cn("tabular", x.costing.marginPercent < 0 && "text-bad")}>margin {x.costing.marginPercent.toFixed(1)}%</span>
                  )}
                  {cover && <Badge tone={x.coverage.missing.length ? "warn" : "ok"}>{cover}</Badge>}
                  {x.status === "accepted" && <Badge tone="ok">Accepted</Badge>}
                  {x.status === "not_chosen" && <Badge tone="neutral">Not chosen</Badge>}
                </span>
              </button>
            );
          })}
          {edit && canAdd && (
            <Link
              href={`${edit.pricesHref}&add=1`}
              className="flex min-h-16 items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong px-3 py-3 text-sm font-medium text-primary hover:border-primary"
            >
              <Plus className="size-4" aria-hidden /> Add an option
            </Link>
          )}
        </div>
        {o && <OptionLines o={o} currency={r.currency} incoterm={r.incoterm} single={r.options.length === 1} />}
      </div>
    </ViewCard>
  );
}

/** One option's lines read only, its totals, and the internal costing folded into one line. */
function OptionLines({ o, currency, incoterm, single }: { o: OptionView; currency: string; incoterm: string; single: boolean }) {
  const costs = !!o.costing;
  const marginOf = (price: string, cost: string | null | undefined) => {
    const p = Number(price);
    const c = cost === null || cost === undefined ? NaN : Number(cost);
    return p > 0 && Number.isFinite(c) ? ((p - c) / p) * 100 : null;
  };
  return (
    <div className="flex flex-col gap-3">
      {/* It can scroll sideways, so Tab stops on it. */}
      <div
        tabIndex={0}
        role="region"
        aria-label={single ? "The lines" : `Option ${o.letter} lines`}
        className="overflow-x-auto rounded-lg border border-line focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-xs text-text-2">
              <th className="w-12 border-b border-line px-2 py-2 text-left font-medium">No.</th>
              <th className="border-b border-l border-line px-2 py-2 text-left font-medium">Description</th>
              <th className="hidden border-b border-l border-line px-2 py-2 text-right font-medium sm:table-cell">Qty</th>
              <th className="hidden border-b border-l border-line px-2 py-2 text-right font-medium whitespace-nowrap sm:table-cell">Unit price {currency}</th>
              <th className="border-b border-l border-line px-2 py-2 text-right font-medium">Total</th>
              {costs && <th className="hidden border-b border-l border-line px-2 py-2 text-right font-medium md:table-cell">Margin</th>}
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => {
              const m = costs ? marginOf(l.unitPrice, l.unitCost) : null;
              return (
                <tr key={l.id} className="border-b border-line last:border-b-0">
                  <td className="px-2 pt-[0.6rem] pb-2 align-top text-xs text-muted tabular">{l.no}</td>
                  <td className={cn("border-l border-line px-2 py-2 align-top", l.no.includes(".") && "pl-5")}>
                    <span className="block whitespace-pre-line">{l.description}</span>
                    {(l.type !== "goods" || l.model) && (
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {l.type !== "goods" && <Badge tone="outline">{LINE_TYPE_LABEL[l.type]}</Badge>}
                        {l.model}
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs text-text-2 tabular sm:hidden">
                      {qty(l.quantity)} {l.unit} × {money(l.unitPrice, currency)}
                    </span>
                  </td>
                  <td className="hidden border-l border-line px-2 py-2 text-right align-top whitespace-nowrap tabular sm:table-cell">
                    {qty(l.quantity)} {l.unit}
                  </td>
                  <td className="hidden border-l border-line px-2 py-2 text-right align-top whitespace-nowrap tabular sm:table-cell">
                    {Number(l.unitPrice).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="border-l border-line px-2 py-2 text-right align-top font-medium whitespace-nowrap tabular">
                    {Number(l.lineTotal).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  {costs && (
                    <td
                      className={cn(
                        "hidden border-l border-line px-2 py-2 text-right align-top tabular md:table-cell",
                        m === null ? "text-muted" : m < 0 ? "text-bad" : m < 5 ? "text-warn" : "text-text-2",
                      )}
                    >
                      {m === null ? "—" : `${m.toFixed(1)}%`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-line px-3 py-2.5 text-sm">
          <span className="text-muted">
            Subtotal <span className="font-semibold text-text tabular">{money(o.subtotal, currency)}</span>
          </span>
          {Number(o.discount) > 0 && (
            <span className="text-muted">
              Discount <span className="font-semibold text-text tabular">− {Number(o.discount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
            </span>
          )}
          <span className="text-muted">
            {single ? "Total" : `Option ${o.letter} total`} <span className="font-semibold text-text tabular">{money(o.total, currency)}</span>
          </span>
        </div>
      </div>
      {o.costing && (
        <details className="group rounded-lg border border-dashed border-money/40 bg-money-soft/40">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-medium text-money">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            <Lock className="size-3.5" aria-hidden /> Internal costing · never printed — cost {money(o.costing.cost, currency)} · profit{" "}
            {money(o.costing.profit, currency)}
            {o.costing.marginPercent !== null ? ` · ${o.costing.marginPercent.toFixed(1)}%` : ""}
          </summary>
          <div className="flex flex-col gap-2 border-t border-dashed border-money/30 p-3 sm:max-w-sm">
            <CostingBox
              currency={currency}
              cost={o.costing.costMinor}
              sales={o.costing.salesMinor}
              profit={o.costing.profitMinor}
              margin={o.costing.marginPercent}
              uncosted={o.costing.uncostedLines}
              extra={o.costing.extraCostMinor}
              extraLabel={`incl. costs to reach ${incoterm}`}
            />
            {o.costs && o.costs.length > 0 && (
              <ul className="text-xs text-muted">
                {o.costs.map((c) => (
                  <li key={c.step} className="flex justify-between gap-2">
                    <span>
                      {BASIS_STEP_LABEL[c.step]}
                      {c.note ? ` · ${c.note}` : ""}
                    </span>
                    <span className="tabular">
                      {money(c.amount, c.currency)}
                      {c.currency !== currency ? ` ≈ ${money(c.cost, currency)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- sending and the answer */

const HOW = SENT_VIA.map((v) => ({ value: v, label: SENT_VIA_LABEL[v] }));

/** Mark as sent: how and when (today unless said). Once sent the revision is frozen. */
function SentForm({ number, action, today, doneHref }: { number: number; action: Action; today: string; doneHref?: string }) {
  const close = useClosePanel();
  const router = useRouter();
  const [how, setHow] = useState<SentVia>("whatsapp");
  // Marked from the send screen: back to the quotation, where the next step (the customer's answer) now is.
  const done = (st: ActionState) => {
    // Saved: close without asking "Discard changes?".
    close(st);
    if (doneHref) router.push(doneHref);
  };
  return (
    <PanelBody>
      <ActionForm action={action} onDone={done} className={PANEL_FORM}>
        {(s) => (
          <>
            <input type="hidden" name="to" value="sent" />
            <input type="hidden" name="via" value={how} />
            <input type="hidden" name="reason" value={`Sent ${SENT_VIA_TEXT[how]}`} />
            <p className="text-sm text-text-2">
              Once marked as sent, R{number} is frozen: a change of price needs a new revision. Check it with View / Print first.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="How" htmlFor="sent-how">
                <Select id="sent-how" value={how} onChange={(e) => setHow(e.target.value as SentVia)}>
                  {HOW.map((h) => (
                    <option key={h.value} value={h.value}>
                      {h.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sent on" htmlFor="sent-on" optional hint="Today when empty" error={s.errors?.on}>
                <Input id="sent-on" name="on" type="date" max={today} defaultValue={s.values?.on} />
              </Field>
            </div>
            <PanelActions>
              <SubmitButton size="sm" pendingText="Saving…">
                <Send aria-hidden /> Mark R{number} as sent
              </SubmitButton>
              <Button size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </PanelActions>
          </>
        )}
      </ActionForm>
    </PanelBody>
  );
}

/** The header's "Mark as sent" (and the answer card's): opens the small panel. */
export function MarkSentButton({
  number,
  action,
  today,
  size = "md",
  variant = "primary",
  className,
  label = "Mark as sent",
  icon = <Send aria-hidden />,
  doneHref,
}: {
  number: number;
  action: Action;
  today: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  label?: string;
  icon?: ReactNode;
  /** Where to go once it is marked (the send screen goes back to the quotation). */
  doneHref?: string;
}) {
  return (
    <PanelButton
      className={className}
      label={label}
      icon={icon}
      size={size}
      variant={variant}
      title={`Mark R${number} as sent`}
      description="How and when it went to the customer."
      body={<SentForm number={number} action={action} today={today} doneHref={doneHref} />}
    />
  );
}

/**
 * "Customer accepted R2" (board QuoteAccept): which option (big cards with
 * lines, lead time and margin), the day, their PO or reference and how they
 * pay, then what happens. It makes the order.
 */
function AcceptForm({
  options,
  currency,
  action,
  today,
  onOrder,
  route,
}: {
  options: OptionView[];
  currency: string;
  action: Action;
  today: string;
  onOrder: (o: { orderId: string; orderRefNo: string }) => void;
  /** The route the quotation's terms imply. */
  route: PaymentRoute | null;
}) {
  const close = useClosePanel();
  const [optionId, setOptionId] = useState(options.length === 1 ? options[0]!.id : (options[0]?.id ?? ""));
  const chosen = options.find((o) => o.id === optionId);
  const others = options.filter((o) => o.id !== optionId);
  const factories = chosen?.factory ? [chosen.factory.name] : [];
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
              <legend className="mb-3 text-[13px] font-semibold">
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
                      {[`${o.lines.length} line${o.lines.length === 1 ? "" : "s"}`, o.leadTime, o.costing?.marginPercent != null ? `margin ${o.costing.marginPercent.toFixed(1)}%` : null].filter(Boolean).join(" · ")}
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
              <Field label="Their PO / reference" htmlFor="accept-ref" error={s.errors?.customerRef}>
                <Input id="accept-ref" name="customerRef" maxLength={80} defaultValue={s.values?.customerRef ?? ""} />
              </Field>
              <Field label="Payment route" htmlFor="accept-route" error={s.errors?.route}>
                <Select id="accept-route" name="route" defaultValue={s.values?.route ?? route ?? "informal"}>
                  {PAYMENT_ROUTES.map((r) => (
                    <option key={r} value={r}>
                      {ROUTE_WORD[r]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {chosen && (
              <div className="rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-text-2">
                <strong className="block text-text">What happens</strong>
                <span className="block">
                  · Sales order <strong className="text-text">SO-{today.slice(0, 4)}-…</strong> is made with Option {chosen.letter}&apos;s lines, prices and terms.
                </span>
                {factories.length > 0 && (
                  <span className="block">
                    · A purchase order is opened for {factories.join(", ")} (sent later, from the order).
                  </span>
                )}
                <span className="block">
                  · {others.length ? `${others.map((o) => `Option ${o.letter}`).join(", ")} ${others.length === 1 ? "is" : "are"} marked “not chosen”; the` : "The"} inquiry becomes{" "}
                  <strong className="text-text">Won</strong>.
                </span>
              </div>
            )}
          </PanelBody>
          <PanelActions className="static mx-0 mb-0 justify-end">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <SubmitButton pendingText="Saving…" disabled={!optionId}>
              <Check aria-hidden /> Accept and make the order
            </SubmitButton>
          </PanelActions>
        </>
      )}
    </ActionForm>
  );
}

/** The payment routes as the accept window says them. */
const ROUTE_WORD: Record<PaymentRoute, string> = { informal: "Bank transfer (informal)", bank_contract: "Bank contract", letter_of_credit: "Letter of credit" };

/** Lost: why (for the reports), and the sent revision recorded as rejected. */
function LostForm({ action, today }: { action: Action; today: string }) {
  const close = useClosePanel();
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className={PANEL_FORM}>
        {(s) => (
          <>
            <Field label="Why was it lost?" htmlFor="lost-reason" error={s.errors?.lostReason}>
              <Select id="lost-reason" name="lostReason" defaultValue={s.values?.lostReason ?? ""}>
                <option value="" disabled>
                  Choose a reason
                </option>
                {LOST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {LOST_REASON_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note" optional htmlFor="lost-note">
              <Textarea id="lost-note" name="note" rows={3} className="min-h-0" defaultValue={s.values?.note} placeholder="e.g. they bought from a Chinese supplier at USD 58k" />
            </Field>
            <Field label="Answered on" htmlFor="lost-on" optional hint="Today when empty" error={s.errors?.on}>
              <Input id="lost-on" name="on" type="date" max={today} className="w-44" defaultValue={s.values?.on} />
            </Field>
            <PanelActions>
              <SubmitButton size="sm" variant="danger" pendingText="Saving…">
                Mark as lost
              </SubmitButton>
              <Button size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </PanelActions>
          </>
        )}
      </ActionForm>
    </PanelBody>
  );
}

/** Expired: the validity passed without an answer. */
function ExpiredForm({ action, today }: { action: Action; today: string }) {
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
            <Field label="Expired on" htmlFor="exp-on" optional hint="Today when empty" error={s.errors?.on}>
              <Input id="exp-on" name="on" type="date" max={today} className="w-44" defaultValue={s.values?.on} />
            </Field>
            <PanelActions>
              <SubmitButton size="sm" pendingText="Saving…">
                Mark expired
              </SubmitButton>
              <Button size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
            </PanelActions>
          </>
        )}
      </ActionForm>
    </PanelBody>
  );
}

/**
 * "Do next" on the Quotations tab, with the working buttons: while a draft is open, Preview and Send R1…;
 * once the customer has it, their answer — Customer accepted… (which option; it makes the order), and
 * beside it the quiet ones: Lost… (why), Revise (the next revision, a copy to change), Expired… when its
 * validity has passed, and a follow-up. After a no: start the next revision.
 */
export function QuotationNext({
  customer,
  quoRef,
  draft,
  live,
  closed,
  currency,
  today,
  answerAction,
  lostAction,
  startNext,
  followUp,
  subtitle,
  route,
}: {
  customer: string;
  /** "QUO-2026-0410". */
  quoRef: string;
  /** The open draft: what Do next says of it, how it prints and where it is sent from (null: this person may not send it). */
  draft: { number: number; meta: string; previewHref: string; sendHref: string | null } | null;
  /** The sent revision waiting for the answer. */
  live: { number: number; options: OptionView[]; meta: string; overdue: boolean } | null;
  /** The last revision was rejected or expired and nothing new is drafted. */
  closed: { number: number; how: "rejected" | "expired" } | null;
  currency: string;
  today: string;
  answerAction: Action | null;
  lostAction: Action | null;
  /** Today's "Start a new revision", opened at once (null: a draft is open, or this person may not). */
  startNext: ReactNode | null;
  /** "Add follow-up". */
  followUp?: ReactNode;
  /** Under the accept window's title: "QUO-2026-0051 · Kabul Medical Supplies". */
  subtitle?: string;
  /** The payment route the quotation's terms imply (the accept window starts on it). */
  route?: PaymentRoute | null;
}) {
  const [order, setOrder] = useState<{ orderId: string; orderRefNo: string } | null>(null);
  const [changes, setChanges] = useState(false);
  if (order)
    return (
      <p className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok-soft px-5 py-4 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden /> Order {order.orderRefNo} was made.{" "}
        <Link href={`/orders/${order.orderId}`} className="font-medium text-primary underline">
          Go to the order
        </Link>
      </p>
    );
  const accept = live && answerAction && (
    <PanelButton
      variant={draft ? "secondary" : "primary"}
      label={draft ? `Customer accepted R${live.number}…` : "Customer accepted…"}
      icon={draft ? undefined : <Check aria-hidden />}
      title={`Customer accepted R${live.number}`}
      description={subtitle ?? "It makes the order from the option they chose."}
      panelClassName="md:w-[760px]"
      body={<AcceptForm options={live.options} currency={currency} action={answerAction} today={today} onOrder={setOrder} route={route ?? null} />}
    />
  );
  if (draft)
    return (
      <div className="flex flex-col gap-2">
        <NextCard title={`Send R${draft.number} to ${customer}`} meta={`${quoRef} · ${draft.meta}`}>
          {accept}
          <a href={draft.previewHref} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md")}>
            <Eye aria-hidden /> Preview
          </a>
          {draft.sendHref && (
            <Link href={draft.sendHref} className={buttonClass("primary", "md")}>
              <Send aria-hidden /> Send R{draft.number}…
            </Link>
          )}
        </NextCard>
        {live && accept && (
          <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
            <AlertTriangle className="size-3.5" aria-hidden /> R{live.number} is still with the customer. Accepting it discards the R{draft.number} draft.
          </p>
        )}
      </div>
    );
  if (live)
    return (
      <div className="flex flex-col gap-3">
        <NextCard title={`Record ${customer}'s answer to R${live.number}`} meta={`${quoRef} · ${live.meta}`} late={live.overdue}>
          {followUp}
          {answerAction && live.overdue && (
            <PanelButton variant="ghost" label="Expired…" title={`R${live.number} expired`} description="No answer before its validity passed." body={<ExpiredForm action={answerAction} today={today} />} />
          )}
          {lostAction && (
            <PanelButton
              variant="secondary"
              label="Lost…"
              title="The customer said no"
              description={`R${live.number} is recorded as rejected and the inquiry as lost.`}
              body={<LostForm action={lostAction} today={today} />}
            />
          )}
          {startNext && (
            <Button variant="secondary" onClick={() => setChanges((v) => !v)} aria-expanded={changes}>
              Revise (R{live.number + 1})
            </Button>
          )}
          {accept}
        </NextCard>
        {changes && startNext && <div className="rounded-xl border border-line bg-surface p-3">{startNext}</div>}
      </div>
    );
  if (closed)
    return (
      <div className="flex flex-col gap-3">
        <NextCard
          title={`R${closed.number} ${closed.how === "rejected" ? "was rejected" : "expired"}`}
          meta={`${quoRef} · try again with R${closed.number + 1} (it starts as a copy of R${closed.number}), or mark the inquiry lost in the panel beside.`}
        />
        {startNext && <div className="rounded-xl border border-line bg-surface p-3">{startNext}</div>}
      </div>
    );
  return null;
}
