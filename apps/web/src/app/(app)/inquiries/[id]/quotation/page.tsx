import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { BASIS_STEP_LABEL, can, type BasisStep } from "@kebo/shared";
import { Alert, ButtonLink, Card, CardBody, CardHeader, cn, RevisionBadge, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { FileActions } from "@/components/common/file-actions";
import { load, requireUser } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { DealDetail } from "@/lib/types";
import type { QuotationView, QuoteOffers, RevisionDraft, RevisionView } from "@/lib/types-deals";
import { AnswerPanel, DraftPanel, StartRevision } from "@/components/deals/quotation-panels";
import { RevisionSummary } from "@/components/deals/revision-summary";
import { createRevisionAction, deleteRevisionAction, moveRevisionAction, offersAction, updateRevisionAction } from "./actions";

export const metadata = { title: "Quotation" };

const TZ = process.env.APP_TIME_ZONE ?? process.env.NEXT_PUBLIC_APP_TIME_ZONE ?? "Asia/Shanghai";

const printHref = (r: { id: string }) => `/print/revisions/${r.id}`;
const pdfHref = (r: { id: string }) => `/pdf/revisions/${r.id}`;

/**
 * The deal's quotation: the open draft (editable), the live revision waiting
 * for the customer's answer, and every revision sent so far.
 */
export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ r?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const [d, q] = await Promise.all([load(() => api.get<DealDetail>(`/inquiries/${id}`)), load(() => api.get<QuotationView>(`/inquiries/${id}/quotation`))]);
  const quoter = can(me, "quotations.manage");
  const manage = quoter && d.allowed.quote;
  const showCosts = can(me, "sourcing.manage");
  const today = todayIn(TZ);
  const draft = q.revisions.find((r) => r.status === "draft") ?? null;
  // The editor's values and what it can offer (each factory offer, costed in the quotation currency).
  const [startValues, draftValues] = await Promise.all([
    manage && q.canStartRevision ? api.get<RevisionDraft>(`/inquiries/${id}/quotation/draft`).catch(() => null) : null,
    manage && draft ? api.get<RevisionDraft>(`/revisions/${draft.id}/values`).catch(() => null) : null,
  ]);
  const currencyOf = draftValues?.currency ?? startValues?.currency;
  const offers = manage && currencyOf ? await api.get<QuoteOffers>(`/inquiries/${id}/quotation/offers`, { currency: currencyOf }).catch(() => null) : null;
  const loadOffers = offersAction.bind(null, d.id);
  const live = q.revisions.find((r) => r.status !== "draft") ?? null;
  const viewing = sp.r ? (q.revisions.find((r) => String(r.number) === sp.r && r.status !== "draft") ?? live) : live;
  const accepted = q.revisions.find((r) => r.status === "accepted");
  const order = d.orders.find((o) => o.status !== "cancelled");
  const move = (r: RevisionView) => moveRevisionAction.bind(null, d.id, r.id);
  // The customer said no (or let it lapse) and nothing new is being drafted: the next step is a new revision, offered right there.
  const startHere = manage && q.canStartRevision && !draft && !!live && viewing?.id === live.id && (live.status === "rejected" || live.status === "expired");
  // R1 starts from the offer the API picks: say which, so nobody has to guess.
  const firstOffer = q.revisions.length === 0 && startValues?.options[0]?.factoryQuoteId ? (offers?.offers.find((o) => o.factoryQuoteId === startValues.options[0]!.factoryQuoteId) ?? null) : null;

  // Shown to everyone who makes quotations; disabled with the API's reason when it cannot start now.
  const start = quoter && (
    <StartRevision
      action={createRevisionAction.bind(null, d.id)}
      draft={startValues}
      offers={offers}
      loadOffers={loadOffers}
      allowed={manage && q.canStartRevision && !!startValues}
      whyNot={q.whyNotStart ?? (!manage ? "Only the person handling this inquiry (or a manager) can quote." : null)}
      showCosts={showCosts}
      first={q.revisions.length === 0}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      {accepted && order && (
        <section
          aria-label="Order created"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/30 bg-ok-soft p-4"
        >
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden />
            <span>
              The customer accepted R{accepted.number}
              {accepted.answeredOn ? ` on ${date(accepted.answeredOn)}` : ""}. <span className="font-medium">Order {order.refNo}</span> was
              created ({money(order.total, order.currency)}) — the work continues there.
            </span>
          </p>
          <ButtonLink href={`/orders/${order.id}`} variant="primary" size="sm">
            Go to order {order.refNo}
          </ButtonLink>
        </section>
      )}

      {q.revisions.length === 0 && (
        <Card>
          <CardHeader
            title="No quotation yet"
            description="Each option you offer is one factory's offer from the Factory prices tab, with your prices. The customer accepts one option."
          />
          <CardBody className="flex flex-col gap-3">
            {firstOffer && manage && (
              <div className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface-2/50 px-3 py-2.5 text-sm">
                <span className="text-xs font-semibold tracking-wide text-muted uppercase">R1 will start with</span>
                <span>
                  <b>Option A · {firstOffer.factory.name}</b>:{" "}
                  {firstOffer.coverage.missing.length ? `covers all but ${firstOffer.coverage.missing.join(", ")}` : "covers everything the customer asked for"}
                  {showCosts && firstOffer.totalCost ? `, our cost ${money(firstOffer.totalCost, offers!.currency)}` : ""}, priced at your default {offers!.defaultMargin}% margin.
                </span>
                {offers!.offers.length > 1 && <span className="text-xs text-text-2">Add the other offers as Options B, C… inside the draft.</span>}
              </div>
            )}
            {quoter ? start : <p className="text-sm text-muted">{q.whyNotStart ?? "The person handling this inquiry makes the quotation."}</p>}
          </CardBody>
        </Card>
      )}

      {q.revisions.length > 0 && !manage && !(accepted && order) && (
        <Alert tone="info">
          {quoter && q.whyNotStart
            ? q.whyNotStart
            : "Only the person handling this inquiry (or a manager) can change the quotation or record the customer's answer."}
        </Alert>
      )}
      {draft && (
        <Card className="border-primary/30">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                {q.quotation?.refNo} R{draft.number} <RevisionBadge status="draft" />
              </span>
            }
            description="A draft: only you see it, and it can still change. Check it, then mark it as sent: from then on it is frozen."
            actions={
              !manage ? <FileActions viewHref={printHref(draft)} pdfHref={pdfHref(draft)} /> : undefined
            }
          />
          <CardBody className="flex flex-col gap-4">
            <DraftChecks r={draft} />
            {manage && draftValues && offers ? (
              <DraftPanel
                key={draft.id}
                number={draft.number}
                initial={draftValues}
                offers={offers}
                loadOffers={loadOffers}
                showCosts={showCosts}
                summary={<RevisionSummary r={draft} />}
                saveAction={updateRevisionAction.bind(null, d.id, draft.id)}
                deleteAction={deleteRevisionAction.bind(null, d.id, draft.id)}
                moveAction={move(draft)}
                printHref={printHref(draft)}
                pdfHref={pdfHref(draft)}
                today={today}
              />
            ) : (
              <RevisionSummary r={draft} />
            )}
          </CardBody>
        </Card>
      )}

      {viewing && (
        <Card>
          <CardHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {q.quotation?.refNo} R{viewing.number} <RevisionBadge status={viewing.status} />
                <span className="text-sm font-normal text-muted tabular">
                  {viewing.options.length > 1 && viewing.status !== "accepted" ? `${viewing.options.length} options` : money(viewing.total, viewing.currency)}
                </span>
              </span>
            }
            description={
              viewing.status === "sent"
                ? `Sent ${date(viewing.sentOn)} · valid until ${date(viewing.validUntil)}${viewing.validUntil < today ? " (validity has passed)" : ""}`
                : viewing.answeredOn
                  ? `Sent ${date(viewing.sentOn)} · answered ${date(viewing.answeredOn)}`
                  : viewing.sentOn
                    ? `Sent ${date(viewing.sentOn)}`
                    : undefined
            }
            actions={<FileActions viewHref={printHref(viewing)} pdfHref={pdfHref(viewing)} />}
          />
          <CardBody className="flex flex-col gap-5">
            {viewing.canAnswer && manage && (
              <div className="rounded-lg border border-primary/25 bg-primary-soft/40 p-3">
                <p className="mb-2 text-sm font-medium">What did the customer say about R{viewing.number}?</p>
                <AnswerPanel number={viewing.number} action={move(viewing)} today={today} options={viewing.options} currency={viewing.currency} />
                {draft && (
                  <p className="mt-2 text-xs text-muted">
                    Accepting R{viewing.number} discards the R{draft.number} draft.
                  </p>
                )}
              </div>
            )}
            {viewing.status === "sent" && viewing.validUntil < today && (
              <Alert tone="warning">
                <b>Its validity passed on {date(viewing.validUntil)}.</b> Ask the customer: if they still want it, start a new revision with new dates and
                prices; if not, mark it expired.
              </Alert>
            )}
            {startHere && (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2/60 p-3">
                <p className="text-sm">
                  {viewing.status === "rejected" ? (
                    <>
                      <b>The customer rejected R{viewing.number}</b>
                      {viewing.answeredOn ? ` on ${date(viewing.answeredOn)}` : ""}.
                    </>
                  ) : (
                    <>
                      <b>R{viewing.number} expired</b>
                      {viewing.answeredOn ? ` on ${date(viewing.answeredOn)}` : ""}.
                    </>
                  )}{" "}
                  Try again with a new revision (it starts as a copy of R{viewing.number}), or close the deal as lost on{" "}
                  <Link href={`/inquiries/${d.id}`} className="font-medium text-primary hover:underline">
                    Overview
                  </Link>
                  .
                </p>
                {start}
              </div>
            )}
            {viewing.status === "superseded" && (
              <Alert tone="info">
                R{viewing.number} was replaced by a newer revision; the customer&apos;s answer is recorded on the newest one.
              </Alert>
            )}
            <RevisionSummary r={viewing} />
          </CardBody>
        </Card>
      )}

      {q.revisions.length > 0 && (
        <Card>
          <CardHeader
            title="Revisions"
            description={q.quotation ? `${q.quotation.refNo} · the newest one is the one that counts` : undefined}
          />
          {quoter && !startHere && <div className="border-b border-line px-4 py-3">{start}</div>}
          <Table>
            <THead>
              <tr>
                <Th>Revision</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th className="hidden sm:table-cell">Valid until</Th>
                <Th className="hidden md:table-cell">Sent</Th>
                <Th className="hidden md:table-cell">Answered</Th>
                <Th className="relative">
                  <span className="sr-only">Print</span>
                </Th>
              </tr>
            </THead>
            <tbody>
              {q.revisions.map((r) => (
                <Tr key={r.id} className={cn(viewing?.id === r.id && "bg-surface-2/60")}>
                  <Td className="font-medium">
                    {r.status === "draft" ? (
                      `R${r.number}`
                    ) : (
                      <Link
                        href={`/inquiries/${d.id}/quotation?r=${r.number}`}
                        className="hover:text-primary"
                        aria-current={viewing?.id === r.id ? "true" : undefined}
                      >
                        R{r.number}
                      </Link>
                    )}
                  </Td>
                  <Td>
                    <RevisionBadge status={r.status} />
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">
                    {r.options.length > 1 && r.status !== "accepted" ? (
                      <span title={r.options.map((o) => `Option ${o.letter}: ${money(o.total, r.currency)}`).join("\n")}>
                        {r.options.map((o) => `${o.letter} ${money(o.total, r.currency)}`).join(" · ")}
                      </span>
                    ) : (
                      money(r.total, r.currency)
                    )}
                  </Td>
                  <Td className="hidden whitespace-nowrap sm:table-cell">{date(r.validUntil)}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">{date(r.sentOn)}</Td>
                  <Td className="hidden whitespace-nowrap md:table-cell">{date(r.answeredOn)}</Td>
                  <Td className="text-right whitespace-nowrap">
                    <Link href={printHref(r)} target="_blank" className="text-xs font-medium text-primary hover:underline">
                      Print
                    </Link>
                    <span className="text-muted"> · </span>
                    <a
                      href={pdfHref(r)}
                      className="text-xs font-medium text-primary hover:underline"
                      aria-label={`Download R${r.number} as PDF`}
                    >
                      PDF
                    </a>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

/** What to look at before a draft goes to the customer: lines without a price, items an option leaves out. */
function DraftChecks({ r }: { r: RevisionView }) {
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
  if (!checks.length)
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-sm">
        <CheckCircle2 className="size-4 shrink-0 text-ok" aria-hidden />
        <span>
          <b className="text-ok">Ready to send.</b> Check it with View / Print, then mark it as sent.
        </span>
      </p>
    );
  return (
    <div role="status" className="flex flex-col gap-1.5 rounded-lg border border-warn/30 bg-warn-soft/60 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-warn">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> Before you send R{r.number}
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-6">
        {checks.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
