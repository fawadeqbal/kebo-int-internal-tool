"use client";

import { ChoiceChips } from "@/components/common/choice-chips";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { fromMinor, priceForMargin, toMinor } from "@kebo/money";
import { CURRENCIES, LOST_REASON_LABEL, LOST_REASONS, quotationLetter, type PaymentRoute } from "@kebo/shared";
import { THead, Th, Button, cn, Field, Input, Select, Textarea, RULES } from "@kebo/ui";
import { SubmitButton } from "@kebo/ui/client";
import { ActionForm } from "@/components/common/action-form";
import { PANEL_FORM, PanelBody, SidePanel, useClosePanel, WhatHappens, WindowFooter } from "@/components/common/panel";
import type { ActionState } from "@/lib/actions";
import { date, money } from "@/lib/format";
import type { OptionView, QuoteOffers } from "@/lib/types-deals";
import { AcceptForm, ExpiredForm } from "./quotation-step";
import { shortName } from "./offer-facts";
import { isFailed, type Failed } from "@/lib/failed";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/* ---------------------------------------------------------------- New quotations */

/**
 * "New quotations" (board QuoteForm): tick any offers (each becomes its own quotation; an offer already quoted
 * shows where), or own prices; the drafts' currency, valid until and margin; then one draft each, lettered on
 * from the deal's last letter.
 */
export function NewQuotationsButton({
  action,
  offers: first,
  loadOffers,
  defaults,
  usedIn,
  letters,
  label = "New quotations",
  variant = "secondary",
  defaultOpen = false,
  base,
  only = null,
}: {
  /** The inquiry's address: after making them, the first new quotation's own page opens. */
  base: string;
  /** "Quote this offer" (an offer's own page): that offer alone starts ticked. */
  only?: string | null;
  action: Action;
  offers: QuoteOffers | null;
  loadOffers: (currency: string) => Promise<QuoteOffers | Failed | null>;
  defaults: { currency: string; validUntil: string; margin: number };
  /** The letters of the quotations already made from each offer (by offer id). */
  usedIn: Record<string, string[]>;
  /** The letters already taken (a new quotation gets the next free one). */
  letters: string[];
  label?: string;
  variant?: "primary" | "secondary";
  /** Open at once ("Make the quotation" from Do next: ?start=1); closing takes it out of the address. */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen);
  const close = () => {
    setOpen(false);
    if (defaultOpen) router.replace(pathname, { scroll: false });
  };
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        <Plus aria-hidden /> {label}
      </Button>
      {open && (
        <SidePanel title="New quotations" description="Each offer ticked becomes its own draft." onClose={close} className={RULES.window.wideRows}>
          <NewQuotationsForm action={action} first={first} loadOffers={loadOffers} defaults={defaults} usedIn={usedIn} letters={letters} base={base} only={only} />
        </SidePanel>
      )}
    </>
  );
}

function NewQuotationsForm({
  action,
  first,
  loadOffers,
  defaults,
  usedIn,
  letters,
  base,
  only,
}: {
  only: string | null;
  action: Action;
  first: QuoteOffers | null;
  loadOffers: (currency: string) => Promise<QuoteOffers | Failed | null>;
  defaults: { currency: string; validUntil: string; margin: number };
  usedIn: Record<string, string[]>;
  letters: string[];
  base: string;
}) {
  const close = useClosePanel();
  const router = useRouter();
  const [offers, setOffers] = useState(first);
  const [currency, setCurrency] = useState(defaults.currency);
  const [margin, setMargin] = useState(String(defaults.margin));
  // Offers not quoted yet start ticked; own prices when there is no offer at all; "Quote this offer": that one.
  const [ticked, setTicked] = useState<string[]>(() => {
    if (only && first?.offers.some((o) => o.supplierQuoteId === only)) return [only];
    const fresh = (first?.offers ?? []).filter((o) => !usedIn[o.supplierQuoteId]?.length).map((o) => o.supplierQuoteId);
    return fresh.length ? fresh : first?.offers.length ? [] : ["own"];
  });
  const m = Number(margin);
  const marginOk = margin.trim() !== "" && Number.isFinite(m) && m >= 0 && m < 100;
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  // The letters the drafts will take: the first free ones (a deleted draft's letter comes back first).
  const next = useMemo(() => {
    const taken = new Set(letters);
    const out: string[] = [];
    for (let i = 0; out.length < ticked.length; i += 1) if (!taken.has(quotationLetter(i))) out.push(quotationLetter(i));
    return out;
  }, [letters, ticked.length]);
  const totalOf = (id: string) => {
    const o = offers?.offers.find((x) => x.supplierQuoteId === id);
    if (!o || !marginOk) return null;
    if (o.lines.some((l) => l.unitCost === null)) return null;
    return o.lines.reduce((t, l) => t + Number(fromMinor(priceForMargin(toMinor(l.unitCost!), m))) * Number(l.quantity), 0);
  };
  // The offers' costs in the new currency; not read: the costs stay in the old one, and the field says so.
  const [offersFailed, setOffersFailed] = useState<string | null>(null);
  const changeCurrency = async (c: string) => {
    setCurrency(c);
    const more = await loadOffers(c);
    setOffersFailed(isFailed(more) ? `Could not load ${more.what}: the costs shown are still in ${offers?.currency ?? "the old currency"}.` : null);
    if (more && !isFailed(more)) setOffers(more);
  };
  const rows = [...(offers?.offers ?? []).map((o) => o.supplierQuoteId), "own"].filter((id) => ticked.includes(id));
  return (
    <PanelBody>
      <ActionForm
        action={action}
        keepFields
        className={PANEL_FORM}
        onDone={(s) => {
          close(s);
          const id = (s.data as { first?: string | null } | undefined)?.first;
          if (id) router.push(`${base}/quotations/${id}`);
        }}
      >
        {(s) => (
          <>
            {ticked.map((id) => (
              <input key={id} type="hidden" name="offer" value={id} />
            ))}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-md font-semibold">Offers</legend>
              {/* Made to fit a phone (data-fit): the tick, the offer and its cost; where it is quoted goes under its name. */}
              <div className="relative scroll-x rounded-xl border border-line">
                <table data-fit className="w-full border-collapse text-md">
                  <THead>
                    <tr>
                      <Th scope="col" className="w-10 max-sm:w-9">
                        <span className="sr-only">Quote it</span>
                      </Th>
                      <Th scope="col">
                        Offer
                      </Th>
                      <Th scope="col" className="text-right">
                        Cost
                      </Th>
                      <Th scope="col" className="max-sm:hidden">
                        <span className="sr-only">Quoted in</span>
                      </Th>
                    </tr>
                  </THead>
                  <tbody>
                    {(offers?.offers ?? []).map((o) => {
                      const on = ticked.includes(o.supplierQuoteId);
                      const box = `offer-${o.supplierQuoteId}`;
                      return (
                        <tr key={o.supplierQuoteId} className={cn(on && "bg-surface-2/60")}>
                          <td className="border-b border-line px-3 py-2.5 align-top max-sm:px-2.5">
                            <input id={box} type="checkbox" checked={on} onChange={() => toggle(o.supplierQuoteId)} className="size-4 accent-[var(--color-primary)]" />
                          </td>
                          <td className="border-b border-line px-3 py-2.5 max-sm:pr-1">
                            <label htmlFor={box} className="block cursor-pointer font-semibold [overflow-wrap:anywhere]">
                              {o.factory.name}
                            </label>
                            <span className="block text-xs text-text-2">
                              {[date(o.receivedOn), o.basis ? `${o.basis}${o.basisPlace ? ` ${o.basisPlace}` : ""}` : null, o.leadTime].filter(Boolean).join(" · ")}
                            </span>
                            {usedIn[o.supplierQuoteId]?.length ? <span className="mt-1 block text-xs font-semibold text-text-2 sm:hidden">In {usedIn[o.supplierQuoteId]!.join(" · ")}</span> : null}
                          </td>
                          <td className="border-b border-line px-3 py-2.5 text-right align-top whitespace-nowrap tabular max-sm:pl-1">{o.totalCost === null ? "—" : money(o.totalCost, currency)}</td>
                          <td className="border-b border-line px-3 py-2.5 max-sm:hidden">
                            {usedIn[o.supplierQuoteId]?.length ? (
                              <span className="inline-flex rounded-md border border-line px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-text-2">
                                In {usedIn[o.supplierQuoteId]!.join(" · ")}
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className={cn(ticked.includes("own") && "bg-surface-2/60")}>
                      <td className="px-3 py-2.5 align-top max-sm:px-2.5">
                        <input id="offer-own" type="checkbox" checked={ticked.includes("own")} onChange={() => toggle("own")} className="size-4 accent-[var(--color-primary)]" />
                      </td>
                      <td className="px-3 py-2.5" colSpan={3}>
                        <label htmlFor="offer-own" className="block cursor-pointer font-semibold">
                          Own prices
                        </label>
                        <span className="block text-xs text-text-2">No supplier offer: the items they asked for, priced by hand</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {s.errors?.offer && <p className="text-xs text-bad">{s.errors.offer}</p>}
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-md font-semibold">Drafts</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Currency" htmlFor="nq-currency" error={s.errors?.currency ?? (offersFailed ? [offersFailed] : undefined)}>
                  <Select id="nq-currency" name="currency" value={currency} onChange={(e) => void changeCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Valid until" htmlFor="nq-valid" error={s.errors?.validUntil}>
                  <Input id="nq-valid" name="validUntil" type="date" defaultValue={s.values?.validUntil ?? defaults.validUntil} />
                </Field>
                <Field label="Margin" htmlFor="nq-margin" error={s.errors?.margin ?? (marginOk ? undefined : "From 0 up to 99.9%")}>
                  <Input id="nq-margin" name="margin" inputMode="decimal" unit="%" value={margin} onChange={(e) => setMargin(e.target.value)} />
                </Field>
              </div>
              {rows.length > 0 && (
                <div className="relative scroll-x rounded-xl border border-line">
                  <table data-fit className="w-full border-collapse text-md">
                    <THead>
                      <tr>
                        <Th scope="col">
                          Quotation
                        </Th>
                        <Th scope="col">
                          From
                        </Th>
                        <Th scope="col" className="text-right">
                          Total
                        </Th>
                      </tr>
                    </THead>
                    <tbody>
                      {rows.map((id, i) => {
                        const o = offers?.offers.find((x) => x.supplierQuoteId === id);
                        const total = id === "own" ? 0 : totalOf(id);
                        return (
                          <tr key={id} className="last:[&>td]:border-b-0">
                            <td className="border-b border-line px-3 py-2 font-semibold">{next[i]}</td>
                            <td className="border-b border-line px-3 py-2">{o ? shortName(o.factory.name) : "Own prices"}</td>
                            <td className="border-b border-line px-3 py-2 text-right whitespace-nowrap tabular">
                              {id === "own" ? "To price" : total === null ? "—" : money(total, currency)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </fieldset>

            <WindowFooter>
              <SubmitButton pendingText="Making…" disabled={!ticked.length || !marginOk}>
                <Check aria-hidden /> {ticked.length === 1 ? "Make the draft" : `Make ${ticked.length || ""} drafts`}
              </SubmitButton>
            </WindowFooter>
          </>
        )}
      </ActionForm>
    </PanelBody>
  );
}

/* ---------------------------------------------------------------- the customer's answer */

type Answer = "accepted" | "no" | "expired";

/**
 * "Customer answered" on a sent quotation: they accepted it (the order is made from it), they said no (it is
 * recorded as rejected; the inquiry is closed as lost only when nothing else is waiting, or when asked), or no
 * answer came before it ran out.
 */
export function AnswerButton({
  number,
  refNo,
  customer,
  options,
  currency,
  today,
  answerAction,
  noAction,
  others,
  overdue,
  route,
  variant = "primary",
}: {
  number: number;
  refNo: string;
  customer: string;
  options: OptionView[];
  currency: string;
  today: string;
  answerAction: Action;
  noAction: Action;
  /** The deal's other quotations still with the customer (accepting this one makes them Not chosen; saying no
   * to this one leaves the inquiry open while they wait). */
  others: string[];
  overdue: boolean;
  route: PaymentRoute | null;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<Answer>("accepted");
  const choices: { key: Answer; label: string }[] = [
    { key: "accepted", label: "Accepted" },
    { key: "no", label: "Said no" },
    { key: "expired", label: "No answer" },
  ];
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        Customer answered
      </Button>
      {open && (
        <SidePanel title={`Customer answered · ${refNo} R${number}`} description={customer} onClose={() => setOpen(false)} className={RULES.window.wideRows}>
          <ChoiceChips
            label="Their answer"
            className="px-6 pt-4 max-md:px-4"
            value={answer ?? ""}
            items={choices.map((c) => ({ value: c.key, label: c.key === "expired" && overdue ? `${c.label} · ran out` : c.label }))}
            onChange={setAnswer}
          />
          {answer === "accepted" && (
            <AcceptForm options={options} currency={currency} action={answerAction} today={today} route={route} others={others} onOrder={(o) => router.push(`/orders/${o.orderId}`)} />
          )}
          {answer === "no" && <SaidNoForm action={noAction} today={today} number={number} othersWaiting={others.length} />}
          {answer === "expired" && <ExpiredForm action={answerAction} today={today} number={number} />}
        </SidePanel>
      )}
    </>
  );
}

/** They said no: why (for the reports); the inquiry is closed as lost when nothing else is waiting, or when ticked. */
function SaidNoForm({ action, today, number, othersWaiting }: { action: Action; today: string; number: number; othersWaiting: number }) {
  const close = useClosePanel();
  const [closeDeal, setCloseDeal] = useState(othersWaiting === 0);
  return (
    <PanelBody>
      <ActionForm action={action} onDone={close} className={PANEL_FORM}>
        {(s) => (
          <>
            <Field label="Why" htmlFor="no-reason" error={s.errors?.lostReason}>
              <Select id="no-reason" name="lostReason" defaultValue={s.values?.lostReason ?? ""}>
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
            <Field label="Note" optional htmlFor="no-note" error={s.errors?.note}>
              <Textarea id="no-note" name="note" rows={3} className="min-h-0" defaultValue={s.values?.note} />
            </Field>
            <Field label="Answered on" htmlFor="no-on" optional error={s.errors?.on}>
              <Input id="no-on" name="on" type="date" max={today} className="w-44" defaultValue={s.values?.on} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="close" checked={closeDeal} onChange={(e) => setCloseDeal(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
              Close the inquiry as lost
            </label>
            <WhatHappens
              lines={[
                <>
                  R{number} is marked <strong>Rejected</strong>.
                </>,
                closeDeal ? (
                  <>
                    The inquiry closes as <strong>Lost</strong>, with the reason.
                  </>
                ) : (
                  `The inquiry stays open${othersWaiting ? `: ${othersWaiting === 1 ? "another quotation is" : `${othersWaiting} other quotations are`} still with the customer` : ""}.`
                ),
              ]}
            />
            <WindowFooter>
              <SubmitButton variant={closeDeal ? "danger" : "primary"} pendingText="Saving…">
                {closeDeal ? "Mark as lost" : `Mark R${number} rejected`}
              </SubmitButton>
            </WindowFooter>
          </>
        )}
      </ActionForm>
    </PanelBody>
  );
}
