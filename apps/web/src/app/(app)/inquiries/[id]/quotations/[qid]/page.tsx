import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { ArrowRight, ChevronRight, Download, Eye, Lock, Send } from "lucide-react";
import { BASIS_STEP_LABEL, can, PAPER, RECORD_KIND, RECORD_TITLE, REVISION_STATUS_LABEL, routeFromTerms, SENT_VIA_TEXT, unpricedItems, type BasisStep, type TermsCheck } from "@kebo/shared";
import { ButtonLink, cn, RULES, Notice } from "@kebo/ui";
import { PanelButton } from "@/components/orders/step-view";
import { BoxFacts, RecordBox } from "@/components/common/record-box";
import { recordActions } from "@/components/records/actions";
import { ItemsBox } from "@/components/records/items-box";
import { PaperFacts, PaperLayout } from "@/components/records/paper-boxes";
import { RecordPage, type PanelSection } from "@/components/records/record-page";
import { LinesExcel } from "@/components/deals/lines-view";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { companyToday, date, money } from "@/lib/format";
import { dealOf, quotationOf } from "@/lib/deal-data";
import type { QuotationOfDeal, QuoteOffers, RevisionDraft, RevisionView } from "@/lib/types-deals";
import { QuoteEdit, type QuoteBox } from "@/components/deals/quotation-step";
import { AnswerButton } from "@/components/deals/quotation-tab";
import { CheckChip, checksOf, optionOf, optionTitle, PaymentParts, quoteCount, quotePrices } from "@/components/deals/quote-view";
import { UrlWindow } from "@/components/common/panel";
import { EditAllWindow, NewRevisionWindow } from "@/components/deals/quote-windows";
import { SendWindow, type SendItem } from "@/components/deals/send-quote";
import type { MailSenders } from "@kebo/shared";
import { deleteDraftAction, emailRevisionAction, moveRevisionAction, offerPricesAction, offersAction, reviseAction, saidNoAction, updateRevisionAction } from "../../quotation/actions";
import { ActionForm } from "@/components/common/action-form";
import { SubmitButton } from "@kebo/ui/client";
import { inquiryTitle } from "@/lib/titles";

export const generateMetadata = inquiryTitle("Quotation");

const TONE = { action: "text-action", ok: "text-ok", bad: "text-bad", mute: "text-text-2" } as const;
const printHref = (r: { id: string }) => `/print/revisions/${r.id}`;
const pdfHref = (r: { id: string }) => `/pdf/revisions/${r.id}`;

/** The revision a quotation shows first: its open draft, else its newest one. */
const currentOf = (q: QuotationOfDeal) => q.revisions.find((r) => r.status === "draft") ?? q.revisions[0]!;

/**
 * One quotation on its own page, from the record pieces (canvas board "The quotation, from the pieces"): its top —
 * the number and its R, where it stands in words, one strong button for its state (Send R1, Customer answered),
 * Print and PDF beside ⋯ and the rest in ⋯ — ‹ 2 of 5 › through the inquiry's quotations, the notice before it is
 * sent, then the boxes every paper has: Customer | Delivery & payment, Prices (the one items box, with its totals)
 * and Warranty & conditions, each with its Edit on a draft (locked once sent). Beside them, the one panel: its
 * revisions and the offer it came from.
 */
export default async function QuotationOwnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; qid: string }>;
  searchParams: Promise<{ rev?: string; panel?: string }>;
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
  const [draftValues, startValues, senders] = await Promise.all([
    manage && draft ? api.get<RevisionDraft>(`/revisions/${draft.id}/values`).catch(() => null) : null,
    manage && x.canStartRevision ? api.get<RevisionDraft>(`/quotations/${x.id}/draft`).catch(() => null) : null,
    // Which connected address the email goes from (Admin settings › Email accounts).
    manage && (isDraft || r.status === "sent") ? api.get<MailSenders>("/mail-settings/senders?use=customers").catch(() => null) : null,
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
        senders={senders}
      />
    ) : null;

  // Edit, with its word (never a pencil alone): on a part it opens only that part (design 17 Nov); at the top, the steps.
  const editor = edit ? { quoteRef, number: r.number, initial: draftValues!, offers: offers!, loadOffers, showCosts, action: updateRevisionAction.bind(null, d.id, r.id) } : null;
  const canAnswer = r.status === "sent" && r.canAnswer && manage;
  const waiting = q.quotations.filter((y) => y.id !== x.id && y.revisions.some((v) => v.status === "sent" && v.canAnswer)).map((y) => y.refNo);
  const o = optionOf(r);
  const sentBefore = x.revisions.find((v) => v.status !== "draft" && v.number < r.number);
  const passed = r.status === "sent" && r.validUntil < today;
  // Where it stands, in words (the line under the title): the badge of old, said as the inquiry says its stage.
  const state: { text: string; tone: keyof typeof TONE } = isDraft
    ? { text: ["Draft", sentBefore?.sentOn ? `R${sentBefore.number} sent ${date(sentBefore.sentOn)}` : null].filter(Boolean).join(" · "), tone: "mute" }
    : r.status === "sent"
      ? {
          text: `${r.sentOn ? `Sent ${date(r.sentOn)}${r.sentVia ? ` ${SENT_VIA_TEXT[r.sentVia]}` : ""}` : "Sent"} · ${passed ? "its validity has passed" : "waiting for their answer"}`,
          tone: passed ? "bad" : "action",
        }
      : { text: REVISION_STATUS_LABEL[r.status], tone: r.status === "accepted" ? "ok" : r.status === "rejected" ? "bad" : "mute" };
  const checks = isDraft ? draftChecks(r) : [];
  // The supplier's offer changed after this was quoted (people who see costs; not once the customer answered).
  const changed = isDraft || r.status === "sent" ? r.options.flatMap((opt) => (opt.factory && opt.offerChanged?.length ? [{ opt, lines: opt.offerChanged }] : [])) : [];
  // A quotation from one offer says when the supplier's prices end, beside its own Valid until.
  const endOf = r.options.length === 1 ? r.options[0] : null;
  const ends = endOf?.factory && endOf.factoryValidUntil ? { who: endOf.factory.name, on: endOf.factoryValidUntil } : null;
  const prev = at > 0 ? q.quotations[at - 1] : null;
  const next = at < q.quotations.length - 1 ? q.quotations[at + 1] : null;

  const acceptedOrder = d.orders.find((o) => o.status !== "cancelled");
  // The quotation's list of actions (canvas board "Actions: one list per record type"): one strong button for its
  // state, Print and PDF beside ⋯ (in ⋯ on a phone), the rest in ⋯ with Delete draft last.
  const actions = recordActions(`More for ${quoteRef}`, [
    {
      id: "send",
      place: "primary",
      when: isDraft && !!send,
      node: (
        <PanelButton variant="primary" icon={<Send aria-hidden />} label={`Send R${r.number}`} title={`Send ${quoteRef} to ${d.customer.name}`} description={`Valid until ${date(r.validUntil)}`} panelClassName={RULES.window.part} body={send} />
      ),
    },
    {
      id: "answer",
      place: "primary",
      when: canAnswer,
      node: (
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
      ),
    },
    {
      // Accepted: the order it made is the next place to go, as the inquiry's "Go to the order".
      id: "order",
      place: "primary",
      when: r.status === "accepted" && !!acceptedOrder,
      node: acceptedOrder && (
        <ButtonLink href={`/orders/${acceptedOrder.id}`} variant="primary">
          Go to the order <ArrowRight aria-hidden />
        </ButtonLink>
      ),
    },
    { id: "print", place: "paper", label: "Print", icon: <Eye aria-hidden />, href: printHref(r) },
    { id: "pdf", place: "paper", label: "PDF", phoneLabel: "Download PDF", ariaLabel: `Download ${quoteRef} as PDF`, icon: <Download aria-hidden />, href: pdfHref(r), download: true },
    { id: "edit", place: "more", when: !!editor, label: "Edit all", panel: "edit-quote" },
    { id: "send-again", place: "more", when: r.status === "sent" && !!send, label: "Send again", panel: "send-again" },
    { id: "revise", place: "more", when: manage && x.canStartRevision && !isDraft, label: "New revision", panel: "new-revision" },
    { id: "link", place: "more", label: "Copy link to this quotation", copy: here },
    {
      id: "delete",
      place: "more",
      when: isDraft && manage,
      danger: true,
      label: "Delete draft",
      confirm: {
        title: `Delete draft R${r.number}?`,
        body: `Draft R${r.number} and the prices set in it are removed. The supplier offers stay as they are.${r.number > 1 ? ` R${r.number - 1} stays as it is.` : ""}`,
        confirmLabel: "Delete the draft",
      },
      action: deleteDraftAction.bind(null, d.id, x.id, r.id),
    },
  ]);

  // Each box's Edit on a draft (that part only); once sent, a lock: a change needs a new revision.
  const boxEdit = (box: QuoteBox, what: string) =>
    editor ? (
      <QuoteEdit
        {...editor}
        step={box}
        only
        variant="ghost"
        className="text-primary hover:text-primary"
        label={
          <>
            Edit<span className="sr-only"> {what}</span>
          </>
        }
      />
    ) : !isDraft && manage ? (
      <span className="inline-flex items-center gap-1 px-2 text-xs font-medium text-text-2" title="Sent: a change needs a new revision">
        <Lock className="size-3.5" aria-hidden /> Locked
      </span>
    ) : null;
  const editable = !!editor || (!isDraft && manage);

  const terms = PAPER.ofRevision({ ...r, leadTime: o?.leadTime ?? r.leadTime });
  const total = Number(o?.total ?? r.total);
  const allChecks = showCosts ? checksOf(r, o) : [];
  const chip = (key: TermsCheck["key"]) => {
    const c = allChecks.find((k) => k.key === key);
    return c ? <CheckChip check={c} /> : undefined;
  };

  return (
    <RecordPage
      pager={{
        label: `Quotations of ${d.refNo}`,
        what: "quotation",
        at,
        of: q.quotations.length,
        prev: prev ? { href: `${base}/quotations/${prev.id}`, name: prev.refNo } : null,
        next: next ? { href: `${base}/quotations/${next.id}`, name: next.refNo } : null,
      }}
      header={{
        crumbs: [{ label: "Sales" }, { label: "Inquiries", href: "/inquiries" }, { label: d.refNo, href: base }, { label: x.refNo }],
        back: { href: `${base}/quotation`, label: `${d.refNo} · Quotations` },
        title: RECORD_TITLE.quotation({ customer: d.customer.name, option: q.quotations.length > 1 ? x.letter : null }),
        record: { kind: RECORD_KIND.quotation, number: x.refNo },
        badge: <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-md font-semibold text-text-2 tabular">R{r.number}</span>,
        summary: (
          <p className="min-w-0">
            <span className={cn("font-semibold", TONE[state.tone])}>{state.text}</span>
            <span aria-hidden className="px-1.5 text-muted">
              ·
            </span>
            <Link href={`/customers/${d.customer.id}`} className="text-primary underline underline-offset-2 hover:opacity-80">
              {d.customer.name}
            </Link>
          </p>
        ),
        ...actions,
      }}
      panel={{
        label: "About this quotation",
        summary: [`R${r.number} ${REVISION_STATUS_LABEL[r.status].toLowerCase()}`, o?.factory ? `from ${o.factory.name}` : o ? "own prices" : null].filter(Boolean).join(" · "),
        sections: quoteSide({ x, r, here, base, offers: showCosts ? offers : null }),
      }}
    >
      {changed.map(({ opt, lines }) => (
        <Notice
          key={opt.id}
          tone="todo"
          title={`${opt.factory!.name} changed its offer after this quotation was made`}
          action={
            isDraft && manage ? (
              <span className="flex flex-wrap gap-2">
                <ActionForm action={offerPricesAction.bind(null, d.id, r.id, "keep")}>
                  <SubmitButton variant="secondary" size="sm" pendingText="Saving…">
                    Keep these prices
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={offerPricesAction.bind(null, d.id, r.id, "update")}>
                  <SubmitButton variant="secondary" size="sm" pendingText="Updating…">
                    Update prices
                  </SubmitButton>
                </ActionForm>
              </span>
            ) : x.canStartRevision && manage ? (
              <Link href={`${here}?panel=new-revision`} scroll={false} className="text-sm font-semibold text-primary underline underline-offset-2">
                New revision
              </Link>
            ) : null
          }
        >
          {lines
            .map((l) => `${l.no} ${l.description}: ${money(l.was, opt.factoryCurrency ?? "")} → ${l.now === null ? "gone from the offer" : money(l.now, opt.factoryCurrency ?? "")}`)
            .join(" · ")}
          {isDraft ? ". Update prices keeps each item's margin on the new cost; Keep these prices keeps the customer's prices." : ". A sent quotation stays as it is: a new revision takes the new prices."}
        </Notice>
      ))}
      {checks.length > 0 && (
        <Notice tone="todo" title={`Before you send R${r.number}`}>
          <ul className={cn(checks.length > 1 && "list-disc pl-4")}>
            {checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Notice>
      )}
      <PaperLayout
        party={
          <RecordBox title="Customer" what="who it goes to" canEdit={false}>
            <BoxFacts
              rows={[
                [
                  "Customer",
                  <Link key="c" href={`/customers/${d.customer.id}`} className="text-primary underline underline-offset-2">
                    {d.customer.name}
                  </Link>,
                ],
                ["Contact", who?.name ?? null],
                ["Email", who?.email ?? null],
                [
                  "Valid until",
                  <>
                    {date(r.validUntil)}
                    {passed ? ", which has passed" : ""}
                    {ends && (
                      <span className="mt-1 block w-fit max-w-full rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold text-text-2">
                        {ends.who}&rsquo;s prices end {date(ends.on)}
                      </span>
                    )}
                  </>,
                ],
                ["Sent on", r.sentOn ? `${date(r.sentOn)}${r.sentVia ? ` ${SENT_VIA_TEXT[r.sentVia]}` : ""}` : null],
              ]}
            />
          </RecordBox>
        }
        terms={
          <RecordBox title="Delivery & payment" what="delivery and payment" canEdit={editable} edit={boxEdit("terms", "delivery and payment")}>
            <PaperFacts terms={terms} kind="quotation" box="terms" values={{ payment: <PaymentParts r={r} total={total} /> }} after={{ leadTime: chip("lead"), payment: chip("payment") }} />
          </RecordBox>
        }
        prices={
          <>
            {r.options.map((opt) => {
              const p = quotePrices(opt, r.currency, { edit: !!editor, locked: !isDraft && manage });
              const many = r.options.length > 1;
              return (
                <ItemsBox
                  key={opt.id}
                  title={many ? `Prices · ${optionTitle(opt)}` : "Prices"}
                  count={[opt.lines.length ? quoteCount(opt) : null, r.currency].filter(Boolean).join(" · ")}
                  what="prices"
                  canEdit={editable}
                  edit={boxEdit("lines", many ? `prices of option ${opt.letter}` : "prices")}
                  tools={<LinesExcel name={`${quoteRef}${many ? ` option ${opt.letter}` : ""} prices`} rows={p.rows.map(({ badge: _b, ...row }) => row)} columns={p.plain} numbers={p.numbers} noun="items" />}
                  label={many ? `${optionTitle(opt)} · prices` : `${quoteRef} · prices`}
                  rows={p.rows}
                  columns={p.columns}
                  numbers={p.numbers}
                  totals={p.totals}
                  phone={p.phone}
                  empty="No items yet."
                />
              );
            })}
          </>
        }
        conditions={
          <RecordBox title="Warranty & conditions" what="the warranty and conditions" canEdit={editable} edit={boxEdit("warranty", "warranty and conditions")}>
            <PaperFacts terms={terms} kind="quotation" box="conditions" after={{ warranty: chip("warranty") }} />
          </RecordBox>
        }
      />
      {/* The windows ⋯ opens (kept in the address: Back closes them). */}
      {editor && sp.panel === "edit-quote" && <EditAllWindow {...editor} />}
      {send && r.status === "sent" && sp.panel === "send-again" && (
        <UrlWindow name="send-again" title={`Send ${quoteRef} again`} description="The same PDF, by email" className={RULES.window.part}>
          {send}
        </UrlWindow>
      )}
      {manage && x.canStartRevision && !isDraft && sp.panel === "new-revision" && (
        <NewRevisionWindow draft={startValues} offers={offers} loadOffers={loadOffers} showCosts={showCosts} action={reviseAction.bind(null, d.id, x.id)} whyNot={x.whyNotStart} />
      )}
    </RecordPage>
  );
}

/** The panel beside the quotation: its revisions, and the offer it came from (who it goes to is in Customer). */
function quoteSide({ x, r, here, base, offers }: { x: QuotationOfDeal; r: RevisionView; here: string; base: string; offers: QuoteOffers | null }): PanelSection[] {
  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-3 text-md">
      <dt className="text-text-2">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words text-text">{value}</dd>
    </div>
  );
  return [
    {
      id: "q-revisions",
      title: "Revisions",
      children: x.revisions.map((v) => (
        <Link
          key={v.id}
          href={`${here}?rev=${v.id}`}
          aria-current={v.id === r.id ? "page" : undefined}
          className={cn("-mx-2 flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-md hover:bg-surface-2", v.id === r.id && "bg-surface-2")}
        >
          <span className="font-semibold">R{v.number}</span>
          <span className="text-right text-xs text-text-2">
            {REVISION_STATUS_LABEL[v.status]}
            {v.sentOn ? ` · ${date(v.sentOn)}` : v.status === "draft" ? ` · made ${date(v.createdAt.slice(0, 10))}` : ""}
          </span>
        </Link>
      )),
    },
    {
      id: "q-from",
      title: r.options.length > 1 ? "From the offers" : "From the offer",
      children: (
        <>
          <dl className="flex flex-col gap-1.5">
            {r.options.map((o) => {
              const offer = o.factoryQuoteId ? offers?.offers.find((f) => f.factoryQuoteId === o.factoryQuoteId) : null;
              const prefix = r.options.length > 1 ? `Option ${o.letter}: ` : "";
              if (!o.factoryQuoteId) return <Fragment key={o.id}>{row(`${prefix}Prices`, "Own prices")}</Fragment>;
              return (
                <Fragment key={o.id}>
                  {row(`${prefix}Supplier`, o.factory?.name ?? "—")}
                  {offer && row("Received", date(offer.receivedOn))}
                  {offer?.leadTime && row("Lead time", offer.leadTime)}
                </Fragment>
              );
            })}
          </dl>
          {r.options
            .filter((o) => o.factoryQuoteId && offers)
            .map((o) => (
              <Link key={o.id} href={`${base}/offers/${o.factoryQuoteId}`} className="mt-1 inline-flex items-center gap-1 text-md font-semibold text-primary underline underline-offset-2">
                Open {r.options.length > 1 ? `Option ${o.letter}’s offer` : "the offer"} <ChevronRight className="size-3.5" aria-hidden />
              </Link>
            ))}
        </>
      ),
    },
  ];
}

/** What to look at before a draft goes to the customer: lines without a price, items an option leaves out. */
function draftChecks(r: RevisionView): string[] {
  const many = r.options.length > 1;
  return r.options.flatMap((o) => {
    const who = many ? `Option ${o.letter}` : "The quotation";
    const out: string[] = [];
    // A part is priced in its item; an item priced in its parts is priced (the one rule, unpricedItems).
    const unpriced = unpricedItems(o.lines.map((l) => ({ id: l.no, parentId: l.no.includes(".") ? l.no.slice(0, l.no.lastIndexOf(".")) : null, price: l.unitPrice })));
    if (unpriced) out.push(`${who}: ${unpriced} item${unpriced === 1 ? "" : "s"} without a price.`);
    if (o.factory && o.coverage.missing.length)
      out.push(`${who} does not include item${o.coverage.missing.length === 1 ? "" : "s"} ${o.coverage.missing.join(", ")}; the customer will see ${o.coverage.missing.length === 1 ? "it" : "them"} missing.`);
    // People who see costs: the costs to reach our basis (freight…) are part of the price, so a missing one makes the margin look better than it is.
    if (o.costing && o.factory) {
      if (o.factoryBasis === null) out.push(`${who}: the supplier's Incoterm is not said, so the costs to reach ${r.incoterm} are not in its cost.`);
      else if (o.gap) {
        const have = new Set((o.costs ?? []).map((c) => c.step));
        const asLine = (step: BasisStep) => o.lines.some((l) => l.type === "charge" && l.description.toLowerCase().startsWith(BASIS_STEP_LABEL[step].toLowerCase().split(" ")[0]!));
        const missing = o.gap.needed.filter((s) => !have.has(s) && !asLine(s));
        if (missing.length)
          out.push(`${who}: ${missing.map((s) => BASIS_STEP_LABEL[s].toLowerCase()).join(" and ")} to reach ${r.incoterm} ${missing.length === 1 ? "is" : "are"} not entered, so its cost and margin are too low.`);
      }
    }
    if (o.costing && o.costing.marginPercent !== null && o.costing.marginPercent < 0) out.push(`${who} sells below cost.`);
    // Never valid longer than the supplier's prices (canvas "From the supplier offer to the quotation").
    if (o.factory && o.factoryValidUntil && r.validUntil > o.factoryValidUntil)
      out.push(`${who} is valid until ${date(r.validUntil)}, after ${o.factory.name}'s prices end (${date(o.factoryValidUntil)}).`);
    // What we promise against what the factory gives (people who see costs): lead time, payment, warranty.
    for (const c of checksOf({ ...r, options: [o] }, o)) if (!c.ok) out.push(`${who}: ${c.text}`);
    return out;
  });
}
