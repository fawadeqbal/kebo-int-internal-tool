"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Lock, Plus, Send } from "lucide-react";
import { BASIS_STEP_LABEL, LINE_TYPE_LABEL, LOST_REASON_LABEL, LOST_REASONS } from "@kebo/shared";
import { Badge, Button, cn, Field, Input, Select, Textarea } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelActions, PanelBody, PanelButton, useClosePanel, ViewCard } from "@/components/orders/step-view";
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
  /** The draft's editor (people who may change it), null otherwise. */
  edit: {
    initial: RevisionDraft;
    offers: QuoteOffers;
    loadOffers: (currency: string) => Promise<QuoteOffers | null>;
    showCosts: boolean;
    action: Action;
  } | null;
}) {
  const [at, setAt] = useState(() => Math.max(0, r.options.findIndex((o) => o.status === "accepted")));
  const [editing, setEditing] = useState<null | "prices" | "add">(null);
  const o = r.options[Math.min(at, r.options.length - 1)];
  const canAdd = !!edit && (edit.offers.offers.length + 1 > r.options.length);

  if (editing && edit)
    return (
      <ViewCard
        id="options"
        title={`R${r.number} · options and prices`}
        description="Prices, discounts, charges and costs to reach our basis. Saving keeps the draft; the terms are saved as they are."
        canEdit={false}
      >
        <div className="p-4">
          <RevisionEditor
            part="options"
            action={edit.action}
            number={r.number}
            initial={edit.initial}
            offers={edit.offers}
            loadOffers={edit.loadOffers}
            showCosts={edit.showCosts}
            submitLabel={`Save R${r.number}`}
            requireChanges
            initialOption={editing === "add" ? 0 : at}
            startAdding={editing === "add"}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </div>
      </ViewCard>
    );

  return (
    <ViewCard
      id="options"
      title="Options"
      canEdit={false}
      actions={
        edit ? (
          <>
            {edit.showCosts && (
              <Button size="xs" variant="ghost" onClick={() => setEditing("prices")}>
                Price at a margin
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={() => setEditing("prices")}>
              Edit prices
            </Button>
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
            <button
              type="button"
              onClick={() => setEditing("add")}
              className="flex min-h-16 items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong px-3 py-3 text-sm font-medium text-primary hover:border-primary"
            >
              <Plus className="size-4" aria-hidden /> Add an option
            </button>
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
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-sm" aria-label={single ? "The lines" : `Option ${o.letter} lines`}>
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

const HOW = ["WhatsApp", "Email", "WeChat", "In person", "Other"];

/** Mark as sent: how and when (today unless said). Once sent the revision is frozen. */
function SentForm({ number, action, today }: { number: number; action: Action; today: string }) {
  const close = useClosePanel();
  const [how, setHow] = useState(HOW[0]!);
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className={PANEL_FORM}>
        {(s) => (
          <>
            <input type="hidden" name="to" value="sent" />
            <input type="hidden" name="reason" value={`By ${how}`} />
            <p className="text-sm text-text-2">
              Once marked as sent, R{number} is frozen: a change of price needs a new revision. Check it with View / Print first.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="How" htmlFor="sent-how">
                <Select id="sent-how" value={how} onChange={(e) => setHow(e.target.value)}>
                  {HOW.map((h) => (
                    <option key={h} value={h}>
                      {h}
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
}: {
  number: number;
  action: Action;
  today: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
  className?: string;
}) {
  return (
    <PanelButton
      className={className}
      label="Mark as sent"
      icon={<Send aria-hidden />}
      size={size}
      variant={variant}
      title={`Mark R${number} as sent`}
      description="How and when it went to the customer."
      body={<SentForm number={number} action={action} today={today} />}
    />
  );
}

/** Accepted: which option (when there are several) and when; it makes the order. */
function AcceptForm({ number, options, currency, action, today, onOrder }: { number: number; options: OptionView[]; currency: string; action: Action; today: string; onOrder: (o: { orderId: string; orderRefNo: string }) => void }) {
  const close = useClosePanel();
  const [optionId, setOptionId] = useState(options.length === 1 ? options[0]!.id : "");
  return (
    <PanelBody>
      <ActionForm
        action={action}
        onDone={(s) => {
          const data = s.data as { orderId?: string; orderRefNo?: string } | undefined;
          if (data?.orderId && data.orderRefNo) onOrder({ orderId: data.orderId, orderRefNo: data.orderRefNo });
          close();
        }}
        className={PANEL_FORM}
      >
        {(s) => (
          <>
            <input type="hidden" name="to" value="accepted" />
            <input type="hidden" name="optionId" value={optionId} />
            {options.length > 1 && (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm font-medium">Which option did they accept?</legend>
                {options.map((o) => (
                  <label
                    key={o.id}
                    className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm", optionId === o.id ? "border-primary bg-primary-soft" : "border-line bg-surface")}
                  >
                    <input type="radio" name="option-choice" checked={optionId === o.id} onChange={() => setOptionId(o.id)} className="accent-[var(--color-primary)]" />
                    <span className="flex-1">
                      <span className="font-semibold">Option {o.letter}</span>
                      {o.factory && <span className="text-text-2"> · {o.factory.name}</span>}
                    </span>
                    <span className="tabular">{money(o.total, currency)}</span>
                  </label>
                ))}
                <p className="text-xs text-muted">The other options are marked not chosen. The order is made from this option only.</p>
              </fieldset>
            )}
            <Field label="Answered on" htmlFor="accept-on" optional hint="Today when empty" error={s.errors?.on}>
              <Input id="accept-on" name="on" type="date" max={today} className="w-44" defaultValue={s.values?.on} />
            </Field>
            <PanelActions>
              <SubmitButton size="sm" pendingText="Saving…" disabled={!optionId}>
                {options.length > 1 ? (optionId ? `Option ${options.find((o) => o.id === optionId)!.letter} accepted: make the order` : "Choose an option") : `R${number} accepted: make the order`}
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
 * "Sending and the answer": while a draft is open, Mark as sent; once the
 * customer has it, their answer — Accepted… (makes the order), Asked for
 * changes… (the next revision, a copy to change), Lost… (why), or expired.
 */
export function AnswerCard({
  draft,
  live,
  currency,
  today,
  sendAction,
  answerAction,
  lostAction,
  startNext,
}: {
  /** The open draft (Mark as sent), with its number. */
  draft: { number: number } | null;
  /** The sent revision waiting for the answer. */
  live: { number: number; options: OptionView[]; validUntil: string; overdue: boolean } | null;
  currency: string;
  today: string;
  sendAction: Action | null;
  answerAction: Action | null;
  lostAction: Action | null;
  /** "Asked for changes…": today's Start a new revision, opened at once. Null when a draft is already open. */
  startNext: ReactNode | null;
}) {
  const [order, setOrder] = useState<{ orderId: string; orderRefNo: string } | null>(null);
  const [changes, setChanges] = useState(false);
  if (order)
    return (
      <ViewCard id="answer" title="Sending and the answer" canEdit={false}>
        <p className="flex items-center gap-2 px-4 py-4 text-sm">
          <CheckCircle2 className="size-4 text-ok" aria-hidden /> Order {order.orderRefNo} was made.{" "}
          <Link href={`/orders/${order.orderId}`} className="font-medium text-primary underline">
            Go to the order
          </Link>
        </p>
      </ViewCard>
    );
  return (
    <ViewCard id="answer" title="Sending and the answer" canEdit={false}>
      <div className="flex flex-col gap-3 px-4 py-4">
        {draft && (
          <p className="text-sm text-text-2">
            When R{draft.number} goes out: <b className="text-text">Mark as sent</b> (how and when).{" "}
            {live ? `The customer's answer to R${live.number} still goes here.` : "After that the customer's answer goes here."}
          </p>
        )}
        {!draft && live && (
          <p className="text-sm text-text-2">
            R{live.number} is with the customer
            {live.overdue ? (
              <span className="font-medium text-warn"> and its validity has passed: ask them, then start a new revision or mark it expired.</span>
            ) : (
              <>: follow up, then record their answer.</>
            )}
          </p>
        )}
        {!draft && !live && <p className="text-sm text-muted">Nothing is waiting for an answer.</p>}
        {(draft && sendAction) || (live && answerAction) ? (
          <div className="flex flex-wrap items-center gap-2">
            {draft && sendAction && !live && <MarkSentButton number={draft.number} action={sendAction} today={today} size="sm" variant="secondary" />}
            {live && answerAction && (
              <>
                <PanelButton
                  size="sm"
                  variant="secondary"
                  label="Accepted…"
                  title={`R${live.number} accepted`}
                  description="It makes the order from the option they chose."
                  body={<AcceptForm number={live.number} options={live.options} currency={currency} action={answerAction} today={today} onOrder={setOrder} />}
                />
                {startNext && (
                  <Button size="sm" variant="ghost" onClick={() => setChanges((v) => !v)} aria-expanded={changes}>
                    Asked for changes…
                  </Button>
                )}
                {lostAction && (
                  <PanelButton
                    size="sm"
                    variant="ghost"
                    label="Lost…"
                    title="The customer said no"
                    description={`R${live.number} is recorded as rejected and the inquiry as lost.`}
                    body={<LostForm action={lostAction} today={today} />}
                  />
                )}
                <PanelButton
                  size="sm"
                  variant="ghost"
                  label="Expired…"
                  title={`R${live.number} expired`}
                  description="No answer before its validity passed."
                  body={<ExpiredForm action={answerAction} today={today} />}
                />
              </>
            )}
          </div>
        ) : null}
        {draft && live && sendAction && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <AlertTriangle className="size-3.5" aria-hidden /> Accepting R{live.number} discards the R{draft.number} draft.
          </p>
        )}
        {changes && startNext && <div className="rounded-xl border border-line bg-surface-2/40 p-3">{startNext}</div>}
      </div>
    </ViewCard>
  );
}
