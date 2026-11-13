"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  BANK_CONTRACT_STATUS_LABEL,
  BANK_CONTRACT_STATUSES,
  CLAIM_STATUS_LABEL,
  CLAIM_BEARER_LABEL,
  CLAIM_BEARERS,
  CLAIM_STATUSES,
  CURRENCIES,
  PAYMENT_ROUTE_LABEL,
  SAT_RESULT_LABEL,
  SAT_RESULTS,
  type BalanceWhen,
  type LcTerms,
  type PaymentRoute,
  type SatResult,
} from "@kebo/shared";
import { Button, cn, Field, Input, Select, SelectCard, SelectCardList, Textarea } from "@kebo/ui";
import { ConfirmSubmit, SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { MoneyInput } from "@/components/common/money-input";
import type { ActionState } from "@/lib/actions";
import type { BankContract, ClaimView, SatCheckView } from "@/lib/types-flow";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

export const framed = "flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3";

function Actions({ save, pending, onCancel }: { save: string; pending: string; onCancel?: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <SubmitButton size="sm" pendingText={pending}>
        {save}
      </SubmitButton>
      {onCancel && (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- payment route */

const ROUTE_TEXT: Record<PaymentRoute, string> = {
  informal: "Cash in Pakistan, Alipay, WeChat or a personal account. Faster; we hold the documents until the balance is in.",
  bank_contract: "A contract through the banks: our bank sends the documents to the customer's bank, which pays when they arrive.",
  letter_of_credit: "The customer's bank opens an LC; it pays our bank against the shipping documents. Safest, slowest.",
};

/** The route's terms: informal balance before shipment or against the B/L copy; LC at sight or deferred N days. */
export interface RouteTermsValue {
  balanceWhen: BalanceWhen | null;
  lcTerms: LcTerms | null;
  lcDays: number | null;
}

/** Two or three choices side by side (a small segmented control inside a form). */
function Pills<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-fit rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1 text-sm", value === o.value ? "bg-surface font-medium shadow-xs" : "text-text-2 hover:text-text")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How the customer pays: three cards, one choice (bank routes only when the
 * company has bank contracts), and the route's terms. The route builds the
 * plan: changing it rebuilds the parts not paid yet.
 */
export function RouteForm({
  action,
  route,
  bankRoutes,
  onDone,
  terms,
  suggest,
  fromQuotation,
}: {
  action: Action;
  route: PaymentRoute | null;
  bankRoutes: boolean;
  onDone?: () => void;
  terms?: RouteTermsValue;
  /** The order started on this route: the one the quotation's terms implied. */
  fromQuotation?: boolean;
  /** Not chosen yet: the route the quote's terms point to, picked for the person to check. */
  suggest?: PaymentRoute | null;
}) {
  const [pick, setPick] = useState<PaymentRoute | null>(route ?? (suggest && (suggest === "informal" || bankRoutes) ? suggest : null));
  const [when, setWhen] = useState<BalanceWhen>(terms?.balanceWhen ?? "before_shipment");
  const [lcTerms, setLcTerms] = useState<LcTerms>(terms?.lcTerms ?? "at_sight");
  const [lcDays, setLcDays] = useState(terms?.lcDays ? String(terms.lcDays) : "90");
  const options = (["informal", "bank_contract", "letter_of_credit"] as const).filter((r) => r === "informal" || bankRoutes);
  const changed =
    pick !== route ||
    route === null ||
    (pick === "informal" && when !== (terms?.balanceWhen ?? "before_shipment")) ||
    (pick === "letter_of_credit" && (lcTerms !== (terms?.lcTerms ?? "at_sight") || (lcTerms === "deferred" && lcDays !== String(terms?.lcDays ?? ""))));
  return (
    <ActionForm action={action} onDone={onDone} keepFields className="flex flex-col gap-3">
      <input type="hidden" name="route" value={pick ?? ""} />
      {pick === "informal" && <input type="hidden" name="balanceWhen" value={when} />}
      {pick === "letter_of_credit" && <input type="hidden" name="lcTerms" value={lcTerms} />}
      {pick === "letter_of_credit" && lcTerms === "deferred" && <input type="hidden" name="lcDays" value={lcDays} />}
      <SelectCardList label="How the customer pays">
        {options.map((r) => (
          <SelectCard key={r} title={PAYMENT_ROUTE_LABEL[r].replace(/ \(.*\)$/, "")} meta={ROUTE_TEXT[r]} selected={pick === r} onSelect={() => setPick(r)} />
        ))}
      </SelectCardList>
      {pick === "informal" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-2">The balance</span>
          <Pills
            label="When the balance is paid"
            value={when}
            onChange={setWhen}
            options={[
              { value: "before_shipment", label: "Before shipment" },
              { value: "against_bl_copy", label: "Against the B/L copy" },
            ]}
          />
        </div>
      )}
      {pick === "letter_of_credit" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-2">The LC pays</span>
          <Pills
            label="LC terms"
            value={lcTerms}
            onChange={setLcTerms}
            options={[
              { value: "at_sight", label: "At sight" },
              { value: "deferred", label: "Deferred" },
            ]}
          />
          {lcTerms === "deferred" && (
            <span className="flex items-center gap-2 text-text-2">
              <Input aria-label="Days after the papers reach their bank" inputMode="numeric" className="w-20 tabular" value={lcDays} onChange={(e) => setLcDays(e.target.value.replace(/\D/g, ""))} />
              days after the papers reach their bank
            </span>
          )}
        </div>
      )}
      {route && (
        <p className="text-xs text-muted">
          {fromQuotation ? "From the quotation's terms. " : ""}Change it and the plan is rebuilt (payments already recorded and instalments changed by hand stay).
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" variant="secondary" pendingText="Saving…" disabled={!pick || !changed || (pick === "letter_of_credit" && lcTerms === "deferred" && !Number(lcDays))}>
          Save the payment route
        </SubmitButton>
        {onDone && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </ActionForm>
  );
}

/** The bank contract or LC: number, banks, amount, dates, status. */
export function BankContractForm({ action, contract, lc, currency, onDone }: { action: Action; contract: BankContract | null; lc: boolean; currency: string; onDone: () => void }) {
  const c = contract;
  const what = lc ? "LC" : "contract";
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => {
        const v = (k: keyof BankContract, d = "") => s.values?.[k] ?? (c?.[k] === null || c?.[k] === undefined ? d : String(c[k]));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={lc ? "LC number" : "Contract number"} htmlFor="bc-number" optional error={s.errors?.number}>
                <Input id="bc-number" name="number" maxLength={60} defaultValue={v("number")} />
              </Field>
              <Field label="Status" htmlFor="bc-status" error={s.errors?.status}>
                <Select id="bc-status" name="status" defaultValue={v("status", "draft")}>
                  {BANK_CONTRACT_STATUSES.map((x) => (
                    <option key={x} value={x}>
                      {BANK_CONTRACT_STATUS_LABEL[x]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount" htmlFor="bc-amount" optional error={s.errors?.amount}>
                <div className="flex gap-2">
                  <Select name="currency" aria-label="Currency" defaultValue={v("currency", currency)} className="w-24 shrink-0">
                    {CURRENCIES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                  <MoneyInput id="bc-amount" name="amount" currency={v("currency", currency)} defaultValue={v("amount")} />
                </div>
              </Field>
              <Field label="Customer's bank" htmlFor="bc-cbank" optional hint="Where the documents go" error={s.errors?.customerBank}>
                <Input id="bc-cbank" name="customerBank" maxLength={160} defaultValue={v("customerBank")} />
              </Field>
              <Field label="Our bank" htmlFor="bc-obank" optional hint="Where they start" error={s.errors?.ourBank}>
                <Input id="bc-obank" name="ourBank" maxLength={160} defaultValue={v("ourBank")} />
              </Field>
              <Field label="Opened on" htmlFor="bc-opened" optional error={s.errors?.openedOn}>
                <Input id="bc-opened" name="openedOn" type="date" defaultValue={v("openedOn")} />
              </Field>
              <Field label="Ship by (latest)" htmlFor="bc-ship" optional error={s.errors?.latestShipOn}>
                <Input id="bc-ship" name="latestShipOn" type="date" defaultValue={v("latestShipOn")} />
              </Field>
              <Field label={`${lc ? "LC" : "Contract"} expires`} htmlFor="bc-expires" optional error={s.errors?.expiresOn}>
                <Input id="bc-expires" name="expiresOn" type="date" defaultValue={v("expiresOn")} />
              </Field>
            </div>
            <Field label="Note" htmlFor="bc-note" optional error={s.errors?.note}>
              <Textarea id="bc-note" name="note" rows={2} className="min-h-0" defaultValue={v("note")} />
            </Field>
            <Actions save={`Save the ${what}`} pending="Saving…" onCancel={onDone} />
          </>
        );
      }}
    </ActionForm>
  );
}

let seq = 0;
const nextKey = () => `n${++seq}`;

/* ---------------------------------------------------------------- shipments */

/** Remove with a confirmation. */
export function RemoveButton({ action, what }: { action: Action; what: string }) {
  return (
    <ActionForm action={action} showSuccess={false} className="inline-flex">
      <ConfirmSubmit size="xs" variant="danger-ghost" pendingText="Removing…" message={`Remove ${what}?`}>
        <Trash2 aria-hidden /> Remove
      </ConfirmSubmit>
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- the document set */

/* ---------------------------------------------------------------- delivery and SAT */

interface CheckRow {
  key: string;
  id: string | null;
  item: string;
  result: SatResult;
  note: string;
}

const RESULT_STYLE: Record<SatResult, string> = {
  pending: "border-line bg-surface text-text-2",
  pass: "border-ok bg-ok-soft text-ok",
  fail: "border-bad bg-bad-soft text-bad",
  not_applicable: "border-line bg-surface-3 text-text-2",
};

/** The SAT points: each point with Pass / Fail / N/A buttons and a note; saved together. */
export function SatEditor({ action, checks, suggested, locked }: { action: Action; checks: SatCheckView[]; suggested: string[]; locked: boolean }) {
  const [rows, setRows] = useState<CheckRow[]>(() =>
    checks.length ? checks.map((c) => ({ key: c.id, id: c.id, item: c.item, result: c.result, note: c.note ?? "" })) : suggested.map((t) => ({ key: nextKey(), id: null, item: t, result: "pending" as SatResult, note: "" })),
  );
  const [dirty, setDirty] = useState(!checks.length && suggested.length > 0);
  const set = (i: number, patch: Partial<CheckRow>) => {
    setDirty(true);
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  };
  const payload = JSON.stringify({ checks: rows.filter((r) => r.item.trim()).map((r) => ({ id: r.id, item: r.item, result: r.result, note: r.note || null })) });
  if (locked)
    return (
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm">{r.item}</span>
              {r.note && <span className="block text-xs text-muted">{r.note}</span>}
            </span>
            <span className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", RESULT_STYLE[r.result])}>{SAT_RESULT_LABEL[r.result]}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <ActionForm action={action} keepFields onDone={() => setDirty(false)} className="flex flex-col gap-2">
      <input type="hidden" name="payload" value={payload} />
      {!checks.length && suggested.length > 0 && <p className="text-xs text-muted">A usual SAT list to start from. Change the points to match the customer&apos;s URS, then save.</p>}
      <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
        {rows.map((r, i) => (
          <li key={r.key} className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="flex min-w-0 flex-col gap-1">
              <Input aria-label={`Point ${i + 1}`} value={r.item} disabled={locked} maxLength={200} onChange={(e) => set(i, { item: e.target.value })} className="h-8" />
              <Input aria-label={`Note on point ${i + 1}`} value={r.note} disabled={locked} maxLength={500} onChange={(e) => set(i, { note: e.target.value })} placeholder="Note" className="h-8 text-xs" />
            </div>
            <div role="radiogroup" aria-label={`Result of point ${i + 1}`} className="flex flex-wrap items-center gap-1">
              {SAT_RESULTS.map((x) => (
                <button
                  key={x}
                  type="button"
                  role="radio"
                  aria-checked={r.result === x}
                  disabled={locked}
                  onClick={() => set(i, { result: x })}
                  className={cn("h-7 rounded-md border px-2 text-xs font-medium", r.result === x ? RESULT_STYLE[x] : "border-line bg-surface text-muted hover:border-line-strong")}
                >
                  {SAT_RESULT_LABEL[x]}
                </button>
              ))}
              {!locked && (
                <Button type="button" size="icon-xs" variant="danger-ghost" aria-label={`Remove point ${i + 1}`} onClick={() => (setDirty(true), setRows((x) => x.filter((_, j) => j !== i)))}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!locked && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => (setDirty(true), setRows((r) => [...r, { key: nextKey(), id: null, item: "", result: "pending", note: "" }]))}>
            <Plus aria-hidden /> Add a point
          </Button>
          <SubmitButton size="sm" pendingText="Saving…" disabled={!dirty}>
            Save the points
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

/* ---------------------------------------------------------------- claims */

export function ClaimForm({ action, today, onDone }: { action: Action; today: string; onDone: () => void }) {
  return (
    <ActionForm action={action} onDone={onDone} className={framed}>
      {(s) => (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field label="What is wrong" htmlFor="cl-title" error={s.errors?.title}>
              <Input id="cl-title" name="title" maxLength={160} defaultValue={s.values?.title ?? ""} placeholder="e.g. Dented guard door" />
            </Field>
            <Field label="Reported on" htmlFor="cl-on" error={s.errors?.openedOn}>
              <Input id="cl-on" name="openedOn" type="date" max={today} defaultValue={s.values?.openedOn ?? today} />
            </Field>
          </div>
          <Field label="Details" htmlFor="cl-detail" optional error={s.errors?.detail}>
            <Textarea id="cl-detail" name="detail" rows={2} className="min-h-0" defaultValue={s.values?.detail ?? ""} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor="cl-amount" optional error={s.errors?.amount}>
              <Input id="cl-amount" name="amount" inputMode="decimal" defaultValue={s.values?.amount ?? ""} placeholder="in the order’s currency" />
            </Field>
            <Field label="Who pays" htmlFor="cl-bearer" optional error={s.errors?.bearer}>
              <Select id="cl-bearer" name="bearer" defaultValue={s.values?.bearer ?? ""}>
                <option value="">Not decided</option>
                {CLAIM_BEARERS.map((b) => (
                  <option key={b} value={b}>
                    {CLAIM_BEARER_LABEL[b]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Actions save="Open the claim" pending="Saving…" onCancel={onDone} />
        </>
      )}
    </ActionForm>
  );
}

export function ClaimUpdateForm({ action, claim, onDone }: { action: Action; claim: ClaimView; onDone: () => void }) {
  const [status, setStatus] = useState(claim.status);
  const closing = status === "resolved" || status === "rejected";
  return (
    <ActionForm action={action} onDone={onDone} className={cn(framed, "mt-2")}>
      {(s) => (
        <>
          <Field label="Status" htmlFor={`cs-${claim.id}`} error={s.errors?.status}>
            <Select id={`cs-${claim.id}`} name="status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="sm:w-56">
              {CLAIM_STATUSES.map((x) => (
                <option key={x} value={x}>
                  {CLAIM_STATUS_LABEL[x]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" htmlFor={`ca-${claim.id}`} optional error={s.errors?.amount}>
              <Input id={`ca-${claim.id}`} name="amount" inputMode="decimal" defaultValue={s.values?.amount ?? claim.amount ?? ""} placeholder="in the order’s currency" />
            </Field>
            <Field label="Who pays" htmlFor={`cb-${claim.id}`} optional error={s.errors?.bearer}>
              <Select id={`cb-${claim.id}`} name="bearer" defaultValue={s.values?.bearer ?? claim.bearer ?? ""}>
                <option value="">Not decided</option>
                {CLAIM_BEARERS.map((b) => (
                  <option key={b} value={b}>
                    {CLAIM_BEARER_LABEL[b]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {closing && (
            <Field label="How it was settled" htmlFor={`cr-${claim.id}`} error={s.errors?.resolution}>
              <Textarea id={`cr-${claim.id}`} name="resolution" rows={2} className="min-h-0" defaultValue={s.values?.resolution ?? claim.resolution ?? ""} placeholder="e.g. Factory sent a new door by air; fitted on site." />
            </Field>
          )}
          <Actions save="Save" pending="Saving…" onCancel={onDone} />
        </>
      )}
    </ActionForm>
  );
}

