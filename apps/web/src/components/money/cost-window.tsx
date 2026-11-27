"use client";

import { FileZone } from "@/components/common/file-zone";
import { ChoiceChips } from "@/components/common/choice-chips";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Copy, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  EXPENSE_BEARER_HINT,
  EXPENSE_BEARER_LABEL,
  EXPENSE_BEARERS,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  INQUIRY_STAGE_LABEL,
  ORDER_EXPENSE_CHIPS,
  type ExpenseBearer,
  type ExpenseCategory,
  type InquiryStage,
} from "@kebo/shared";
import { Button, cn, Field, Input, Select, Textarea, Notice, RULES, linkClass } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { CurrencySelect } from "@/components/common/currency-select";
import { ConfirmDialog } from "@/components/common/dialog";
import { MoneyInput } from "@/components/common/money-input";
import { PANEL_FORM, PanelBody, SidePanel, WhatHappens, WindowCancelIn, WindowFooter } from "@/components/common/panel";
import { useWindowDone } from "@/components/common/route-window";
import { costChoicesAction, expenseAction, submitCostAction, voidExpenseAction } from "@/app/(app)/money/actions";
import type { ActionState } from "@/lib/actions";
import { money } from "@/lib/format";
import { useTime } from "@/lib/time-client";
import { rateOf, type Fx } from "@/lib/fx";
import type { Person } from "@/lib/types";
import type { ExpenseView } from "@/lib/types-money";
import { AccountSelect, RecordedBy, useMe } from "./accounts";
import { useSaveThenSend } from "./attachment";
import { COMPANY, costKind } from "./cost-kinds";
import { failedWhenRejected, isFailed } from "@/lib/failed";

/*
 * The one cost window (design "spending", board CostWindow): every place that adds or changes a cost opens it,
 * with the same fields in the same order and the same words. Opened from a record it already knows what the
 * cost is for (shown, with Change); from Record payment or Home it is chosen first. The kinds offered fit the
 * place; Repeats only for the company, Who bears it only on an order, Supplier visited for trips and checks.
 */

/** Who a cost is for: the company's own, spent on a customer, on one of their inquiries (won or lost), or on one order. */
export type CostPlace = "company" | "customer" | "deal" | "order";

/** What a cost is for, when the window is opened from a record. */
export interface CostFor {
  place: CostPlace;
  /** The order, inquiry or customer (none for the company). */
  id: string | null;
  /** The customer of the inquiry or the order. */
  customerId?: string | null;
  /** In words: "Order SO-2026-0035 · Kabul Medical Supplies". */
  label: string;
}

/** What "For" can choose (GET /expenses/targets); on a customer's page only theirs. */
export interface ExpenseChoices {
  customers: { id: string; name: string }[];
  deals: { id: string; refNo: string; title: string; stage: InquiryStage; customerId: string; customer: string }[];
  orders: { id: string; refNo: string; dealId: string; customerId: string; customer: string }[];
  factories: { id: string; name: string }[];
  /** On a customer's page: the cost is always on this customer (or one of their inquiries or orders). */
  customerId?: string;
}

/** What the window needs from the page that opens it. */
export interface CostSetup {
  mainCurrency: string;
  fx: Fx;
  today: string;
  people: Person[];
  /** What it is for; null: chosen in the window. */
  for: CostFor | null;
  /**
   * Opened from an order: its currency, the suppliers on it (one of them can bear a cost), and its margin now
   * (the costed value and the profit, in its currency; the floor from Settings) to say when a cost makes it thin.
   */
  order?: { currency: string; factories: { id: string; name: string }[]; margin?: { value: string; profit: string; floor: number } | null };
  /** What "For" can choose; loaded when the window opens when not given. */
  choices?: ExpenseChoices;
}

/** A cost being changed, or copied ("Add again"): the order's view and the general one both carry these. */
export type CostToChange = Pick<
  ExpenseView,
  "id" | "category" | "description" | "amount" | "currency" | "rate" | "spentOn" | "paidBy" | "reference" | "note" | "receipt" | "borneBy" | "ownMoney" | "payLater" | "payee" | "repaid" | "factory" | "account" | "updatedAt"
> & { repeats?: boolean };

/** A month of a cost that comes every month, to confirm with what was paid. */
export interface CostToConfirm {
  key: string;
  category: ExpenseCategory;
  description: string;
  amount: string;
  currency: string;
  account: { id: string; name: string } | null;
  /** The day it is paid on (today when that day has not come yet). */
  on: string;
}

/* ---------------------------------------------------------------- words */

/** The kinds each place offers as chips; "More kinds" shows all of them. */
const PLACE_KINDS: Record<CostPlace, readonly ExpenseCategory[]> = {
  order: ORDER_EXPENSE_CHIPS,
  deal: ["travel", "hotel", "meals", "samples", "gifts", "courier", "inspection", "commission", "other"],
  customer: ["meals", "gifts", "samples", "travel", "hotel", "courier", "commission", "other"],
  company: ["rent", "salaries", "office", "utilities", "travel", "meals", "bank_charges", "other"],
};
const DEFAULT_KIND: Record<CostPlace, ExpenseCategory> = { company: "rent", customer: "meals", deal: "travel", order: "freight" };
/** Kinds that are a visit: the window asks which supplier. */
const VISITS: readonly ExpenseCategory[] = ["travel", "hotel", "meals", "inspection"];



const PLACE_HINT: Record<CostPlace, string> = {
  company: "Rent, salaries, bills and other costs of running the company.",
  customer: "Dinners, gifts and visits for the customer, not for one inquiry.",
  deal: "Trips to check products, samples and visits for one request. Won: it shows on the order as spent before it. Lost: it is what losing it cost.",
  order: "Freight, inspection, customs, trips: it counts on the order.",
};

/** How a cost stands: a bill to pay later, paid now from one of our accounts, or paid by someone from their own money. */
type PaidHow = "later" | "now" | "own";
const PAID_LABEL: Record<PaidHow, string> = { later: "Not yet", now: "Paid now", own: "Their own money" };

const num = (v: string) => Number(v.replace(/,/g, "").trim());
const rateText = (r: number) => String(Number(r.toFixed(4)));

const chip = (on: boolean) =>
  cn(
    "h-8 rounded-full border px-3 text-md font-medium transition-colors",
    on ? "border-primary bg-primary-soft font-semibold text-primary" : "border-line bg-surface text-text-2 hover:border-line-strong hover:text-text",
  );


function GroupLabel({ id, children, optional }: { id: string; children: ReactNode; optional?: boolean }) {
  return (
    <span id={id} className="flex items-baseline gap-1.5 text-sm font-medium text-text">
      {children}
      {optional && <span className="text-xs font-normal text-muted">optional</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- the form */

type Mode =
  | { kind: "new"; template?: CostToChange & { for?: CostFor } }
  | { kind: "change"; expense: CostToChange }
  | { kind: "confirm"; month: CostToConfirm }
  /** Staff: sent for a manager to approve, on the company or one of these orders. */
  | { kind: "send"; orders: { id: string; refNo: string; customer: string }[]; ordersFailed?: boolean };

/**
 * The fields of a cost and its buttons. In a window of its own (AddCost, ChangeCost) or inside Record payment.
 * `onSaved`: saved (the window closes).
 */
export function CostForm({
  setup,
  mode,
  inPanel = false,
  onSaved,
  onFileError,
  onRemove,
}: {
  setup: CostSetup;
  mode: Mode;
  /** In a window of its own: Cancel closes it. */
  inPanel?: boolean;
  onSaved?: () => void;
  onFileError?: (message: string) => void;
  /** Change: "Remove this cost…" in the footer. */
  onRemove?: () => void;
}) {
  const { date } = useTime();
  const me = useMe();
  const inWindow = useWindowDone() !== null;
  const s0 = setup;
  const send = mode.kind === "send" ? mode : null;
  const expense = mode.kind === "change" ? mode.expense : null;
  const template = mode.kind === "new" ? mode.template : undefined;
  const month = mode.kind === "confirm" ? mode.month : null;
  const from: Partial<CostToChange> | null = expense ?? template ?? null;
  const start = template?.for ?? (month ? COMPANY : s0.for);
  const isMe = (id: string) => s0.people.some((p) => p.id === id);
  const meId = me.id && (isMe(me.id) || send) ? me.id : "";

  // For: from the record it was opened on, or chosen here.
  const [choosing, setChoosing] = useState(!start);
  const [place, setPlaceRaw] = useState<CostPlace>(start?.place ?? "company");
  const [customerId, setCustomerId] = useState(s0.choices?.customerId ?? start?.customerId ?? (start?.place === "customer" ? (start.id ?? "") : ""));
  const [dealId, setDealId] = useState(start?.place === "deal" ? (start.id ?? "") : "");
  const [orderId, setOrderId] = useState(start?.place === "order" ? (start.id ?? "") : "");
  const [choices, setChoices] = useState<ExpenseChoices | null>(
    send ? { customers: [], deals: [], orders: send.orders.map((o) => ({ id: o.id, refNo: o.refNo, dealId: "", customerId: "", customer: o.customer })), factories: [] } : (s0.choices ?? null),
  );
  const [loading, startLoading] = useTransition();
  // Not read: said where the loading line was (the cost can still go on the company).
  const [choicesFailed, setChoicesFailed] = useState<string | null>(null);
  useEffect(() => {
    if (choices || send) return;
    startLoading(async () => {
      const c = await costChoicesAction().catch(failedWhenRejected("the customers, inquiries, orders and suppliers"));
      if (isFailed(c)) setChoicesFailed(c.what);
      else if (c) setChoices(s0.choices?.customerId ? { ...c, customerId: s0.choices.customerId } : c);
    });
    // Once, when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What for.
  const [category, setCategory] = useState<ExpenseCategory>(from?.category ?? month?.category ?? DEFAULT_KIND[start?.place ?? "company"]);
  const [kindTouched, setKindTouched] = useState(Boolean(from || month));
  const [allKinds, setAllKinds] = useState(false);
  const setPlace = (p: CostPlace) => {
    setPlaceRaw(p);
    if (!kindTouched) setCategory(DEFAULT_KIND[p]);
  };

  // The money.
  const [currency, setCurrencyRaw] = useState(from?.currency ?? month?.currency ?? s0.mainCurrency);
  const [amount, setAmount] = useState(from?.amount ?? month?.amount ?? "");
  const [rate, setRate] = useState(expense ? rateText(expense.rate) : "");
  const setCurrency = (c: string) => {
    setCurrencyRaw(c);
    setRate("");
  };
  const settingsRate = (c: string) => (c === s0.mainCurrency ? 1 : rateOf(s0.fx, c, s0.mainCurrency));

  // How it stands.
  const startPaid: PaidHow = from ? (from.ownMoney ? "own" : from.payLater ? "later" : "now") : send ? "own" : month ? "now" : start?.place === "order" ? "later" : "now";
  const [paid, setPaid] = useState<PaidHow>(startPaid);
  const [paidBy, setPaidBy] = useState(expense ? (expense.paidBy?.id ?? "") : (template?.paidBy?.id ?? meId));
  const settled = expense?.repaid ?? null;

  // On an order: who bears it, and the supplier (visited, or the one that bears it).
  const onSetupOrder = place === "order" && !!s0.order && orderId === (s0.for?.place === "order" ? s0.for.id : null);
  const [bearer, setBearer] = useState<ExpenseBearer>(from?.borneBy ?? "us");
  const [supplierId, setSupplierId] = useState(from?.factory?.id ?? "");
  const [repeats, setRepeats] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const kinds = (() => {
    if (allKinds) return EXPENSE_CATEGORIES;
    const list = PLACE_KINDS[place];
    return list.includes(category) ? list : [...list.slice(0, -1), category, "other" as const];
  })();
  const ofCustomer = <T extends { customerId: string }>(list: T[]) => list.filter((x) => !customerId || x.customerId === customerId);
  const deals = ofCustomer(choices?.deals ?? []);
  const orders = send ? (choices?.orders ?? []) : ofCustomer(choices?.orders ?? []);
  const fixedCustomer = choices?.customerId ?? null;

  // Opened from a record: its name, with Change.
  const forLabel = !choosing && start ? start.label : null;

  // What it counts as: in the main currency at the rate, and on an order in the order's.
  const used = currency === s0.mainCurrency ? 1 : num(rate) > 0 ? num(rate) : settingsRate(currency);
  const inMain = amount.trim() && Number.isFinite(num(amount)) && num(amount) > 0 && used ? num(amount) / used : null;
  const orderCurrency = onSetupOrder ? s0.order!.currency : null;
  const inOrder = inMain !== null && orderCurrency ? inMain * (orderCurrency === s0.mainCurrency ? 1 : (rateOf(s0.fx, orderCurrency, s0.mainCurrency) ?? 0)) : null;
  const worth =
    orderCurrency && currency !== orderCurrency && inOrder ? (
      <>
        = <span className="font-semibold tabular">{money(inOrder, orderCurrency)}</span> on this order
      </>
    ) : currency !== s0.mainCurrency && inMain !== null ? (
      <>
        = <span className="font-semibold tabular">{money(inMain, s0.mainCurrency)}</span> at {num(rate) > 0 ? "this" : "today's"} rate
      </>
    ) : null;

  // A new cost we bear that takes the order's margin under the floor in Settings: said before it is saved.
  const m = onSetupOrder && !expense && bearer === "us" && inOrder !== null ? s0.order!.margin : null;
  const thin = (() => {
    if (!m || Number(m.value) <= 0) return null;
    const now = (Number(m.profit) / Number(m.value)) * 100;
    const then = ((Number(m.profit) - inOrder!) / Number(m.value)) * 100;
    return then < m.floor ? { now, then, floor: m.floor } : null;
  })();

  const suppliers = (() => {
    if (bearer === "factory" && onSetupOrder) return s0.order!.factories;
    const all = choices?.factories ?? s0.order?.factories ?? [];
    return from?.factory && !all.some((f) => f.id === from.factory!.id) ? [from.factory, ...all] : all;
  })();
  const asksSupplier = !send && (bearer === "factory" || VISITS.includes(category) || !!from?.factory) && (suppliers.length > 0 || bearer === "factory");

  const base = send ? submitCostAction : expenseAction.bind(null, null, expense?.id ?? null, expense?.updatedAt ?? null);
  const save = useSaveThenSend(
    base,
    file,
    (id) => (send ? `/files/submissions/${id}` : `/files/expenses/${id}`),
    send ? "The cost is sent" : "The cost is saved",
    onFileError,
    (d) => (d as { id?: string } | undefined)?.id ?? expense?.id,
  );

  // "An order" (an inquiry, a customer) with none picked is a choice not finished, not a company cost: the save
  // stops and says so (review 24 Nov: two costs went to the company unasked).
  const missing = place === "order" ? !orderId && "Choose the order, or choose The company." : place === "deal" ? !dealId && "Choose the inquiry, or choose The company." : place === "customer" ? !customerId && "Choose the customer, or choose The company." : false;
  const guarded = async (prev: ActionState, form: FormData): Promise<ActionState> => (missing ? { ok: false, message: missing } : save(prev, form));

  const saveLabel = send ? "Send for approval" : month ? "Confirm" : expense ? "Save changes" : "Add the cost";
  const forOptions: { value: CostPlace; label: string }[] = send
    ? [
        { value: "company", label: "The company" },
        { value: "order", label: "An order" },
      ]
    : fixedCustomer
      ? [
          { value: "customer", label: "This customer" },
          { value: "deal", label: "One of their inquiries" },
          { value: "order", label: "One of their orders" },
        ]
      : [
          { value: "company", label: "The company" },
          { value: "customer", label: "A customer" },
          { value: "deal", label: "An inquiry" },
          { value: "order", label: "An order" },
        ];
  const paidOptions = (send ? (["own", "now"] as PaidHow[]) : (["later", "now", "own"] as PaidHow[])).map((k) => ({ value: k, label: send && k === "own" ? "My own money" : PAID_LABEL[k] }));
  const personName = s0.people.find((p) => p.id === paidBy)?.name ?? (paidBy === me.id ? me.name : null);

  const footerStart = expense && onRemove ? (
    <button type="button" onClick={onRemove} className="inline-flex items-center gap-1.5 text-md font-semibold text-bad hover:underline">
      <Trash2 className="size-4" aria-hidden /> Remove this cost…
    </button>
  ) : expense ? undefined : (
    <RecordedBy verify={!!send} className="text-xs text-text-2" />
  );
  const buttons = (
    <>
      <WindowCancelIn />
      <SubmitButton pendingText={file ? "Saving, sending the file…" : "Saving…"}>
        {saveLabel}
      </SubmitButton>
    </>
  );

  return (
    <ActionForm action={guarded} onDone={() => onSaved?.()} keepFields showSuccess={!inPanel} className={PANEL_FORM}>
      {(st) => (
        <>
          {/* What it is for: the API takes the order, else the inquiry, else the customer. */}
          <input type="hidden" name="orderId" value={place === "order" ? orderId : ""} />
          {!send && (
            <>
              <input type="hidden" name="inquiryId" value={place === "deal" ? dealId : ""} />
              <input type="hidden" name="customerId" value={place === "customer" ? customerId : ""} />
              <input type="hidden" name="category" value={category} />
              <input type="hidden" name="descriptionDefault" value={EXPENSE_CATEGORY_LABEL[category]} />
              <input type="hidden" name="payLater" value={paid === "later" ? "on" : "off"} />
              <input type="hidden" name="borneBy" value={place === "order" ? bearer : "us"} />
              {!asksSupplier && <input type="hidden" name="supplierId" value="" />}
              {place === "company" && !expense && !month && <input type="hidden" name="repeats" value={repeats ? "on" : "off"} />}
              {month && (
                <>
                  <input type="hidden" name="repeats" value="on" />
                  <input type="hidden" name="repeatKey" value={month.key} />
                </>
              )}
            </>
          )}
          {send && <input type="hidden" name="category" value={category} />}
          <input type="hidden" name="ownMoney" value={paid === "own" ? "on" : "off"} />
          {/* The account is asked only when it is paid now; a bill or someone's own money has none until it is paid. */}
          {(settled || paid !== "now") && <input type="hidden" name="accountId" value={settled ? (expense?.account?.id ?? "") : ""} />}
          {paid === "later" && <input type="hidden" name="paidById" value="" />}
          {settled && paid === "own" && <input type="hidden" name="paidById" value={expense?.paidBy?.id ?? ""} />}

          {/* For */}
          <div className="flex flex-col gap-2">
            <GroupLabel id="cost-for-label">For</GroupLabel>
            {/* Every place and every way in (from a record too): the suppliers visited come with them. */}
            {choicesFailed && <p className="text-xs text-bad">Could not load {choicesFailed}: close the window and open it again to try once more.</p>}
            {forLabel ? (
              <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium" aria-labelledby="cost-for-label">
                  {forLabel}
                </span>
                {!send && !month && (
                  <button type="button" onClick={() => setChoosing(true)} className={cn(linkClass, "shrink-0 text-md")}>
                    Change
                  </button>
                )}
              </div>
            ) : (
              <>
                <ChoiceChips labelledBy="cost-for-label" value={place} items={forOptions} onChange={setPlace} />
                {loading && !choices && <p className="text-xs text-muted">Loading the customers, inquiries and orders…</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {!send && place !== "company" && !fixedCustomer && (
                    <Field label="Customer" htmlFor="cost-customer" error={st.errors?.customerId} optional={place !== "customer"}>
                      <Select
                        id="cost-customer"
                        value={customerId}
                        onChange={(e) => {
                          setCustomerId(e.target.value);
                          setDealId("");
                          setOrderId("");
                        }}
                      >
                        <option value="">{place === "customer" ? "Choose the customer…" : "Any customer"}</option>
                        {(choices?.customers ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {place === "deal" && (
                    <Field label="Inquiry" htmlFor="cost-deal" error={st.errors?.inquiryId} hint={choices && deals.length === 0 ? "No inquiry for this customer" : undefined}>
                      <Select
                        id="cost-deal"
                        value={dealId}
                        onChange={(e) => {
                          setDealId(e.target.value);
                          const d = deals.find((x) => x.id === e.target.value);
                          if (d && !fixedCustomer) setCustomerId(d.customerId);
                        }}
                      >
                        <option value="">Choose the inquiry…</option>
                        {deals.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.refNo} · {INQUIRY_STAGE_LABEL[d.stage]}
                            {fixedCustomer || customerId ? "" : ` — ${d.customer}`} — {d.title}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  {place === "order" && (
                    <Field
                      label="Order"
                      htmlFor="cost-order"
                      error={st.errors?.orderId}
                      hint={send?.ordersFailed ? "Could not load your open orders: try again later (The company works)" : choices && orders.length === 0 ? "No order to choose" : undefined}
                    >
                      <Select
                        id="cost-order"
                        value={orderId}
                        onChange={(e) => {
                          setOrderId(e.target.value);
                          const o = orders.find((x) => x.id === e.target.value);
                          if (o && !fixedCustomer && !send) setCustomerId(o.customerId);
                        }}
                      >
                        <option value="">Choose the order…</option>
                        {orders.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.refNo}
                            {fixedCustomer || customerId ? "" : ` — ${o.customer}`}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
                {!send && <p className="text-xs text-muted">{PLACE_HINT[place]}</p>}
              </>
            )}
          </div>

          {/* What for */}
          <div className="flex flex-col gap-2">
            <GroupLabel id="cost-kind-label">What for</GroupLabel>
            <div role="group" aria-labelledby="cost-kind-label" className="flex flex-wrap gap-1.5">
              {kinds.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => {
                    setCategory(c);
                    setKindTouched(true);
                  }}
                  className={chip(category === c)}
                >
                  {costKind(c)}
                </button>
              ))}
              {!allKinds && (
                <button type="button" onClick={() => setAllKinds(true)} className={cn(linkClass, "h-8 px-2 text-md")}>
                  More kinds
                </button>
              )}
            </div>
            {st.errors?.category && <p className="text-xs text-bad">{st.errors.category[0]}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Description" htmlFor="cost-description" error={st.errors?.description}>
              <Input
                id="cost-description"
                name="description"
                maxLength={200}
                defaultValue={st.values?.description ?? from?.description ?? month?.description ?? ""}
                
              />
            </Field>
            {!send && (
              // Who was paid (the forwarder, the courier, the shop): the payment page and the voucher name them.
              <Field label="Paid to" htmlFor="cost-payee" optional error={st.errors?.payee}>
                <Input id="cost-payee" name="payee" maxLength={120} placeholder="Forwarder, courier, shop…" defaultValue={st.values?.payee ?? from?.payee ?? ""} />
              </Field>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3 sm:grid-cols-2">
              <Field label="Amount" htmlFor="cost-amount" error={st.errors?.amount}>
                <MoneyInput id="cost-amount" name="amount" currency={currency} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
              </Field>
              <Field label="Currency" htmlFor="cost-currency" error={st.errors?.currency}>
                {/* The codes only (USD, CNY, PKR): beside the amount on a phone, "USD · US dollar" was cut to "USD · US d". */}
                <CurrencySelect short id="cost-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
              </Field>
            </div>
            {worth && <p className="text-xs text-text-2">{worth}</p>}
            {thin && (
              <Notice tone="todo">
                This cost takes the order&apos;s margin from {thin.now.toFixed(1)}% to {thin.then.toFixed(1)}%, under the {thin.floor}% set in Settings.
              </Notice>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {!send && currency !== s0.mainCurrency && (
              <Field
                label={`Rate (${currency} per 1 ${s0.mainCurrency})`}
                htmlFor="cost-rate"
                error={st.errors?.rate}
                hint={settingsRate(currency) ? undefined : `No rate for ${currency} in Settings: enter it`}
              >
                <Input
                  id="cost-rate"
                  name="rate"
                  inputMode="decimal"
                  className="tabular"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  placeholder={settingsRate(currency) ? rateText(settingsRate(currency)!) : ""}
                />
              </Field>
            )}
            <Field label="Date" htmlFor="cost-spentOn" error={st.errors?.spentOn}>
              <Input id="cost-spentOn" name="spentOn" type="date" max={s0.today} defaultValue={st.values?.spentOn ?? expense?.spentOn ?? month?.on ?? s0.today} />
            </Field>
          </div>

          {/* Paid */}
          <div className="flex flex-col gap-2">
            <GroupLabel id="cost-paid-label">Paid</GroupLabel>
            {settled ? (
              <p className="text-sm">
                {paid === "own" ? "Paid back" : "Paid"} {date(settled.on)}
                {settled.account ? ` from ${settled.account.name}` : ""}
              </p>
            ) : (
              <ChoiceChips labelledBy="cost-paid-label" value={paid} items={paidOptions} onChange={setPaid} />
            )}
            {!settled && paid === "later" && <p className="text-xs text-text-2">It shows under Still to pay until it is paid. Pay it from its row, or from Finance › Receivables & payables.</p>}
            {!settled && paid === "now" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <AccountSelect key={currency} id="cost-account" label="Paid from account" currency={currency} defaultValue={from?.account?.id ?? month?.account?.id} error={st.errors?.accountId} />
                {send ? (
                  <input type="hidden" name="paidById" value="" />
                ) : (
                  <Field label="Paid by" htmlFor="cost-paidBy" optional error={st.errors?.paidById} >
                    <Select id="cost-paidBy" name="paidById" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                      <option value="">Not said</option>
                      {s0.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.id === me.id ? " (you)" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            )}
            {!settled && paid === "own" && (
              <div className="flex flex-col gap-1.5">
                {send ? (
                  <>
                    <input type="hidden" name="paidById" value={me.id} />
                    <p className="text-xs text-text-2">It is owed back to you once a manager approves it.</p>
                  </>
                ) : (
                  <>
                    <Field label="Whose money" htmlFor="cost-whose" error={st.errors?.paidById} className="sm:max-w-[50%]">
                      <Select id="cost-whose" name="paidById" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                        <option value="">Choose the person…</option>
                        {s0.people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.id === me.id ? " (you)" : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {personName && <p className="text-xs text-text-2">We owe it back to {personName}. It shows under Owed back until it is paid back.</p>}
                  </>
                )}
              </div>
            )}
            {send && st.errors?.paidById && <p className="text-xs text-bad">{st.errors.paidById[0]}</p>}
          </div>

          {/* The supplier, and who bears it (orders only) */}
          {(asksSupplier || place === "order") && !send && (
            <div className="grid gap-3 sm:grid-cols-2">
              {asksSupplier ? (
                <Field
                  label={bearer === "factory" ? "Which supplier" : "Supplier visited"}
                  htmlFor="cost-factory"
                  optional={bearer !== "factory"}
                  error={st.errors?.supplierId}
                  
                >
                  <Select id="cost-factory" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">{bearer === "factory" ? "Choose the supplier…" : "None"}</option>
                    {suppliers.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {place === "order" && (
                <div className="flex flex-col gap-2">
                  <GroupLabel id="cost-bearer-label">Who bears it</GroupLabel>
                  <ChoiceChips
                    labelledBy="cost-bearer-label"
                    value={bearer}
                    items={EXPENSE_BEARERS.filter((b) => b !== "factory" || (onSetupOrder && s0.order!.factories.length > 0) || bearer === "factory").map((b) => ({ value: b, label: EXPENSE_BEARER_LABEL[b] }))}
                    onChange={(b) => {
                      setBearer(b);
                      if (b === "factory" && onSetupOrder && s0.order!.factories.length === 1) setSupplierId(s0.order!.factories[0]!.id);
                    }}
                  />
                  <p className="text-xs text-text-2">
                    {EXPENSE_BEARER_LABEL[bearer]}: {EXPENSE_BEARER_HINT[bearer]}
                  </p>
                  {st.errors?.borneBy && <p className="text-xs text-bad">{st.errors.borneBy[0]}</p>}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {!send && (
              <Field label="Bill / receipt no." htmlFor="cost-reference" optional error={st.errors?.reference}>
                <Input id="cost-reference" name="reference" maxLength={120} defaultValue={st.values?.reference ?? expense?.reference ?? ""} />
              </Field>
            )}
            <Receipt file={file} onChange={setFile} kept={expense?.receipt ?? null} label={month ? "Bank slip" : "Receipt"} />
          </div>

          {!send && (
            <Field label="Note" htmlFor="cost-note" optional error={st.errors?.note}>
              <Textarea id="cost-note" name="note" rows={2} maxLength={2000} className="min-h-0" defaultValue={st.values?.note ?? expense?.note ?? ""} />
            </Field>
          )}

          {place === "company" && !expense && !month && !send && (
            <Field label="Repeats" htmlFor="cost-repeats" >
              <Select id="cost-repeats" value={repeats ? "on" : "off"} onChange={(e) => setRepeats(e.target.value === "on")}>
                <option value="off">Does not repeat</option>
                <option value="on">Every month, on this day</option>
              </Select>
            </Field>
          )}

          <WindowFooter className={cn("justify-end gap-x-3 gap-y-2", !(inPanel || inWindow) && "static mx-0 mb-0 border-t-0 px-0 sm:mx-0 sm:px-0")} cancel={false}>
            {footerStart && <span className={cn("mr-auto min-w-0 flex-[1_1_9rem] text-xs text-text-2", !expense && "max-sm:hidden")}>{footerStart}</span>}
            {buttons}
          </WindowFooter>
        </>
      )}
    </ActionForm>
  );
}

/** "Their bill or a photo": chosen here, sent once the cost is saved; a new one replaces the one kept. */
function Receipt({ file, onChange, kept, label }: { file: File | null; onChange: (f: File | null) => void; kept: { id: string; name: string } | null; label: string }) {
  if (!file)
    return (
      <FileZone
        label={label}
        inputId="cost-receipt"
        compact
        one
        accept="image/*,application/pdf"
        hint={kept ? <a href={`/files/${kept.id}?view=1`} className={linkClass}>Kept: {kept.name} · a new one replaces it</a> : "Their bill or a photo"}
        onFiles={(fs) => onChange(fs[0] ?? null)}
      />
    );
  return (
    <div className="grid content-start gap-1.5">
      <span className="flex items-baseline gap-1.5 text-sm font-medium text-text">
        {label} <span className="text-xs font-normal text-muted">optional</span>
      </span>
      <span className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 text-sm">
        <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => onChange(null)} aria-label="Do not attach this file">
          <X aria-hidden />
        </Button>
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- the window */

export function CostPanel({
  title,
  sub,
  setup,
  mode,
  onClose,
  onFileError,
  onRemove,
}: {
  title: string;
  sub: ReactNode;
  setup: CostSetup;
  mode: Mode;
  onClose: () => void;
  onFileError: (m: string) => void;
  onRemove?: () => void;
}) {
  return (
    <SidePanel title={title} description={sub} onClose={onClose} className={RULES.window.part}>
      <PanelBody className="gap-4">
        <CostForm setup={setup} mode={mode} inPanel onSaved={onClose} onFileError={onFileError} onRemove={onRemove} />
      </PanelBody>
    </SidePanel>
  );
}

export const subOf = (f: CostFor | null) => (!f ? "Choose what it is for" : f.place === "company" ? "For the company" : `For ${f.label.replace(/^(Order|Inquiry) /, "")}`);

/** "Add a cost": the button and its window (New cost). With `template`: "Add again", filled in from that cost. */
export function AddCost({
  setup,
  label = "Add a cost",
  // A box head's add is the outline small button (one look for "+ New …" in a box); "strong" md: a list's top.
  variant = "secondary",
  size = "sm",
  icon = "plus",
  template,
  className,
}: {
  setup: CostSetup;
  label?: string;
  variant?: "strong" | "secondary" | "ghost";
  size?: "xs" | "sm" | "md";
  icon?: "plus" | "copy" | null;
  template?: CostToChange & { for?: CostFor };
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => setOpen(false);
  return (
    <>
      <Button type="button" size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        {icon === "plus" ? <Plus aria-hidden /> : icon === "copy" ? <Copy aria-hidden /> : null} {label}
      </Button>
      {notice && (
        <Notice tone="todo" className="basis-full">
          {notice}
        </Notice>
      )}
      {open && (
        <CostPanel
          title="New cost"
          sub={subOf(template?.for ?? setup.for)}
          setup={setup}
          mode={{ kind: "new", template }}
          onClose={close}
          onFileError={setNotice}
        />
      )}
    </>
  );
}

/** "Confirm" on a month of a cost that comes every month: the same window, filled in from last month. */
export function ConfirmCost({ setup, month, sub }: { setup: CostSetup; month: CostToConfirm; sub: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Confirm
      </Button>
      {notice && <Notice tone="todo">{notice}</Notice>}
      {open && <CostPanel title="Confirm" sub={sub} setup={setup} mode={{ kind: "confirm", month }} onClose={() => setOpen(false)} onFileError={setNotice} />}
    </>
  );
}

/** Staff: "Add a cost" sent for a manager to approve (on the company or one of their orders). */
export function SendCost({
  setup,
  orders,
  ordersFailed = false,
}: {
  setup: CostSetup;
  orders: { id: string; refNo: string; customer: string }[];
  /** Their open orders could not be read: a cost on the company still goes; the Order field says so. */
  ordersFailed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Add a cost
      </Button>
      {notice && <Notice tone="bad">{notice}</Notice>}
      {open && <CostPanel title="New cost" sub="A manager approves it before it counts" setup={setup} mode={{ kind: "send", orders, ordersFailed }} onClose={() => setOpen(false)} onFileError={setNotice} />}
    </>
  );
}

/** "Change" on one cost: the same window (a change asks why), its file, and Remove this cost. */
export function ChangeCost({
  setup,
  expense,
  iconOnly = false,
  removeOrderId = null,
}: {
  setup: CostSetup;
  expense: CostToChange;
  /** A pencil only (in a table row). */
  iconOnly?: boolean;
  /** The order the cost is on, to refresh it after Remove. */
  removeOrderId?: string | null;
}) {
  const { date } = useTime();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [why, setWhy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const remove = () =>
    start(async () => {
      setError(null);
      const form = new FormData();
      form.set("reason", why.trim());
      const r: ActionState = await voidExpenseAction(removeOrderId, expense.id, {}, form);
      if (!r.ok) return setError(r.errors?.reason?.[0] ?? r.message ?? "The cost was not removed.");
      setRemoving(false);
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      {iconOnly ? (
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)} aria-label={`Change ${expense.description}`}>
          <Pencil aria-hidden />
        </Button>
      ) : (
        <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)}>
          <Pencil aria-hidden /> Change
        </Button>
      )}
      {notice && <Notice tone="todo">{notice}</Notice>}
      {open && (
        <CostPanel
          title="Change the cost"
          sub={`${setup.for?.label ?? "The company"} · ${date(expense.spentOn)}`}
          setup={setup}
          mode={{ kind: "change", expense }}
          onClose={() => setOpen(false)}
          onFileError={setNotice}
          onRemove={() => {
            setWhy("");
            setError(null);
            setRemoving(true);
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          title="Remove this cost?"
          confirmLabel="Remove the cost"
          cancelLabel="Keep it"
          danger
          busy={busy}
          onCancel={() => setRemoving(false)}
          onConfirm={remove}
        >
          <div className="flex flex-col gap-3">
            <WhatHappens lines={[`${expense.description}, ${money(expense.amount, expense.currency)}, stops counting.`, "It leaves the lists and is kept, with your reason, under Removed in Payments."]} />
            <Field label="Why remove it?" htmlFor="cost-remove-why" error={error ?? undefined}>
              <Textarea id="cost-remove-why" rows={2} className="min-h-0" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={500} />
            </Field>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
