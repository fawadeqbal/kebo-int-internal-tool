import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, Clock, Download, Eye, Pencil } from "lucide-react";
import { BALANCE_TERMS_LABEL, BASIS_STEP_LABEL, can, type BasisStep } from "@kebo/shared";
import { Alert, Badge, buttonClass, ButtonLink, Card, CardBody, CardHeader, RefCode, RevisionBadge, StatusBadge, Td, Th, THead, Tr } from "@kebo/ui";
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
import { DetailsCard, ViewCard, type DetailField } from "@/components/orders/step-view";
import { StartRevision } from "@/components/deals/quotation-panels";
import { AnswerCard, MarkSentButton, OptionsCard, TermsPanel } from "@/components/deals/quotation-step";
import { PriceEditor } from "@/components/deals/price-editor";
import { createRevisionAction, lostAction, moveRevisionAction, offersAction, revisionFieldsAction, updateRevisionAction } from "./actions";

export const metadata = { title: "Quotation" };

/** Board "What each status means". */
const STATUS_MEANING: [RevisionView["status"], string][] = [
  ["draft", "Being made. Only one draft at a time."],
  ["sent", "Out to the customer, waiting for an answer."],
  ["accepted", "Customer said yes to one option; the order is made."],
  ["rejected", "Customer said no to this revision."],
  ["expired", "Passed its valid-until date with no answer."],
  ["superseded", "Replaced by a newer revision."],
  ["void", "Was accepted, but its order was cancelled."],
];

const printHref = (r: { id: string }) => `/print/revisions/${r.id}`;
const pdfHref = (r: { id: string }) => `/pdf/revisions/${r.id}`;

/**
 * Step 3, Quotation (board InqV4Quotation): only the current revision — its
 * terms, its options (one open, its lines read only, the costing folded) —
 * then sending and the customer's answer, and the earlier revisions one line
 * each. View / Print and Download PDF in the header, unchanged.
 */
export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ start?: string; edit?: string; option?: string; add?: string }>;
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
            ? { title: "No quotation yet", description: "Each option you offer is one factory's offer from Factory prices, with your prices. The customer accepts one option." }
            : undefined
        }
        openHref={props.empty ? "?start=1" : undefined}
      />
    ) : null;
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
  const terms = current && (
    <DetailsCard
      title={`R${current.number} · terms`}
      description={
        current.status === "draft"
          ? "Draft: only you see it, and it can still change."
          : current.sentOn
            ? `Sent ${date(current.sentOn)}: frozen. A change needs a new revision.`
            : undefined
      }
      fields={termsFields(current)}
      action={editTerms ? revisionFieldsAction.bind(null, d.id, draft!.id) : undefined}
      canEdit={editTerms}
      panelTitle={`R${current.number} · terms`}
      panelDescription="Printed on the quotation. Changing the currency converts the prices."
      panelBody={
        editTerms ? (
          <TermsPanel number={draft!.number} initial={draftValues!} offers={offers!} loadOffers={loadOffers} showCosts={showCosts} action={updateRevisionAction.bind(null, d.id, draft!.id)} />
        ) : undefined
      }
    />
  );

  const waitingLive = !draft && live?.status === "sent" ? live : null;
  const statusCell = (r: RevisionView) =>
    r.status === "sent" ? (
      <StatusBadge meaning="info">Sent {r.sentOn ? date(r.sentOn) : ""}</StatusBadge>
    ) : r.status === "superseded" ? (
      <Badge tone="primary" dot>
        Superseded{revs.find((x) => x.number === r.number + 1) ? ` by R${r.number + 1}` : ""}
      </Badge>
    ) : (
      <RevisionBadge status={r.status} />
    );

  return (
    <div className="flex flex-col gap-4">
      {/* Board "Quotation — quoted": who we wait for and until when, with a follow-up. */}
      {waitingLive && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#f6d3bd] bg-action-soft px-5 py-4 dark:border-action/30">
          <p className="min-w-0">
            <strong className="block font-bold text-[#8a3a07] dark:text-action">Waiting for {d.customer.name}.</strong>
            <span className="block text-sm text-text-2">
              R{waitingLive.number} sent{waitingLive.sentOn ? ` ${date(waitingLive.sentOn)}` : ""}, valid to {date(waitingLive.validUntil)}.
              {waitingLive.validUntil < today ? " It has passed its date: follow up, or record that it expired." : ""}
            </span>
          </p>
          <span className="flex flex-wrap gap-2">
            {quoter && (
              <PanelButton
                icon={<Clock aria-hidden />}
                label="Add follow-up"
                title="New follow-up"
                description={`On ${d.refNo}. Shows on the dashboard on its day, with a reminder.`}
                body={<FollowUpForm action={addFollowUpAction.bind(null, { key: "inquiryId", id: d.id })} people={people} meId={me.id} today={today} record={`${d.refNo} · ${d.customer.name}`} />}
              />
            )}
            {manage && live?.canAnswer && (
              <Link href="#answer" className={buttonClass("primary", "md")}>
                <Check aria-hidden /> Customer answered…
              </Link>
            )}
          </span>
        </section>
      )}
      {draft && (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-[13px] text-text-2">
          <strong className="text-text">Revision {draft.number}.</strong>{" "}
          {draft.number > 1 ? `R${draft.number - 1} stays as it was sent; this R${draft.number} replaces it once sent.` : "The first quotation: check it, then send it."}
        </p>
      )}
      {accepted && order && (
        <section aria-label="Order created" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/30 bg-ok-soft p-4">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden />
            <span>
              The customer accepted R{accepted.number}
              {accepted.answeredOn ? ` on ${date(accepted.answeredOn)}` : ""}. <span className="font-medium">Order {order.refNo}</span> was created (
              {money(order.total, order.currency)}) — the work continues there.
            </span>
          </p>
          <ButtonLink href={`/orders/${order.id}`} variant="primary" size="sm">
            Go to order {order.refNo}
          </ButtonLink>
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
              description="Each option you offer is one factory's offer from Factory prices, with your prices. The customer accepts one option."
            />
            <CardBody>
              <p className="text-sm text-muted">{q.whyNotStart ?? "The person handling this inquiry makes the quotation."}</p>
            </CardBody>
          </Card>
        ))}

      {draft && checks.length > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft/60 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div>
            <p className="font-medium">Before you send R{draft.number}</p>
            <ul className="mt-0.5 list-disc pl-4 text-text-2">
              {checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className={draft ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" : "contents"}>
      <div className="flex min-w-0 flex-col gap-4">
      {terms}

      {current && (
        <OptionsCard
          key={current.id}
          r={current}
          edit={editTerms ? { showCosts, canAdd: offers!.offers.length + 1 > current.options.length, pricesHref: `${base}/quotation?edit=prices` } : null}
        />
      )}

      </div>
      {draft && (
        <aside className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="flex flex-col gap-2.5 text-[13px]">
              {draft.options.map((o) => (
                <div key={o.id} className="flex justify-between gap-3">
                  <span className="text-text-2">Option {o.letter}</span>
                  <strong className="tabular">{money(o.total, draft.currency)}</strong>
                </div>
              ))}
              <div className="flex justify-between gap-3">
                <span className="text-text-2">Deposit ({draft.depositPercent}%)</span>
                <strong className="tabular">
                  {draft.options.map((o) => Math.round((Number(o.total) * draft.depositPercent) / 100).toLocaleString("en-US")).join(" / ")}
                </strong>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`R${draft.number} · draft`} />
            <CardBody className="flex flex-col gap-2">
              <ButtonLink href={printHref(draft)} target="_blank" className="w-full justify-start">
                <Eye aria-hidden /> Preview
              </ButtonLink>
              {editTerms && (
                <ButtonLink href={`${base}/quotation?edit=prices`} variant="brand" className="w-full justify-start">
                  <Pencil aria-hidden /> Edit prices
                </ButtonLink>
              )}
              {manage && <MarkSentButton number={draft.number} action={move(draft)} today={today} className="w-full justify-start" />}
              <p className="text-xs text-muted">Each option is one factory&apos;s offer. Every line of that offer gets a price.</p>
            </CardBody>
          </Card>
        </aside>
      )}
      </div>

      {(draft || live?.canAnswer) && (
        <AnswerCard
          draft={draft ? { number: draft.number } : null}
          live={live?.canAnswer ? { number: live.number, options: live.options, validUntil: live.validUntil, overdue: live.status === "sent" && live.validUntil < today } : null}
          currency={live?.currency ?? draft?.currency ?? ""}
          today={today}
          sendAction={draft && manage ? move(draft) : null}
          answerAction={live?.canAnswer && manage ? move(live) : null}
          lostAction={live?.canAnswer && manage && d.canWork ? lostAction.bind(null, d.id, live.id) : null}
          startNext={!draft && manage && q.canStartRevision ? start({ open: true, label: `Start R${(live?.number ?? 0) + 1} from R${live?.number ?? 1}` }) : null}
        />
      )}

      {closedLive && (
        <ViewCard id="answer" title="Sending and the answer" canEdit={false}>
          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-sm">
              <b>
                {closedLive.status === "rejected" ? `The customer rejected R${closedLive.number}` : `R${closedLive.number} expired`}
              </b>
              {closedLive.answeredOn ? ` on ${date(closedLive.answeredOn)}` : ""}. Try again with a new revision (it starts as a copy of R{closedLive.number}), or close the
              inquiry as lost on the{" "}
              <Link href={base} className="font-medium text-primary hover:underline">
                Overview
              </Link>
              .
            </p>
            {start({})}
          </div>
        </ViewCard>
      )}

      {revs.length > 0 && !draft && (
        <Card className="overflow-clip">
          <CardHeader title={`${q.quotation?.refNo ?? "Quotation"} · revisions`} actions={manage && q.canStartRevision ? start({ label: "New revision" }) : undefined} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <THead>
                <tr>
                  <Th>Revision</Th>
                  <Th>Made</Th>
                  <Th>Options</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Valid until</Th>
                  <Th>Status</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {revs.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <RefCode>R{r.number}</RefCode>
                    </Td>
                    <Td className="whitespace-nowrap">{date(r.createdAt)}</Td>
                    <Td>{r.options.map((o) => `${o.letter}${o.factory ? ` ${o.factory.name.split(" ")[0]}` : ""}`).join(" · ")}</Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {r.currency} {r.options.map((o) => Math.round(Number(o.total)).toLocaleString("en-US")).join(" / ")}
                    </Td>
                    <Td className="whitespace-nowrap">{date(r.validUntil)}</Td>
                    <Td>{statusCell(r)}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <span className="inline-flex gap-1.5">
                        {r.canAnswer && manage && (
                          <Link href="#answer" className={buttonClass("primary", "sm")}>
                            <Check aria-hidden /> Customer accepted…
                          </Link>
                        )}
                        <ButtonLink href={printHref(r)} target="_blank" size="sm">
                          <Eye aria-hidden /> View
                        </ButtonLink>
                        <a href={pdfHref(r)} className={buttonClass("ghost", "sm")} aria-label={`Download R${r.number} as PDF`}>
                          <Download aria-hidden /> PDF
                        </a>
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {revs.length > 0 && (
        <Card>
          <CardHeader title="What each status means" />
          <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STATUS_MEANING.map(([st, words]) => (
              <div key={st} className="flex flex-col gap-1.5">
                <RevisionBadge status={st} />
                <span className="text-[13px] text-text-2">{words}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>

  );
}

/** The terms card's values: currency, delivery, validity, deposit, balance, and the printed terms and notes. */
function termsFields(r: RevisionView): DetailField[] {
  const printed = [
    r.paymentTerms && { k: "Payment", v: r.paymentTerms },
    r.deliveryTerms && { k: "Delivery", v: r.deliveryTerms },
    r.notes && { k: "Notes", v: r.notes },
  ].filter((x): x is { k: string; v: string } => !!x);
  return [
    { label: "Currency", value: r.currency },
    { label: "Delivery", value: r.incoterm, show: `${r.incoterm}${r.incotermPlace ? ` ${r.incotermPlace}` : ""}` },
    { name: "validUntil", label: "Valid until", type: "date", value: r.validUntil, show: date(r.validUntil) },
    { label: "Deposit", value: String(r.depositPercent), show: `${r.depositPercent}%` },
    { label: "Balance", value: r.balanceTerms, show: BALANCE_TERMS_LABEL[r.balanceTerms] },
    {
      name: "notes",
      label: "Terms and notes",
      type: "textarea",
      value: printed.length ? printed.map((p) => p.v).join("\n") : null,
      show: (
        <span className="flex flex-col gap-0.5 font-normal">
          {printed.map((p) => (
            <span key={p.k} className="line-clamp-3 whitespace-pre-line">
              <span className="text-xs text-muted">{p.k}: </span>
              {p.v}
            </span>
          ))}
        </span>
      ),
    },
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
