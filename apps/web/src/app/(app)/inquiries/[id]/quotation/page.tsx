import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Clock, Download, Eye, Pencil, Printer, Send } from "lucide-react";
import { BALANCE_TERMS_LABEL, BASIS_STEP_LABEL, can, routeFromTerms, SENT_VIA_TEXT, type BasisStep } from "@kebo/shared";
import { Alert, Badge, buttonClass, ButtonLink, Card, CardBody, CardHeader, cn, RevisionBadge, StatusBadge } from "@kebo/ui";
import { PanelButton } from "@/components/orders/step-view";
import { FollowUpForm } from "@/components/notes/note-forms";
import { addFollowUpAction } from "../../../follow-ups/actions";
import { getPeople } from "@/lib/loaders";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, money, TZ } from "@/lib/format";
import { dealOf, quotationOf } from "@/lib/deal-data";
import type { QuoteOffers, RevisionDraft, RevisionView } from "@/lib/types-deals";
import { DetailsCard, type DetailField } from "@/components/orders/step-view";
import { StartRevision } from "@/components/deals/quotation-panels";
import { MarkSentButton, OptionsCard, QuotationNext, TermsPanel } from "@/components/deals/quotation-step";
import { WithSide } from "../side";
import { PriceEditor } from "@/components/deals/price-editor";
import { createRevisionAction, emailRevisionAction, lostAction, moveRevisionAction, offersAction, revisionFieldsAction, updateRevisionAction } from "./actions";
import { SendQuoteCard } from "@/components/deals/send-quote";

export const metadata = { title: "Quotation" };

const printHref = (r: { id: string }) => `/print/revisions/${r.id}`;
const pdfHref = (r: { id: string }) => `/pdf/revisions/${r.id}`;

/**
 * Quotations: one line per revision (made, its options, total, valid until, status; View and PDF). A click
 * opens a line in place: its terms (Edit: the form in the panel), its options and the lines the customer
 * sees (Edit lines: the lines editor), the internal costing folded. Only a draft can change; a sent one is
 * kept as sent. "Do next" on top holds the buttons: Send, then the customer's answer (accepted, lost, revise).
 */
export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ start?: string; edit?: string; option?: string; add?: string; send?: string; rev?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const [d, q, people] = await Promise.all([dealOf(id), quotationOf(id), getPeople().catch(() => [])]);
  const quoter = can(me, "quotations.manage");
  const manage = quoter && d.allowed.quote;
  const showCosts = can(me, "sourcing.manage");
  const today = todayIn(TZ);
  const base = `/inquiries/${d.id}`;
  const revs = [...q.revisions].sort((a, b) => b.number - a.number);
  const draft = revs.find((r) => r.status === "draft") ?? null;
  const live = revs.find((r) => r.status !== "draft") ?? null;
  const current = draft ?? live;
  // The editor's values and what it can offer (each factory offer, costed in the quotation currency).
  const [startValues, draftValues] = await Promise.all([
    manage && q.canStartRevision ? api.get<RevisionDraft>(`/inquiries/${id}/quotation/draft`).catch(() => null) : null,
    manage && draft ? api.get<RevisionDraft>(`/revisions/${draft.id}/values`).catch(() => null) : null,
  ]);
  const currencyOf = draftValues?.currency ?? startValues?.currency;
  const offers = manage && currencyOf ? await api.get<QuoteOffers>(`/inquiries/${id}/quotation/offers`, { currency: currencyOf }).catch(() => null) : null;
  const loadOffers = offersAction.bind(null, d.id);
  const accepted = revs.find((r) => r.status === "accepted");
  const order = d.orders.find((o) => o.status !== "cancelled");
  const move = (r: RevisionView) => moveRevisionAction.bind(null, d.id, r.id);
  const checks = draft ? draftChecks(draft) : [];
  // R1 starts from the offer the API picks: say which, so nobody has to guess.
  const firstOffer = revs.length === 0 && startValues?.options[0]?.factoryQuoteId ? (offers?.offers.find((o) => o.factoryQuoteId === startValues.options[0]!.factoryQuoteId) ?? null) : null;
  // What R1 starts with, under the editor's title (and over the button while it is closed).
  const startNote = firstOffer ? (
    <>
      Starts with <b className="font-semibold text-text">{firstOffer.factory.name}</b>:{" "}
      {firstOffer.coverage.missing.length ? `covers all but ${firstOffer.coverage.missing.join(", ")}` : "covers everything asked for"}
      {showCosts && firstOffer.totalCost ? `, cost ${money(firstOffer.totalCost, offers!.currency)}` : ""}, priced at your default {offers!.defaultMargin}%.
      {offers!.offers.length > 1 ? " Add more offers as Options B, C… for the customer to choose from." : ""}
    </>
  ) : undefined;
  const start = (props: { open?: boolean; label?: string; empty?: boolean }) =>
    quoter ? (
      <StartRevision
        key={props.open ? "open" : "closed"}
        action={createRevisionAction.bind(null, d.id)}
        draft={startValues}
        offers={offers}
        loadOffers={loadOffers}
        allowed={manage && q.canStartRevision && !!startValues}
        whyNot={q.whyNotStart ?? (!manage ? "Only the person handling this inquiry (or a manager) can quote." : null)}
        showCosts={showCosts}
        first={revs.length === 0}
        defaultOpen={props.open}
        label={props.label}
        note={revs.length === 0 ? startNote : undefined}
        empty={
          props.empty
            ? { title: "No quotation yet", description: "Each option you offer is one factory's offer from Factory offers, with your prices. The customer accepts one option." }
            : undefined
        }
        openHref={props.empty ? "?start=1" : undefined}
      />
    ) : null;
  // Send (board QuoteSend): the quotation as printed, beside the email to the customer.
  const sending = sp.send && manage ? revs.find((r) => r.id === sp.send && (r.status === "draft" || r.status === "sent")) : undefined;
  if (sending) {
    const who = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0];
    const copy = d.customer.contacts.filter((c) => c.email && c.id !== who?.id).map((c) => c.email);
    const quoteRef = `${d.quotation?.refNo ?? d.refNo} R${sending.number}`;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={`${base}/quotation`}>
            <Pencil aria-hidden /> Back to edit
          </ButtonLink>
          <ButtonLink href={printHref(sending)} target="_blank">
            <Printer aria-hidden /> Print
          </ButtonLink>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-[999_1_640px] overflow-hidden rounded-2xl border border-line bg-surface">
            <iframe title={`${quoteRef} as printed`} src={`${printHref(sending)}?embed=1`} className="h-[1100px] w-full border-0" />
          </div>
          <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
            <SendQuoteCard
              number={sending.number}
              action={emailRevisionAction.bind(null, d.id, sending.id, `${quoteRef}.pdf`)}
              to={who?.email ?? ""}
              cc={copy.slice(0, 2).join(", ")}
              subject={`Quotation ${quoteRef} — ${d.title}`}
              message={`Dear ${who?.name.split(" ")[0] ?? "Sir or Madam"}, please find our ${sending.number > 1 ? "revised " : ""}quotation for ${d.title}.`}
              pdfHref={pdfHref(sending)}
              backHref={`${base}/quotation`}
              markSent={
                sending.status === "draft" ? (
                  <MarkSentButton number={sending.number} action={move(sending)} today={today} variant="ghost" label="Sent another way — mark as sent" icon={<Check aria-hidden />} doneHref={`${base}/quotation`} />
                ) : null
              }
            />
          </aside>
        </div>
      </div>
    );
  }
  // The customer said no (or let it lapse) and nothing new is being drafted: the next step is a new revision.
  const closedLive = !draft && live && (live.status === "rejected" || live.status === "expired") ? live : null;

  const editTerms = !!(draft && manage && draftValues && offers);

  // "Edit prices": the page itself becomes the price editor, full width (no side column, nothing else on it).
  if (sp.edit === "prices" && editTerms)
    return (
      <PriceEditor
        key={draft!.id}
        action={updateRevisionAction.bind(null, d.id, draft!.id)}
        number={draft!.number}
        initial={draftValues!}
        offers={offers!}
        showCosts={showCosts}
        initialOption={Number(sp.option) || 0}
        startAdding={sp.add === "1"}
        backHref={`${base}/quotation`}
      />
    );
  // The terms of a revision as a card: the draft's with Edit (the form in the panel), a sent one's read only.
  const termsOf = (r: RevisionView) => {
    const editable = editTerms && r.id === draft!.id;
    return (
      <DetailsCard
        title={`R${r.number} · terms`}
        description={r.status === "draft" ? "Draft: only you see it, and it can still change." : undefined}
        fields={termsFields(r)}
        action={editable ? revisionFieldsAction.bind(null, d.id, r.id) : undefined}
        canEdit={editable}
        panelTitle={`R${r.number} · terms`}
        panelDescription="Printed on the quotation. Changing the currency converts the prices."
        panelBody={
          editable ? (
            <TermsPanel number={r.number} initial={draftValues!} offers={offers!} loadOffers={loadOffers} showCosts={showCosts} action={updateRevisionAction.bind(null, d.id, r.id)} />
          ) : undefined
        }
      />
    );
  };

  const statusCell = (r: RevisionView) =>
    r.status === "sent" ? (
      <StatusBadge meaning="info">Sent</StatusBadge>
    ) : r.status === "superseded" ? (
      <Badge tone="neutral" dot>
        Replaced
      </Badge>
    ) : (
      <RevisionBadge status={r.status} />
    );
  const quoRef = q.quotation?.refNo ?? d.quotation?.refNo ?? d.refNo;
  const totalOf = (r: RevisionView) => {
    const totals = r.options.map((o) => Number(o.total));
    const taken = r.options.find((o) => o.status === "accepted");
    if (taken) return money(taken.total, r.currency);
    return `${new Set(totals).size > 1 ? "from " : ""}${money(Math.min(...totals), r.currency)}`;
  };
  // Which line is open: the current revision unless another was clicked ("none": all closed).
  const openId = sp.rev === "none" ? null : (revs.find((r) => r.id === sp.rev)?.id ?? current?.id ?? null);
  const waiting = !draft && live?.status === "sent" ? live : null;
  const next = (
    <QuotationNext
      customer={d.customer.name}
      quoRef={quoRef}
      draft={
        draft
          ? {
              number: draft.number,
              meta: `${draft.options.length === 1 ? "1 option" : `${draft.options.length} options`}, ${totalOf(draft)} · valid until ${date(draft.validUntil)}`,
              previewHref: printHref(draft),
              sendHref: manage ? `${base}/quotation?send=${draft.id}` : null,
            }
          : null
      }
      live={
        live?.canAnswer
          ? {
              number: live.number,
              options: live.options,
              meta: `${live.sentOn ? `sent ${date(live.sentOn)}${live.sentVia ? ` ${SENT_VIA_TEXT[live.sentVia]}` : ""} · ` : ""}valid until ${date(live.validUntil)}${live.status === "sent" && live.validUntil < today ? ", which has passed" : ""}`,
              overdue: live.status === "sent" && live.validUntil < today,
            }
          : null
      }
      closed={closedLive ? { number: closedLive.number, how: closedLive.status === "rejected" ? "rejected" : "expired" } : null}
      currency={live?.currency ?? draft?.currency ?? ""}
      today={today}
      answerAction={live?.canAnswer && manage ? move(live) : null}
      lostAction={live?.canAnswer && manage && d.canWork ? lostAction.bind(null, d.id, live.id) : null}
      startNext={!draft && manage && q.canStartRevision ? start({ open: true, label: `Start R${(live?.number ?? 0) + 1} from R${live?.number ?? 1}` }) : null}
      followUp={
        waiting && quoter ? (
          <PanelButton
            variant="ghost"
            icon={<Clock aria-hidden />}
            label="Add follow-up"
            title="New follow-up"
            description={`On ${d.refNo}. Shows on the dashboard on its day, with a reminder.`}
            body={<FollowUpForm action={addFollowUpAction.bind(null, { key: "inquiryId", id: d.id })} people={people} meId={me.id} today={today} record={`${d.refNo} · ${d.customer.name}`} />}
          />
        ) : undefined
      }
      subtitle={`${quoRef} · ${d.customer.name}`}
      route={live ? routeFromTerms(live.balanceTerms).route : null}
    />
  );
  const COLS = "md:grid-cols-[16px_48px_96px_minmax(0,1fr)_170px_104px_104px]";

  return (
    <WithSide id={id} top={accepted && order ? null : (draft || live?.canAnswer || closedLive) && next}>
      {accepted && order && (
        <section aria-label="Order created" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/30 bg-ok-soft p-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden />
            <span>
              {d.customer.name} accepted R{accepted.number}
              {accepted.answeredOn ? ` on ${date(accepted.answeredOn)}` : ""}. Sales order <span className="font-medium">{order.refNo}</span> was made (
              {money(order.total, order.currency)}); the work continues there.
            </span>
          </p>
        </section>
      )}

      {revs.length > 0 && !manage && !(accepted && order) && (
        <Alert tone="info">
          {quoter && q.whyNotStart ? q.whyNotStart : "Only the person handling this inquiry (or a manager) can change the quotation or record the customer's answer."}
        </Alert>
      )}

      {revs.length === 0 &&
        (quoter ? (
          start({ open: sp.start === "1", empty: true })
        ) : (
          <Card>
            <CardHeader
              title="No quotation yet"
              description="Each option you offer is one factory's offer from Factory offers, with your prices. The customer accepts one option."
            />
            <CardBody>
              <p className="text-sm text-muted">{q.whyNotStart ?? "The person handling this inquiry makes the quotation."}</p>
            </CardBody>
          </Card>
        ))}

      {revs.length > 0 && (
        <Card className="overflow-clip">
          <CardHeader
            title={
              <>
                Quotations<span className="font-normal text-text-2"> · {quoRef}</span>
              </>
            }
          />
          <div className={cn("hidden items-center gap-x-4 border-b border-line py-2 pr-[124px] pl-5 text-xs font-medium text-text-2 md:grid", COLS)}>
            <span />
            <span>Rev.</span>
            <span>Made</span>
            <span>Options</span>
            <span className="text-right">Total</span>
            <span>Valid until</span>
            <span>Status</span>
          </div>
          {revs.map((r) => {
            const open = r.id === openId;
            const isDraft = r.status === "draft";
            return (
              <div key={r.id} id={open ? "revision" : undefined} className="scroll-mt-24 border-b border-line last:border-b-0">
                <div className={cn("flex items-center", open && "bg-primary-soft/40")}>
                  <Link
                    href={open ? `${base}/quotation?rev=none` : `${base}/quotation?rev=${r.id}#revision`}
                    scroll={false}
                    aria-expanded={open}
                    className={cn("grid min-w-0 flex-1 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 pl-5 text-sm hover:bg-surface-2/60 max-md:pr-4", COLS)}
                  >
                    {open ? <ChevronDown className="size-4 text-text-2" aria-hidden /> : <ChevronRight className="size-4 text-text-2" aria-hidden />}
                    <span className="font-semibold max-md:hidden">R{r.number}</span>
                    <span className="whitespace-nowrap max-md:hidden">{date(r.createdAt)}</span>
                    <span className="min-w-0">
                      <span className="font-semibold md:hidden">R{r.number} · </span>
                      {r.options.map((o, i) => (
                        <span key={o.id} className={o.status === "accepted" ? "font-semibold" : undefined}>
                          {i > 0 && " · "}
                          {o.letter}
                          {o.factory ? ` ${o.factory.name.split(" ")[0]}` : ""}
                          {o.status === "accepted" ? ", chosen" : ""}
                        </span>
                      ))}
                      <span className="block text-xs text-text-2 md:hidden">
                        {date(r.createdAt)} · valid until {date(r.validUntil)}
                      </span>
                    </span>
                    <span className="text-right font-semibold whitespace-nowrap tabular max-md:col-start-2 max-md:text-left">{totalOf(r)}</span>
                    <span className="whitespace-nowrap max-md:hidden">{date(r.validUntil)}</span>
                    <span className="max-md:col-start-3 max-md:row-start-1">{statusCell(r)}</span>
                  </Link>
                  <span className="flex w-[124px] shrink-0 justify-end gap-3 pr-5 text-[13px] font-medium max-md:hidden">
                    <a href={printHref(r)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      View
                    </a>
                    <a href={pdfHref(r)} className="text-primary hover:underline" aria-label={`Download R${r.number} as PDF`}>
                      PDF
                    </a>
                  </span>
                </div>
                {open && (
                  <div className="flex flex-col gap-4 border-t border-line bg-surface-2/40 p-2 sm:p-4 md:pl-12">
                    {isDraft && checks.length > 0 && (
                      <div role="status" className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft/60 px-4 py-3 text-sm">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                        <div>
                          <p className="font-medium">Before you send R{r.number}</p>
                          <ul className="mt-0.5 list-disc pl-4 text-text-2">
                            {checks.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    {!isDraft && r.sentOn && (
                      <p className="rounded-lg bg-primary-soft/60 px-3 py-2 text-[13px]">
                        Sent {date(r.sentOn)}
                        {r.sentVia && <b className="font-semibold"> {SENT_VIA_TEXT[r.sentVia]}</b>}.{" "}
                        {r.status === "accepted"
                          ? `Accepted${r.answeredOn ? ` ${date(r.answeredOn)}` : ""}: the order was made from it, and it is kept exactly as sent.`
                          : r.status === "sent" && !draft
                            ? `It is kept exactly as sent: a change needs R${revs[0]!.number + 1}.`
                            : "It is kept exactly as sent."}
                      </p>
                    )}
                    {termsOf(r)}
                    <OptionsCard
                      key={r.id}
                      r={r}
                      edit={isDraft && editTerms ? { showCosts, canAdd: offers!.offers.length + 1 > r.options.length, pricesHref: `${base}/quotation?edit=prices` } : null}
                    />
                    <div className="flex flex-wrap gap-2">
                      <ButtonLink href={printHref(r)} target="_blank" size="sm">
                        <Eye aria-hidden /> View / Print
                      </ButtonLink>
                      <a href={pdfHref(r)} className={buttonClass("secondary", "sm")}>
                        <Download aria-hidden /> Download PDF
                      </a>
                      {r.status === "sent" && manage && (
                        <ButtonLink href={`${base}/quotation?send=${r.id}`} size="sm" variant="ghost">
                          <Send aria-hidden /> Send again
                        </ButtonLink>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </WithSide>
  );
}

/**
 * Everything a revision keeps, on its card: currency, delivery, validity, deposit, balance, lead time, the
 * printed payment, delivery and warranty lines, the notes, and when it was made, sent (and how) and answered.
 */
function termsFields(r: RevisionView): DetailField[] {
  const long = (v: string | null) => (v ? <span className="line-clamp-4 font-normal whitespace-pre-line">{v}</span> : undefined);
  return [
    { label: "Currency", value: r.currency },
    { label: "Delivery", value: r.incoterm, show: `${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""}` },
    { name: "validUntil", label: "Valid until", type: "date", value: r.validUntil, show: date(r.validUntil) },
    { label: "Deposit", value: String(r.depositPercent), show: `${r.depositPercent}%` },
    { label: "Balance", value: r.balanceTerms, show: BALANCE_TERMS_LABEL[r.balanceTerms] },
    { label: "Lead time", value: r.leadTime, show: r.leadTime ? `${r.leadTime}${r.figuresOf ? ` (${r.figuresOf})` : ""}` : undefined },
    { name: "paymentTerms", label: "Payment terms", type: "textarea", value: r.paymentTerms, show: long(r.paymentTerms) },
    { name: "deliveryTerms", label: "Delivery terms", type: "textarea", value: r.deliveryTerms, show: long(r.deliveryTerms) },
    { name: "warranty", label: "Warranty", value: r.warranty, show: long(r.warranty) },
    { name: "notes", label: "Notes", type: "textarea", value: r.notes, show: long(r.notes) },
    { label: "Made", value: r.createdAt, show: date(r.createdAt), uncounted: true },
    // A draft has not gone anywhere yet: its sent and answered days come with the sending.
    ...(r.status === "draft" ? [] : sentFields(r)),
  ];
}

function sentFields(r: RevisionView): DetailField[] {
  return [
    {
      label: "Sent",
      value: r.sentOn,
      show: r.sentOn ? `${date(r.sentOn)}${r.sentVia ? ` · ${SENT_VIA_TEXT[r.sentVia]}` : ""}` : undefined,
      uncounted: true,
    },
    { label: "Customer answered", value: r.answeredOn, show: r.answeredOn ? date(r.answeredOn) : undefined, uncounted: true },
  ];
}

/** What to look at before a draft goes to the customer: lines without a price, items an option leaves out. */
function draftChecks(r: RevisionView): string[] {
  const many = r.options.length > 1;
  const checks = r.options.flatMap((o) => {
    const who = many ? `Option ${o.letter}` : "The quotation";
    const out: string[] = [];
    const unpriced = o.lines.filter((l) => !(Number(l.unitPrice) > 0)).length;
    if (unpriced) out.push(`${who}: ${unpriced} line${unpriced === 1 ? "" : "s"} without a price.`);
    if (o.factory && o.coverage.missing.length)
      out.push(`${who} does not include ${o.coverage.missing.join(", ")}; the customer will see ${o.coverage.missing.length === 1 ? "it" : "them"} missing.`);
    // People who see costs: the costs to reach our basis (freight…) are part of the price, so a missing one makes the margin look better than it is.
    if (o.costing && o.factory) {
      if (o.factoryBasis === null) out.push(`${who}: the factory's price basis is not said, so the costs to reach ${r.incoterm} are not in its cost.`);
      else if (o.gap) {
        const have = new Set((o.costs ?? []).map((c) => c.step));
        const asLine = (step: BasisStep) => o.lines.some((l) => l.type === "charge" && l.description.toLowerCase().startsWith(BASIS_STEP_LABEL[step].toLowerCase().split(" ")[0]!));
        const missing = o.gap.needed.filter((x) => !have.has(x) && !asLine(x));
        if (missing.length)
          out.push(`${who}: ${missing.map((x) => BASIS_STEP_LABEL[x].toLowerCase()).join(" and ")} to reach ${r.incoterm} ${missing.length === 1 ? "is" : "are"} not entered, so its cost and margin are too low.`);
      }
    }
    if (o.costing && o.costing.marginPercent !== null && o.costing.marginPercent < 0) out.push(`${who} sells below cost.`);
    return out;
  });
  return checks;
}
