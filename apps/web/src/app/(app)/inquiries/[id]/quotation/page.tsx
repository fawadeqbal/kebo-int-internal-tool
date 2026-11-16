import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Download, Eye, Pencil, Send } from "lucide-react";
import { BASIS_STEP_LABEL, can, REVISION_STATUS_LABEL, routeFromTerms, SENT_VIA_TEXT, type BasisStep } from "@kebo/shared";
import { Alert, buttonClass, ButtonLink, Card, CardBody, CardHeader, cn, RevisionBadge, StatusBadge } from "@kebo/ui";
import { PanelButton } from "@/components/orders/step-view";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, money, companyToday } from "@/lib/format";
import { dealOf, quotationOf } from "@/lib/deal-data";
import type { QuotationOfDeal, QuoteOffers, RevisionDraft, RevisionView } from "@/lib/types-deals";
import { StartRevision } from "@/components/deals/quotation-panels";
import { QuoteStepsPanel } from "@/components/deals/quotation-step";
import type { QuoteStep } from "@/components/deals/revision-editor";
import { AnswerButton, NewQuotationsButton } from "@/components/deals/quotation-tab";
import { checksOf, CheckChip, optionOf, QuoteLines, QuoteTerms, termsFacts } from "@/components/deals/quote-view";
import { shortName } from "@/components/deals/offer-facts";
import {
  deleteRevisionAction,
  emailRevisionAction,
  moveRevisionAction,
  newQuotationsAction,
  offersAction,
  reviseAction,
  saidNoAction,
  updateRevisionAction,
} from "./actions";
import { DeleteDraftButton, SendWindow } from "@/components/deals/send-quote";
import { inquiryTitle } from "@/lib/titles";

export const generateMetadata = inquiryTitle("Quotation");

const printHref = (r: { id: string }) => `/print/revisions/${r.id}`;
const pdfHref = (r: { id: string }) => `/pdf/revisions/${r.id}`;

/** A quotation's total; a draft still without prices says so. */
const totalText = (r: RevisionView) => (r.status === "draft" && !(Number(r.total) > 0) ? "To price" : money(r.total, r.currency));

/** The revision a quotation shows first: its open draft, else its newest one. */
const currentOf = (q: QuotationOfDeal) => q.revisions.find((r) => r.status === "draft") ?? q.revisions[0]!;

/**
 * Quotations (design "one way, any number"): the deal's quotations, A, B, C…, one row each (its number and
 * offer, total, delivery, payment, warranty, status). A tap opens one in full under its row, read only — a bar
 * with its status, its revisions (R1 ▾) and what can be done; its lines in the clean table; its terms in three
 * groups, each with a pencil on a draft — and a tap again closes it. "New quotations" makes one draft per offer.
 */
export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; rev?: string; start?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const [d, q] = await Promise.all([dealOf(id), quotationOf(id)]);
  const quoter = can(me, "quotations.manage");
  const manage = quoter && d.allowed.quote;
  const showCosts = can(me, "sourcing.manage");
  const today = companyToday();
  const base = `/inquiries/${d.id}`;
  const quotations = q.quotations;

  // The quotation open under its row: the one asked for (?q=), none after a tap that closed it, else the one
  // changed last.
  const lastChanged = [...quotations].sort((a, b) => (currentOf(b).createdAt > currentOf(a).createdAt ? 1 : -1))[0];
  const open = sp.q === "none" ? null : (quotations.find((x) => x.id === sp.q) ?? lastChanged ?? null);
  const draft = open?.revisions.find((r) => r.status === "draft") ?? null;
  const shown = open ? (open.revisions.find((r) => r.id === sp.rev) ?? currentOf(open)) : null;

  // What the windows need: the draft's values (its pencils), the next revision's starting values (New
  // revision) and the offers costed in their currency; New quotations' offers in its own currency.
  const [draftValues, startValues] = await Promise.all([
    manage && draft ? api.get<RevisionDraft>(`/revisions/${draft.id}/values`).catch(() => null) : null,
    manage && open?.canStartRevision ? api.get<RevisionDraft>(`/quotations/${open.id}/draft`).catch(() => null) : null,
  ]);
  const editCurrency = draftValues?.currency ?? startValues?.currency ?? null;
  const loadOffers = offersAction.bind(null, d.id);
  const [editOffers, newOffers] = await Promise.all([
    manage && editCurrency ? loadOffers(editCurrency) : null,
    manage && editCurrency !== q.newDefaults.currency ? loadOffers(q.newDefaults.currency) : null,
  ]);
  const offersForNew = editCurrency === q.newDefaults.currency ? editOffers : newOffers;

  // Which quotations each offer is in (an offer can be quoted again on other terms).
  const usedIn: Record<string, string[]> = {};
  for (const x of quotations) for (const o of currentOf(x).options) if (o.factoryQuoteId) (usedIn[o.factoryQuoteId] ??= []).push(x.letter);
  const letters = quotations.map((x) => x.letter);
  const newButton = (variant: "primary" | "secondary" = "secondary") =>
    manage ? (
      <NewQuotationsButton
        key={sp.start === "1" ? "start" : "button"}
        action={newQuotationsAction.bind(null, d.id)}
        offers={offersForNew}
        loadOffers={loadOffers}
        defaults={q.newDefaults}
        usedIn={usedIn}
        letters={letters}
        variant={variant}
        defaultOpen={sp.start === "1"}
      />
    ) : null;

  const accepted = quotations.flatMap((x) => x.revisions).find((r) => r.status === "accepted");
  const order = d.orders.find((o) => o.status !== "cancelled");
  const waiting = quotations.filter((x) => x.revisions.some((r) => r.status === "sent" && r.canAnswer));

  // "Send R1…": one window with two choices (email it from here, or I sent it myself). A sent one can only be emailed again.
  const who = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0];
  const copy = d.customer.contacts.filter((c) => c.email && c.id !== who?.id).map((c) => c.email);
  const sendWindow = (x: QuotationOfDeal, r: RevisionView) => {
    const quoteRef = `${x.refNo} R${r.number}`;
    return (
      <SendWindow
        number={r.number}
        customer={d.customer.name}
        emailAction={emailRevisionAction.bind(null, d.id, r.id, `${quoteRef}.pdf`)}
        markAction={r.status === "draft" ? moveRevisionAction.bind(null, d.id, r.id) : null}
        to={who?.email ?? ""}
        cc={copy.slice(0, 2).join(", ")}
        subject={`Quotation ${quoteRef} — ${d.title}`}
        message={`Dear ${who?.name.split(" ")[0] ?? "Sir or Madam"}, please find our ${r.number > 1 ? "revised " : ""}quotation for ${d.title}.`}
        fileName={`${quoteRef}.pdf`}
        printHref={printHref(r)}
        pdfHref={pdfHref(r)}
        today={today}
      />
    );
  };

  const statusOf = (x: QuotationOfDeal) => {
    const c = currentOf(x);
    const before = x.revisions.find((r) => r.status !== "draft");
    if (c.status === "draft" && before) return <StatusBadge meaning="neutral">Draft R{c.number}</StatusBadge>;
    return <RevisionBadge status={c.status} />;
  };
  const COLS = "md:grid-cols-[28px_minmax(0,1.5fr)_130px_minmax(0,1.1fr)_96px] xl:grid-cols-[28px_minmax(0,1.5fr)_130px_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.1fr)_96px]";

  return (
    <div className="flex flex-col gap-4">
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
          <ButtonLink href={`/orders/${order.id}`} size="sm">
            Open the order
          </ButtonLink>
        </section>
      )}

      {quotations.length > 0 && !manage && !(accepted && order) && (
        <Alert tone="info">{quoter && q.whyNotStart ? q.whyNotStart : "Only the person handling this inquiry (or a manager) can change the quotations or record the customer's answer."}</Alert>
      )}

      {quotations.length === 0 ? (
        <Card>
          <CardHeader title="Quotations" actions={newButton("primary")} />
          <CardBody>
            <p className="text-sm text-text-2">
              {manage
                ? "None yet. New quotations makes one draft for each factory offer you tick, or one priced by hand."
                : (q.whyNotStart ?? "The person handling this inquiry makes the quotations.")}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card className="overflow-clip">
          <CardHeader
            title={
              <>
                Quotations<span className="font-normal text-text-2"> · {quotations.length}</span>
              </>
            }
            actions={newButton()}
          />
          <div aria-hidden className={cn("hidden items-center gap-x-4 border-b border-line bg-surface-2/60 px-5 py-2 text-xs font-medium text-text-2 md:grid", COLS)}>
            <span />
            <span>Quotation</span>
            <span className="text-right">Total</span>
            <span>Delivery</span>
            <span className="max-xl:hidden">Payment</span>
            <span className="max-xl:hidden">Warranty</span>
            <span>Status</span>
          </div>
          {quotations.map((x) => {
            const isOpen = x.id === open?.id;
            const c = currentOf(x);
            const o = optionOf(c);
            const facts = termsFacts(c);
            const checks = showCosts ? checksOf(c, o) : [];
            const problem = checks.find((k) => !k.ok);
            const from = o?.factory ? shortName(o.factory.name) : o && !o.factoryQuoteId ? "Own prices" : null;
            return (
              <div key={x.id} id={`q-${x.id}`} className="scroll-mt-24 border-b border-line last:border-b-0">
                <Link
                  href={isOpen ? `${base}/quotation?q=none` : `${base}/quotation?q=${x.id}#q-${x.id}`}
                  scroll={false}
                  aria-expanded={isOpen}
                  className={cn(
                    "grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 px-5 py-3 text-[13px] hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text",
                    COLS,
                    isOpen && "bg-surface-2/70",
                  )}
                >
                  <span className={cn("mt-0.5 grid size-6 place-items-center rounded-lg border", isOpen ? "border-text text-text" : "border-line-strong text-text-2")}>
                    {isOpen ? <ChevronUp className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-text">{x.refNo}</span>
                    <span className="block truncate text-xs text-text-2">
                      {[from, `R${c.number}`].filter(Boolean).join(" · ")}
                      <span className="md:hidden"> · {totalText(c)}</span>
                    </span>
                  </span>
                  <span className="text-right font-semibold whitespace-nowrap tabular max-md:hidden">{totalText(c)}</span>
                  <span className="min-w-0 max-md:hidden">
                    <span className="block">{facts.delivery}</span>
                    {facts.lead && <span className="block truncate text-xs text-text-2">{facts.lead}</span>}
                  </span>
                  <span className="min-w-0 max-xl:hidden">{facts.payment || "—"}</span>
                  <span className="min-w-0 max-xl:hidden">
                    <span className="block">{facts.warranty ?? "—"}</span>
                    {problem ? <CheckChip check={problem} /> : checks.length > 0 ? <CheckChip check={{ ...checks[0]!, word: "OK" }} /> : null}
                  </span>
                  <span className="justify-self-end md:justify-self-start">{statusOf(x)}</span>
                </Link>
                {isOpen && shown && (
                  <QuotationOpen
                    x={x}
                    r={shown}
                    base={base}
                    manage={manage}
                    showCosts={showCosts}
                    today={today}
                    customer={d.customer.name}
                    draftValues={shown.status === "draft" ? draftValues : null}
                    startValues={startValues}
                    offers={editOffers}
                    loadOffers={loadOffers}
                    send={manage && (shown.status === "draft" || shown.status === "sent") ? sendWindow(x, shown) : null}
                    dealId={d.id}
                    others={waiting.filter((w) => w.id !== x.id).map((w) => w.refNo)}
                  />
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}

/** One quotation open under its row: the bar (status, R▾, what can be done), its lines and its terms. */
function QuotationOpen({
  x,
  r,
  base,
  manage,
  showCosts,
  today,
  customer,
  draftValues,
  startValues,
  offers,
  loadOffers,
  send,
  dealId,
  others,
}: {
  x: QuotationOfDeal;
  r: RevisionView;
  base: string;
  manage: boolean;
  showCosts: boolean;
  today: string;
  customer: string;
  draftValues: RevisionDraft | null;
  startValues: RevisionDraft | null;
  offers: QuoteOffers | null;
  loadOffers: (currency: string) => Promise<QuoteOffers | null>;
  send: ReactNode | null;
  dealId: string;
  others: string[];
}) {
  const isDraft = r.status === "draft";
  const edit = isDraft && manage && !!draftValues && !!offers;
  const checks = isDraft ? draftChecks(r) : [];
  const sentBefore = x.revisions.find((v) => v.status !== "draft" && v.number < r.number);
  const meta = isDraft
    ? `${sentBefore?.sentOn ? `R${sentBefore.number} sent ${date(sentBefore.sentOn)} · ` : ""}Valid until ${date(r.validUntil)}`
    : `${r.sentOn ? `${date(r.sentOn)}${r.sentVia ? ` ${SENT_VIA_TEXT[r.sentVia]}` : ""} · ` : ""}Valid until ${date(r.validUntil)}${r.status === "sent" && r.validUntil < today ? ", which has passed" : ""}`;
  // Each pencil opens the draft's steps window on its step (Lines · Delivery · Payment · Warranty & conditions).
  const stepsWindow = (step: QuoteStep, what: string) =>
    edit ? (
      <PanelButton
        variant="ghost"
        size="xs"
        icon={<Pencil aria-hidden />}
        label={<span className="sr-only">Edit {what}</span>}
        title={`Edit · ${x.refNo} R${r.number}`}
        description="Draft"
        panelClassName="md:w-[1180px]"
        body={<QuoteStepsPanel number={r.number} initial={draftValues!} offers={offers!} loadOffers={loadOffers} showCosts={showCosts} action={updateRevisionAction.bind(null, dealId, r.id)} step={step} />}
      />
    ) : undefined;
  const canAnswer = r.status === "sent" && r.canAnswer && manage;
  const o = optionOf(r);
  return (
    <section aria-label={`${x.refNo} R${r.number}`} className="flex flex-col gap-4 border-t border-line bg-surface-2/30 px-5 pt-3 pb-5 max-md:px-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RevisionBadge status={r.status} />
        {x.revisions.length > 1 ? (
          <details className="relative">
            <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-bold [&::-webkit-details-marker]:hidden">
              R{r.number} <ChevronDown className="size-3.5" aria-hidden />
              <span className="sr-only">, revisions</span>
            </summary>
            <ul className="absolute top-8 left-0 z-10 flex w-56 flex-col rounded-xl border border-line-strong bg-surface p-1 shadow-lg">
              {x.revisions.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`${base}/quotation?q=${x.id}&rev=${v.id}#q-${x.id}`}
                    scroll={false}
                    aria-current={v.id === r.id ? "true" : undefined}
                    className={cn("flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-surface-2", v.id === r.id && "bg-surface-2 font-semibold")}
                  >
                    R{v.number}
                    <span className="text-xs text-text-2">{REVISION_STATUS_LABEL[v.status]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span className="text-[13px] font-bold">R{r.number}</span>
        )}
        <span className="text-[13px] text-text-2">{meta}</span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <a href={printHref(r)} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
            <Eye aria-hidden /> Print
          </a>
          <a href={pdfHref(r)} className={buttonClass("secondary", "sm")} aria-label={`Download ${x.refNo} R${r.number} as PDF`}>
            <Download aria-hidden /> PDF
          </a>
          {isDraft && manage && <DeleteDraftButton number={r.number} action={deleteRevisionAction.bind(null, dealId, r.id)} backHref={`${base}/quotation`} />}
          {r.status === "sent" && manage && send && (
            <PanelButton variant="ghost" size="sm" icon={<Send aria-hidden />} label="Send again" title={`Send ${x.refNo} R${r.number} again`} description="The same PDF, by email" panelClassName="md:w-[620px]" body={send} />
          )}
          {manage && x.canStartRevision && !isDraft && (
            <StartRevision
              action={reviseAction.bind(null, dealId, x.id)}
              draft={startValues}
              offers={offers}
              loadOffers={loadOffers}
              allowed={!!startValues}
              whyNot={x.whyNotStart}
              showCosts={showCosts}
              first={false}
              label="New revision"
              variant="secondary"
            />
          )}
          {isDraft && manage && send && (
            <PanelButton variant="primary" size="sm" icon={<Send aria-hidden />} label={`Send R${r.number}`} title={`Send ${x.refNo} R${r.number} to ${customer}`} description={`Valid until ${date(r.validUntil)}`} panelClassName="md:w-[620px]" body={send} />
          )}
          {canAnswer && (
            <AnswerButton
              number={r.number}
              refNo={x.refNo}
              customer={customer}
              options={r.options}
              currency={r.currency}
              today={today}
              answerAction={moveRevisionAction.bind(null, dealId, r.id)}
              noAction={saidNoAction.bind(null, dealId, r.id)}
              others={others}
              overdue={r.validUntil < today}
              route={r.paymentRoute ?? routeFromTerms(r.balanceTerms).route}
            />
          )}
        </span>
      </div>

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

      <section aria-label="Lines" className="flex flex-col gap-2">
        <h3 className="flex min-h-7 items-center gap-2 text-[15px] font-semibold">
          Lines
          {o && o.factory && <span className="text-xs font-normal text-text-2">{shortName(o.factory.name)}</span>}
          <span className="ml-auto">{stepsWindow("lines", "lines")}</span>
        </h3>
        <QuoteLines r={r} />
      </section>

      <section aria-label="Terms" className="flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold">Terms</h3>
        <QuoteTerms
          r={r}
          showChecks={showCosts}
          edit={edit ? (g) => stepsWindow(g, g === "warranty" ? "warranty and conditions" : g) : undefined}
        />
      </section>
    </section>
  );
}

/** What to look at before a draft goes to the customer: lines without a price, items an option leaves out. */
function draftChecks(r: RevisionView): string[] {
  const many = r.options.length > 1;
  return r.options.flatMap((o) => {
    const who = many ? `Option ${o.letter}` : "The quotation";
    const out: string[] = [];
    const unpriced = o.lines.filter((l) => !(Number(l.unitPrice) > 0)).length;
    if (unpriced) out.push(`${who}: ${unpriced} line${unpriced === 1 ? "" : "s"} without a price.`);
    if (o.factory && o.coverage.missing.length)
      out.push(`${who} does not include item${o.coverage.missing.length === 1 ? "" : "s"} ${o.coverage.missing.join(", ")}; the customer will see ${o.coverage.missing.length === 1 ? "it" : "them"} missing.`);
    // People who see costs: the costs to reach our basis (freight…) are part of the price, so a missing one makes the margin look better than it is.
    if (o.costing && o.factory) {
      if (o.factoryBasis === null) out.push(`${who}: the factory's price basis is not said, so the costs to reach ${r.incoterm} are not in its cost.`);
      else if (o.gap) {
        const have = new Set((o.costs ?? []).map((c) => c.step));
        const asLine = (step: BasisStep) => o.lines.some((l) => l.type === "charge" && l.description.toLowerCase().startsWith(BASIS_STEP_LABEL[step].toLowerCase().split(" ")[0]!));
        const missing = o.gap.needed.filter((s) => !have.has(s) && !asLine(s));
        if (missing.length)
          out.push(`${who}: ${missing.map((s) => BASIS_STEP_LABEL[s].toLowerCase()).join(" and ")} to reach ${r.incoterm} ${missing.length === 1 ? "is" : "are"} not entered, so its cost and margin are too low.`);
      }
    }
    if (o.costing && o.costing.marginPercent !== null && o.costing.marginPercent < 0) out.push(`${who} sells below cost.`);
    // What we promise against what the factory gives (people who see costs): lead time, payment, warranty.
    for (const c of checksOf({ ...r, options: [o] }, o)) if (!c.ok) out.push(`${who}: ${c.text}`);
    return out;
  });
}
