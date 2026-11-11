import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { BALANCE_TERMS_LABEL, BASIS_STEP_LABEL, can, type BasisStep } from "@kebo/shared";
import { Alert, buttonClass, ButtonLink, Card, CardBody, CardHeader, RevisionBadge } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { FileActions } from "@/components/common/file-actions";
import { hasFeature, requireUser } from "@/lib/session";
import { date, money, TZ } from "@/lib/format";
import { dealHistoryOf, dealOf, quotationOf } from "@/lib/deal-data";
import type { QuoteOffers, RevisionDraft, RevisionView } from "@/lib/types-deals";
import { optional } from "@/components/print/data";
import { StepChanges, StepFrame, StepHeader, StepPrevNext } from "@/components/orders/step-page";
import { DetailsCard, ViewCard, type DetailField } from "@/components/orders/step-view";
import { StartRevision } from "@/components/deals/quotation-panels";
import { AnswerCard, MarkSentButton, OptionsCard, TermsPanel } from "@/components/deals/quotation-step";
import { changesIn, FilesCard } from "@/components/deals/inquiry-side";
import { PriceEditor } from "@/components/deals/price-editor";
import { inquirySteps } from "../steps";
import { createRevisionAction, lostAction, moveRevisionAction, offersAction, revisionFieldsAction, updateRevisionAction } from "./actions";

export const metadata = { title: "Quotation" };

const printHref = (r: { id: string }) => `/print/revisions/${r.id}`;
const pdfHref = (r: { id: string }) => `/pdf/revisions/${r.id}`;
/** "A USD 63,000 · B USD 56,620" (or the one total). */
const totals = (r: RevisionView) =>
  r.options.length > 1 && r.status !== "accepted"
    ? r.options.map((o) => `${o.letter} ${r.currency} ${Math.round(Number(o.total)).toLocaleString("en-US")}`).join(" · ")
    : `${r.currency} ${Math.round(Number(r.total)).toLocaleString("en-US")}`;

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
  const [d, q, history] = await Promise.all([dealOf(id), quotationOf(id), optional(() => dealHistoryOf(id))]);
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
  const step = inquirySteps(d, showCosts ? 0 : null).find((x) => x.key === "quotation")!;
  const managers = can(me, "expenses.manage") && (await hasFeature("expenses"));
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
  // R1 open: the editor takes the page's full width (no side column).
  const startOpen = revs.length === 0 && sp.start === "1" && manage && q.canStartRevision && !!startValues;
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

  const statusWords = (r: RevisionView) =>
    r.status === "draft"
      ? checks.length
        ? `draft, ${checks.length} to check`
        : "draft, checked"
      : r.status === "sent"
        ? `sent ${date(r.sentOn)}`
        : `${r.status === "superseded" ? "replaced" : r.status}${r.answeredOn ? ` ${date(r.answeredOn)}` : ""}`;
  const line = current
    ? [`${q.quotation?.refNo ?? ""} R${current.number}`.trim(), statusWords(current), totals(current), `valid until ${date(current.validUntil)}`].join(" · ")
    : "No quotation yet: each factory offer becomes an option the customer can choose.";

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
  const earlier = revs.filter((r) => r.id !== current?.id);
  const pdfs = revs.filter((r) => r.status !== "draft").map((r) => ({ id: r.id, name: `${q.quotation?.refNo ?? "Quotation"} R${r.number}.pdf`, href: pdfHref(r) }));

  return (
    <StepFrame
      header={
        <StepHeader
          step={{ number: step.number, label: step.label, state: step.state, stateLabel: step.stateLabel, line }}
          action={
            <>
              {current && <FileActions viewHref={printHref(current)} pdfHref={pdfHref(current)} />}
              {draft && manage && <MarkSentButton number={draft.number} action={move(draft)} today={today} className="max-sm:w-full" />}
              {!draft && live?.canAnswer && manage && (
                <Link href="#answer" className={buttonClass("primary", "md", "max-sm:w-full")}>
                  Record the answer
                </Link>
              )}
              {revs.length === 0 && manage && q.canStartRevision && sp.start !== "1" && (
                <Link href="?start=1" className={buttonClass("primary", "md", "max-sm:w-full")}>
                  Make the quotation
                </Link>
              )}
            </>
          }
        />
      }
      side={
        startOpen ? undefined : (
          <>
            <FilesCard files={pdfs} empty="The PDF of each revision sent shows here." />
            {history && <StepChanges entries={changesIn(history, "quotation")} historyHref={`${base}/history`} />}
          </>
        )
      }
      prevNext={
        <StepPrevNext
          prev={showCosts ? { href: `${base}/sourcing`, label: "Factory prices" } : { href: `${base}/needs`, label: "Needs" }}
          next={managers ? { href: `${base}/costs`, label: "Costs" } : { href: `${base}/history`, label: "History" }}
        />
      }
    >
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

      {terms}

      {current && (
        <OptionsCard
          key={current.id}
          r={current}
          edit={editTerms ? { showCosts, canAdd: offers!.offers.length + 1 > current.options.length, pricesHref: `${base}/quotation?edit=prices` } : null}
        />
      )}

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

      {earlier.length > 0 && (
        <ViewCard title="Earlier revisions" canEdit={false}>
          <ul className="flex flex-col divide-y divide-line px-4">
            {earlier.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 text-sm">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold">R{r.number}</span>
                  <RevisionBadge status={r.status} />
                  <span className="text-xs text-text-2">
                    {[r.sentOn ? `sent ${date(r.sentOn)}` : null, totals(r), r.answeredOn ? `answered ${date(r.answeredOn)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs">
                  <Link href={printHref(r)} target="_blank" className="font-medium text-primary hover:underline">
                    View / Print
                  </Link>
                  <a href={pdfHref(r)} className="font-medium text-primary hover:underline" aria-label={`Download R${r.number} as PDF`}>
                    <FileText className="mr-0.5 inline size-3.5" aria-hidden />
                    PDF
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </ViewCard>
      )}
    </StepFrame>
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
