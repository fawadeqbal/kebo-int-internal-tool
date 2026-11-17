import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Download, Eye, Send } from "lucide-react";
import { BASIS_STEP_LABEL, can, REVISION_STATUS_LABEL, routeFromTerms, SENT_VIA_TEXT, type BasisStep } from "@kebo/shared";
import { buttonClass, cn, PageHeader, RevisionBadge, StatusBadge } from "@kebo/ui";
import { PanelButton } from "@/components/orders/step-view";
import { MoreMenu, type MenuEntry } from "@/components/common/more-menu";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { companyToday, date, money } from "@/lib/format";
import { dealOf, quotationOf } from "@/lib/deal-data";
import type { QuotationOfDeal, QuoteOffers, RevisionDraft, RevisionView } from "@/lib/types-deals";
import { StartRevision } from "@/components/deals/quotation-panels";
import { QuoteEdit } from "@/components/deals/quotation-step";
import type { QuoteStep } from "@/components/deals/revision-editor";
import { AnswerButton } from "@/components/deals/quotation-tab";
import { checksOf, optionOf, QuoteLines, QuoteTerms } from "@/components/deals/quote-view";
import { SendWindow, type SendItem } from "@/components/deals/send-quote";
import { OwnPagerTop, OwnPagerUnder } from "@/components/deals/own-pager";
import { deleteDraftAction, emailRevisionAction, moveRevisionAction, offersAction, reviseAction, saidNoAction, updateRevisionAction } from "../../quotation/actions";
import { inquiryTitle } from "@/lib/titles";

export const generateMetadata = inquiryTitle("Quotation");

const printHref = (r: { id: string }) => `/print/revisions/${r.id}`;
const pdfHref = (r: { id: string }) => `/pdf/revisions/${r.id}`;

/** The revision a quotation shows first: its open draft, else its newest one. */
const currentOf = (q: QuotationOfDeal) => q.revisions.find((r) => r.status === "draft") ?? q.revisions[0]!;

/**
 * One quotation on its own page (design 17 Nov: each on its own page). Its top: the number and status, what can
 * be done (Edit, Print, PDF, Send, the customer's answer), and ‹ 2 of 5 › through the inquiry's quotations. Its
 * lines and its terms, each with Edit on a draft; beside them its revisions, the offer it came from and who it goes to.
 */
export default async function QuotationOwnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; qid: string }>;
  searchParams: Promise<{ rev?: string }>;
}) {
  const { id, qid } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const [d, q] = await Promise.all([dealOf(id), quotationOf(id)]);
  const at = q.quotations.findIndex((y) => y.id === qid);
  const x = q.quotations[at];
  if (!x) notFound();
  const quoter = can(me, "quotations.manage");
  const manage = quoter && d.allowed.quote;
  const showCosts = can(me, "sourcing.manage");
  const today = companyToday();
  const base = `/inquiries/${d.id}`;
  const here = `${base}/quotations/${x.id}`;
  const draft = x.revisions.find((r) => r.status === "draft") ?? null;
  const r = x.revisions.find((v) => v.id === sp.rev) ?? currentOf(x);
  const isDraft = r.status === "draft";

  // What the windows need: the draft's values (its Edit buttons), the next revision's starting values (New
  // revision), and the offers costed in the quotation's currency (also for "From the offer").
  const [draftValues, startValues] = await Promise.all([
    manage && draft ? api.get<RevisionDraft>(`/revisions/${draft.id}/values`).catch(() => null) : null,
    manage && x.canStartRevision ? api.get<RevisionDraft>(`/quotations/${x.id}/draft`).catch(() => null) : null,
  ]);
  const loadOffers = offersAction.bind(null, d.id);
  const offers: QuoteOffers | null = manage || showCosts ? await loadOffers(draftValues?.currency ?? startValues?.currency ?? r.currency) : null;
  const edit = isDraft && manage && !!draftValues && !!offers;

  // Send: the inquiry's drafts that are ready (every option priced) can go together.
  const who = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0];
  const copy = d.customer.contacts.filter((c) => c.email && c.id !== who?.id).map((c) => c.email);
  const dear = `Dear ${who?.name.split(" ")[0] ?? "Sir or Madam"},`;
  const ready: SendItem[] = q.quotations.flatMap((y) => {
    const c = currentOf(y);
    return c.status === "draft" && c.options.length > 0 && c.options.every((o) => Number(o.total) > 0)
      ? [{ id: c.id, refNo: y.refNo, letter: y.letter, number: c.number, total: money(c.total, c.currency), printHref: printHref(c), pdfHref: pdfHref(c) }]
      : [];
  });
  const quoteRef = `${x.refNo} R${r.number}`;
  const send =
    manage && (isDraft || r.status === "sent") ? (
      <SendWindow
        revisionId={r.id}
        together={isDraft ? ready : []}
        subjectMany={`Quotations {names} — ${d.title}`}
        messageMany={`${dear} please find our quotations for ${d.title}.`}
        number={r.number}
        customer={d.customer.name}
        emailAction={emailRevisionAction.bind(null, d.id, r.id, `${quoteRef}.pdf`)}
        markAction={isDraft ? moveRevisionAction.bind(null, d.id, r.id) : null}
        to={who?.email ?? ""}
        cc={copy.slice(0, 2).join(", ")}
        subject={`Quotation ${quoteRef} — ${d.title}`}
        message={`${dear} please find our ${r.number > 1 ? "revised " : ""}quotation for ${d.title}.`}
        fileName={`${quoteRef}.pdf`}
        printHref={printHref(r)}
        pdfHref={pdfHref(r)}
        today={today}
      />
    ) : null;

  // Edit, with its word (never a pencil alone): on a part it opens only that part (design 17 Nov); at the top, the steps.
  const editor = edit ? { quoteRef, number: r.number, initial: draftValues!, offers: offers!, loadOffers, showCosts, action: updateRevisionAction.bind(null, d.id, r.id) } : null;
  const editButton = (step: QuoteStep, what: string, words?: string) =>
    editor ? (
      <QuoteEdit
        {...editor}
        step={step}
        only
        className="tracking-normal normal-case"
        label={words ?? (
          <>
            Edit<span className="sr-only"> {what}</span>
          </>
        )}
      />
    ) : undefined;

  const canAnswer = r.status === "sent" && r.canAnswer && manage;
  const waiting = q.quotations.filter((y) => y.id !== x.id && y.revisions.some((v) => v.status === "sent" && v.canAnswer)).map((y) => y.refNo);
  const o = optionOf(r);
  const sentBefore = x.revisions.find((v) => v.status !== "draft" && v.number < r.number);
  const meta = isDraft
    ? [sentBefore?.sentOn ? `R${sentBefore.number} sent ${date(sentBefore.sentOn)}` : null, `valid until ${date(r.validUntil)}`]
    : [r.sentOn ? `sent ${date(r.sentOn)}${r.sentVia ? ` ${SENT_VIA_TEXT[r.sentVia]}` : ""}` : null, `valid until ${date(r.validUntil)}${r.status === "sent" && r.validUntil < today ? ", which has passed" : ""}`];
  const checks = isDraft ? draftChecks(r) : [];
  const badge = isDraft && sentBefore ? <StatusBadge meaning="neutral">Draft R{r.number}</StatusBadge> : <RevisionBadge status={r.status} />;
  const prev = at > 0 ? q.quotations[at - 1] : null;
  const next = at < q.quotations.length - 1 ? q.quotations[at + 1] : null;

  const moreItems: MenuEntry[] = [
    ...(isDraft && manage
      ? [
          {
            label: "Delete draft",
            danger: true as const,
            confirm: {
              title: `Delete draft R${r.number}?`,
              body: `Draft R${r.number} and the prices set in it are removed. The factory offers stay as they are.${r.number > 1 ? ` R${r.number - 1} stays as it is.` : ""}`,
              confirmLabel: "Delete the draft",
            },
            action: deleteDraftAction.bind(null, d.id, x.id, r.id),
          },
        ]
      : []),
    { label: "Copy link to this quotation", copy: here },
  ];

  return (
    <div className="relative">
      <OwnPagerTop
        label={`Quotations of ${d.refNo}`}
        what="quotation"
        at={at}
        of={q.quotations.length}
        prev={prev ? { href: `${base}/quotations/${prev.id}`, name: prev.refNo } : null}
        next={next ? { href: `${base}/quotations/${next.id}`, name: next.refNo } : null}
      />
      <PageHeader
        phoneStack
        crumbs={[{ label: "Sales" }, { label: "Inquiries", href: "/inquiries" }, { label: d.refNo, href: base }, { label: x.refNo }]}
        back={{ href: `${base}/quotation`, label: `${d.refNo} · Quotations` }}
        title={<span className="tabular">{x.refNo}</span>}
        badge={badge}
        summary={
          <p className="min-w-0">
            {[
              // (Who it goes to and the offer it is from: beside, under Goes to and From the offer.)
              `R${r.number}`,
              ...meta.filter(Boolean),
            ]
              .filter(Boolean)
              .map((m, i) => (
                <span key={i}>
                  {i > 0 && (
                    <span aria-hidden className="px-1.5 text-muted">
                      ·
                    </span>
                  )}
                  {m}
                </span>
              ))}
          </p>
        }
        actions={
          <>
            {editor && <QuoteEdit {...editor} step="lines" size="sm" label="Edit" />}
            {r.status === "sent" && send && (
              <PanelButton variant="secondary" size="sm" icon={<Send aria-hidden />} label="Send again" title={`Send ${quoteRef} again`} description="The same PDF, by email" panelClassName="md:w-[620px]" body={send} />
            )}
            {manage && x.canStartRevision && !isDraft && (
              <StartRevision
                action={reviseAction.bind(null, d.id, x.id)}
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
          </>
        }
        papers={
          <>
            <a href={printHref(r)} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
              <Eye aria-hidden /> Print
            </a>
            <a href={pdfHref(r)} className={buttonClass("secondary", "sm")} aria-label={`Download ${quoteRef} as PDF`}>
              <Download aria-hidden /> PDF
            </a>
          </>
        }
        primary={
          isDraft && send ? (
            <PanelButton variant="primary" size="sm" icon={<Send aria-hidden />} label={`Send R${r.number}`} title={`Send ${quoteRef} to ${d.customer.name}`} description={`Valid until ${date(r.validUntil)}`} panelClassName="md:w-[620px]" body={send} />
          ) : canAnswer ? (
            <AnswerButton
              number={r.number}
              refNo={x.refNo}
              customer={d.customer.name}
              options={r.options}
              currency={r.currency}
              today={today}
              answerAction={moveRevisionAction.bind(null, d.id, r.id)}
              noAction={saidNoAction.bind(null, d.id, r.id)}
              others={waiting}
              overdue={r.validUntil < today}
              route={r.paymentRoute ?? routeFromTerms(r.balanceTerms).route}
            />
          ) : undefined
        }
        more={
          <MoreMenu
            label={`More for ${quoteRef}`}
            items={moreItems}
            phoneItems={[
              { label: "Print", href: printHref(r), newTab: true },
              { label: "Download PDF", href: pdfHref(r), download: true },
            ]}
          />
        }
      >
        <OwnPagerUnder
          label={`Quotations of ${d.refNo}`}
          what="quotation"
          at={at}
          of={q.quotations.length}
          prev={prev ? { href: `${base}/quotations/${prev.id}`, name: prev.refNo } : null}
          next={next ? { href: `${base}/quotations/${next.id}`, name: next.refNo } : null}
        />
      </PageHeader>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-4">
          {checks.length > 0 && (
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
          <section aria-labelledby="q-lines" className="flex flex-col gap-2">
            <div className="flex min-h-8 items-center gap-2">
              <h2 id="q-lines" className="text-[15px] font-semibold">
                Lines
              </h2>
              <span className="text-xs text-text-2">
                {r.options.length > 1 ? `${r.options.length} options` : `${o?.lines.length ?? 0} line${o?.lines.length === 1 ? "" : "s"}`}
              </span>
              <span className="ml-auto">{editButton("lines", "lines", "Edit lines")}</span>
            </div>
            <QuoteLines r={r} />
          </section>
          <section aria-labelledby="q-terms" className="flex flex-col gap-2">
            <h2 id="q-terms" className="text-[15px] font-semibold">
              Terms
            </h2>
            <QuoteTerms r={r} showChecks={showCosts} edit={edit ? (g) => editButton(g, g === "warranty" ? "warranty and conditions" : g) : undefined} />
          </section>
        </div>
        <QuoteSide x={x} r={r} here={here} base={base} offers={showCosts ? offers : null} customer={d.customer} who={who ?? null} />
      </div>
    </div>
  );
}

/** Beside the quotation: its revisions, the offer it came from and who it goes to. */
function QuoteSide({
  x,
  r,
  here,
  base,
  offers,
  customer,
  who,
}: {
  x: QuotationOfDeal;
  r: RevisionView;
  here: string;
  base: string;
  offers: QuoteOffers | null;
  customer: { id: string; name: string };
  who: { name: string; email: string | null } | null;
}) {
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-3 text-[13px]">
      <dt className="text-text-2">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words text-text">{value}</dd>
    </div>
  );
  return (
    <aside aria-label="About this quotation" className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <section aria-labelledby="q-revisions" className="flex flex-col gap-1 border-b border-line px-4 py-3">
        <h2 id="q-revisions" className="mb-1 text-[15px] font-semibold">
          Revisions
        </h2>
        {x.revisions.map((v) => (
          <Link
            key={v.id}
            href={`${here}?rev=${v.id}`}
            aria-current={v.id === r.id ? "page" : undefined}
            className={cn("-mx-2 flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-[13px] hover:bg-surface-2", v.id === r.id && "bg-surface-2")}
          >
            <span className="font-semibold">R{v.number}</span>
            <span className="text-right text-xs text-text-2">
              {REVISION_STATUS_LABEL[v.status]}
              {v.sentOn ? ` · ${date(v.sentOn)}` : v.status === "draft" ? ` · made ${date(v.createdAt.slice(0, 10))}` : ""}
            </span>
          </Link>
        ))}
      </section>
      <section aria-labelledby="q-from" className="flex flex-col gap-1.5 border-b border-line px-4 py-3">
        <h2 id="q-from" className="mb-1 text-[15px] font-semibold">
          {r.options.length > 1 ? "From the offers" : "From the offer"}
        </h2>
        <dl className="flex flex-col gap-1.5">
          {r.options.map((o) => {
            const offer = o.factoryQuoteId ? offers?.offers.find((f) => f.factoryQuoteId === o.factoryQuoteId) : null;
            const prefix = r.options.length > 1 ? `Option ${o.letter}: ` : "";
            if (!o.factoryQuoteId) return <Fragment key={o.id}>{row(`${prefix}Prices`, "Own prices")}</Fragment>;
            return (
              <Fragment key={o.id}>
                {row(`${prefix}Factory`, o.factory?.name ?? "—")}
                {offer && row("Received", date(offer.receivedOn))}
                {offer?.leadTime && row("Lead time", offer.leadTime)}
              </Fragment>
            );
          })}
        </dl>
        {r.options
          .filter((o) => o.factoryQuoteId && offers)
          .map((o) => (
            <Link key={o.id} href={`${base}/offers/${o.factoryQuoteId}`} className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-primary underline underline-offset-2">
              Open {r.options.length > 1 ? `Option ${o.letter}’s offer` : "the offer"} <ChevronRight className="size-3.5" aria-hidden />
            </Link>
          ))}
      </section>
      <section aria-labelledby="q-to" className="flex flex-col gap-1.5 px-4 py-3">
        <h2 id="q-to" className="mb-1 text-[15px] font-semibold">
          Goes to
        </h2>
        <dl className="flex flex-col gap-1.5">
          {row(
            "Customer",
            <Link href={`/customers/${customer.id}`} className="text-primary underline underline-offset-2">
              {customer.name}
            </Link>,
          )}
          {who && row("Contact", who.name)}
          {who?.email && row("Email", who.email)}
        </dl>
      </section>
    </aside>
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
