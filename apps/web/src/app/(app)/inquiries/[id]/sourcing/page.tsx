import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, Columns3, Factory, FileText } from "lucide-react";
import { basisText, offerTaxTag, REQUEST_CHANNEL_LABEL } from "@kebo/shared";
import { Alert, Badge, buttonClass, ButtonLink, Card, CardHeader, cn, EmptyState, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { date, dayMonth, money, plural, qty, companyToday } from "@/lib/format";
import { dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import type { FactoryQuoteView, SourcingView } from "@/lib/types-deals";
import { optional } from "@/components/print/data";
import { cheapestComplete, coverOf } from "@/components/deals/offer-facts";
import { AddOfferButton } from "@/components/deals/offer-work";
import { askFactories } from "../ask";
import { offerFactsOf, requestsOf } from "../facts";
import { WithSide } from "../side";
import { inquiryNext } from "../steps";
import { RequestMore } from "@/components/deals/ask-window";
import { factoryRequestStatusAction, removeFactoryRequestAction } from "../../factory-request-actions";
import { addOfferLinesAction, copyOfferLinesAction, editOfferLineAction, moveOfferLineAction, removeOfferLineAction, saveFactoryQuoteAction, searchFactoriesAction } from "./actions";
import { removeFileAction } from "../../actions";
import { getSettings } from "@/lib/loaders";
import { inquiryTitle } from "@/lib/titles";

export const generateMetadata = inquiryTitle("Supplier offers");


/**
 * Factory offers: one line per factory asked — its offer once it is in (total, what it covers, lead time,
 * valid until, which option of the quotation it is), or that it has not answered yet. A click opens a line
 * in place: the offer's lines (Edit lines, the wide lines editor) and its details (Edit, the form in the
 * panel), each with its "Edited n×". "Compare side by side" sets each of the customer's items across the offers.
 */
export default async function SourcingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; offer?: string; add?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Links from before each offer had its own page (…/sourcing?offer=<id>) open that page.
  if (sp.offer) redirect(`/inquiries/${id}/offers/${sp.offer}`);
  const me = await requirePermission("sourcing.manage");
  const [d, s, settings, q] = await Promise.all([
    dealOf(id),
    sourcingOf(id),
    getSettings(),
    optional(() => quotationOf(id)),
  ]);
  const canEdit = d.allowed.source;
  const base = `/inquiries/${d.id}/sourcing`;
  const today = companyToday();
  const ask = await askFactories(d, me, "secondary", { label: "Ask more suppliers", size: "sm" });
  const compare = sp.view === "compare";
  const cheapest = cheapestComplete(s.quotes);
  // Which quotation option each offer is, on the newest revision (a draft when one is open).
  // Which quotations each offer is quoted in (their newest revision, a draft when one is open): A, B…
  const usedIn = new Map<string, string[]>();
  for (const y of q?.quotations ?? []) {
    const c = y.revisions.find((r) => r.status === "draft") ?? y.revisions[0];
    for (const o of c?.options ?? []) if (o.factoryQuoteId) usedIn.set(o.factoryQuoteId, [...(usedIn.get(o.factoryQuoteId) ?? []), y.letter]);
  }
  // The factories asked for this inquiry come first in the new offer's picker (design 18 Nov).
  const requests = await requestsOf(d.id);
  const askedFactories = (requests?.items ?? []).flatMap((r) =>
    r.factory
      ? [{ id: r.factory.id, name: r.factory.name, contactPerson: null, note: [r.sentOn ? `asked ${dayMonth(r.sentOn)}` : "asked", r.factoryQuoteId ? "offer in" : "no offer yet"].join(" · ") }]
      : [],
  );
  const addOffer = (props: { variant?: "primary" | "secondary" | "ghost"; size?: "xs" | "sm" | "md"; label?: string; open?: boolean }) =>
    canEdit ? (
      <AddOfferButton
        dealId={d.id}
        refNo={d.refNo}
        inquiryTitle={d.title}
        asked={askedFactories}
        today={today}
        mainCurrency={s.currency}
        rates={settings.sales.exchangeRates}
        searchFactories={searchFactoriesAction}
        createAction={saveFactoryQuoteAction.bind(null, d.id, null)}
        items={s.items}
        others={s.quotes.filter((o) => o.lines.length)}
        lineActions={{
          add: addOfferLinesAction.bind(null, d.id),
          edit: editOfferLineAction.bind(null, d.id),
          move: moveOfferLineAction.bind(null, d.id),
          remove: removeOfferLineAction.bind(null, d.id),
          copy: copyOfferLinesAction.bind(null, d.id),
          removeFile: removeFileAction.bind(null, d.id),
        }}
        taxDefault={{ included: settings.sales.factoryTaxIncluded ?? false, rate: settings.sales.factoryTaxRate ?? 0, advance: settings.sales.factoryAdvancePercent ?? 30 }}
        variant={props.variant}
        size={props.size}
        label={props.label}
        defaultOpen={props.open}
      />
    ) : null;

  const waiting = (requests?.items ?? []).filter((r) => !r.factoryQuoteId && r.status === "sent");

  const notice = !canEdit && (
    <Alert tone="info">
      {d.stage === "won" || d.stage === "lost"
        ? "This inquiry is closed, so its supplier prices can no longer change."
        : "Only the person handling this inquiry (or a manager) can change its supplier prices."}
    </Alert>
  );

  // Compare side by side: each of the customer's items across the offers, full width.
  if (compare && s.quotes.length > 0)
    return (
      <div className="flex flex-col gap-4">
        {notice}
        <Link href={base} className={buttonClass("ghost", "sm", "self-start px-1")}>
          <ArrowLeft aria-hidden /> Back to the offers
        </Link>
        {requests && requests.counts.asked > 0 && (
          <Alert tone={requests.counts.waiting ? "info" : "success"}>
            <strong>
              {requests.counts.quoted} of {requests.counts.asked} replied.
            </strong>{" "}
            {requests.counts.waiting ? `${requests.counts.waiting} still to answer.` : "Every supplier asked has answered."}
          </Alert>
        )}
        <CompareView view={s} dealId={d.id} />
      </div>
    );

  // The next thing to do here (an offer to enter, factories to ask): its button is the orange one.
  const next = inquiryNext(d, await offerFactsOf(id));
  const ownNext = next?.tab === "sourcing" && canEdit;
  const firstAsk = !ownNext || waiting.length > 0 || s.quotes.length > 0 ? ask : await askFactories(d, me, "primary", { label: "Ask suppliers", size: "sm" });

  // One line per factory: its offer once it is in, or that it was asked and has not answered. Others asked and closed (declined, no reply) come last.
  const others = (requests?.items ?? []).filter((r) => !r.factoryQuoteId);
  const answered = s.quotes.length;
  const asked = answered + others.length;
  // The same list as Quotations (asked 17 Nov): the factory and what it offers first, the way in at the end.
  const COLS = "md:grid-cols-[minmax(0,1.5fr)_130px_minmax(0,1fr)_minmax(0,1fr)_124px_32px]";
  const dash = <span className="text-muted">—</span>;

  return (
    <WithSide id={id}>
      {notice}
      <Card className="overflow-clip">
        <CardHeader
          title="Supplier offers"
          description={asked > 0 ? `${asked} asked · ${answered} answered` : "Nobody was asked yet."}
          actions={
            <span className="flex flex-wrap items-center gap-2 sm:justify-end">
              {s.quotes.length > 1 && (
                // A button like the others beside it (a bare word sat out of line with them on a phone).
                <ButtonLink href={`${base}?view=compare`} size="sm" variant="secondary">
                  <Columns3 aria-hidden /> Compare
                </ButtonLink>
              )}
              {firstAsk?.button}
              {addOffer({
                variant: ownNext && (waiting.length > 0 || s.quotes.length > 0) ? "primary" : "secondary",
                size: "sm",
                label: "Enter an offer",
                open: sp.add === "1",
              })}
            </span>
          }
        />
        {asked === 0 ? (
          <NoOffers items={s.items} />
        ) : (
          <>
            <div aria-hidden className={cn("hidden items-center gap-x-4 border-b border-line bg-surface-2/60 px-5 py-2 text-xs font-medium text-text-2 md:grid", COLS)}>
              <span>Supplier</span>
              <span className="text-right">Offer total</span>
              <span>Covers</span>
              <span>Lead time</span>
              <span>Status</span>
              <span />
            </div>
            <ul>
              {s.quotes.map((x) => {
                const cover = coverOf(x, s.items);
                const letters = usedIn.get(x.id) ?? [];
                const tax = offerTaxTag(x.taxRate, x.taxIncluded) ?? (x.lines.length ? "no tax" : null);
                const covers = !x.lines.length ? "No items yet" : cover ? (cover.all ? (cover.of === 1 ? "The 1 item" : `All ${cover.of} items`) : `${cover.n} of ${cover.of} items`) : plural(x.lines.length, "line");
                return (
                  <li key={x.id} className="border-b border-line last:border-b-0">
                    <Link
                      href={`/inquiries/${d.id}/offers/${x.id}`}
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)_auto_32px] items-start gap-x-4 gap-y-1 px-5 py-3 text-[13px] hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-text",
                        COLS,
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-text [overflow-wrap:break-word]">{x.factory.name}</span>
                        <span className="block text-xs text-text-2 [overflow-wrap:anywhere]">
                          {[x.reference ? `their ref. ${x.reference}` : null, `received ${date(x.receivedOn)}`, x.validUntil ? `valid until ${date(x.validUntil)}` : null].filter(Boolean).join(" · ")}
                        </span>
                        {/* A phone: what the other columns say, on two short lines. */}
                        <span className="block text-xs text-text-2 md:hidden">{[covers, x.leadTime, letters.length ? `In ${letters.join(", ")}` : null].filter(Boolean).join(" · ")}</span>
                        <span className="block text-xs font-semibold text-text tabular md:hidden">
                          {x.lines.length ? money(x.factoryTotal, x.currency) : "—"}
                          {tax && <span className="font-normal text-text-2"> · {tax}</span>}
                        </span>
                      </span>
                      <span className="text-right whitespace-nowrap tabular max-md:hidden">
                        <span className="block font-semibold">{x.lines.length ? money(x.factoryTotal, x.currency) : dash}</span>
                        {tax && <span className="block text-xs text-text-2">{tax}</span>}
                      </span>
                      <span className="min-w-0 max-md:hidden">
                        <span className={cn("block", !x.lines.length && "text-warn")}>{covers}</span>
                        {x.unpriced > 0 && <span className="block text-xs text-warn">{x.unpriced} without a price</span>}
                      </span>
                      <span className="min-w-0 max-md:hidden">{x.leadTime ?? dash}</span>
                      <span className="justify-self-end md:justify-self-start">
                        <span className="block font-semibold text-ok">Offer in</span>
                        {cheapest?.id === x.id && s.quotes.length > 1 && <span className="block text-xs text-text-2">cheapest complete</span>}
                        {/* The quotation options priced from it (A, B…). */}
                        {letters.length > 0 && (
                          <span className="mt-1 flex flex-wrap items-center gap-1 text-xs text-text-2 max-md:hidden">
                            In {letters.map((l) => <Badge key={l} tone="ok">{l}</Badge>)}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="mt-0.5 size-4 self-center justify-self-center text-text-2" aria-hidden />
                    </Link>
                  </li>
                );
              })}
              {others.map((r) => (
                <li key={r.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto_32px] items-start gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-[13px] last:border-b-0", COLS)}>
                  <span className="min-w-0">
                    <Link href={`/suppliers/${r.factory.id}`} className="block font-semibold text-text [overflow-wrap:anywhere] hover:text-primary">
                      {r.factory.name}
                    </Link>
                    <span className="block text-xs text-text-2">
                      Asked {date(r.sentOn)}
                      {r.channel ? ` by ${REQUEST_CHANNEL_LABEL[r.channel].toLowerCase()}` : ""}
                      {r.note ? ` · ${r.note}` : ""}
                    </span>
                  </span>
                  <span className="text-right max-md:hidden">{dash}</span>
                  <span className="max-md:hidden">{dash}</span>
                  <span className="max-md:hidden">{dash}</span>
                  <span className="justify-self-end md:justify-self-start">
                    <span className={cn("block font-semibold", r.status === "sent" ? "text-action" : r.status === "declined" ? "text-bad" : "text-text-2")}>
                      {r.status === "sent" ? "Waiting" : r.statusLabel}
                    </span>
                    {r.status === "sent" && r.replyBy && <span className={cn("block text-xs", r.late ? "text-bad" : "text-text-2")}>due {date(r.replyBy)}</span>}
                  </span>
                  <span className="flex justify-center self-center">
                    {canEdit && (
                      <RequestMore
                        name={r.factory.name}
                        status={r.status}
                        setStatus={factoryRequestStatusAction.bind(null, d.id, r.id)}
                        remove={removeFactoryRequestAction.bind(null, d.id, r.id)}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </WithSide>
  );
}

function NoOffers({ items }: { items: SourcingView["items"] }) {
  return (
    <div>
      <EmptyState
        icon={Factory}
        title="No supplier asked yet"
        description="Send the customer's list to two or three suppliers. Each one shows here as a charge; when it replies, enter its offer: the customer's items are listed with a price box each."
      />
      {items.length > 0 && (
        <div className="border-t border-line px-5 py-4">
          <h3 className="text-sm font-semibold">What the suppliers quote on</h3>
          <ul className="mt-1 flex flex-col divide-y divide-line">
            {items.map((it) => (
              <li key={it.id} className={cn("flex items-baseline justify-between gap-3 py-2 text-sm", it.parentId && "pl-5")}>
                <span className="min-w-0">
                  <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-text-2 tabular">{it.no}</span>
                  {it.description.split("\n")[0]}
                </span>
                <span className="shrink-0 text-text-2 tabular">
                  {qty(it.quantity)} {it.unit}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** "Compare side by side": the customer's items down the side, one column per offer. */
function CompareView({ view, dealId }: { view: SourcingView; dealId: string }) {
  const offers = view.quotes.filter((q) => q.lines.length);
  const base = `/inquiries/${dealId}/sourcing`;
  if (offers.length < 2)
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <h2 className="text-base font-semibold">{offers.length === 0 ? "No offer has items yet" : "Only one offer so far"}</h2>
        <p className="max-w-md text-sm text-text-2">
          Comparing needs at least two offers with their items. Ask another supplier and add its offer
          {offers.length === 1 ? `; you can still make a quotation from ${offers[0]!.factory.name} alone.` : "."}
        </p>
        <ButtonLink href={base} variant="secondary" size="sm">
          Back to the offers
        </ButtonLink>
      </Card>
    );

  // Offers on different price bases (EXW vs FOB) are not like for like on cost alone.
  const bases = [...new Set(offers.map((q) => q.basis ?? "?"))];
  const mixed = bases.length > 1;
  const cheapestTotal = mixed ? NaN : Math.min(...offers.filter((q) => q.totalCost !== null && !q.coverage.missing.length && !q.unpriced).map((q) => Number(q.totalCost)));
  const head = (q: FactoryQuoteView) => (
    <Th key={q.id} className="min-w-36 border-l border-line align-bottom sm:min-w-44">
      <Link href={`${base}?offer=${q.id}`} className="block text-sm font-semibold text-text hover:text-primary">
        {q.factory.name}
      </Link>
      <span className="block text-xs font-normal text-muted normal-case">
        {[q.basis ? basisText(q.basis, q.basisPlace) : "Incoterm not said", q.leadTime].filter(Boolean).join(" · ")}
      </span>
    </Th>
  );

  return (
    <div className="flex flex-col gap-3">
      {view.missingRates.length > 0 && (
        <Alert tone="warning">
          There is no exchange rate for {view.missingRates.join(", ")} in Settings, so those prices cannot be turned into {view.currency} and are left out
          here. Ask an admin to add the rate (1 {view.currency} = ? {view.missingRates[0]}).
        </Alert>
      )}
      {mixed && (
        <Alert tone="warning">
          Not like for like: these offers are on different price bases ({bases.map((b) => (b === "?" ? "not said" : b)).join(", ")}). The quotation adds
          freight and the like to each before comparing margins.
        </Alert>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <h2 className="text-base font-bold">
            Side by side<span className="text-xs font-normal text-muted"> · our cost per unit in {view.currency}, after tax; the cheapest in each row is marked</span>
          </h2>
          <ButtonLink href={`/inquiries/${dealId}/quotation`} variant="primary" size="sm">
            <FileText aria-hidden /> Make quotation
          </ButtonLink>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <THead>
              <tr>
                <Th className="sticky left-0 z-10 min-w-36 bg-surface-2 sm:min-w-48">{view.items.length ? "Customer's item" : "Item"}</Th>
                <Th className="hidden text-right sm:table-cell">Quantity</Th>
                {offers.map(head)}
              </tr>
            </THead>
            <tbody>
              {view.items.length > 0
                ? view.items.map((it) => (
                    <Tr key={it.id}>
                      <Td className={cn("sticky left-0 z-10 bg-surface", it.parentId && "pl-8")}>
                        <span className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-text-2 tabular">{it.no}</span>
                        <span className={cn("text-sm", !it.parentId && "font-medium")}>{it.description.split("\n")[0]}</span>
                        <span className="block text-xs text-muted tabular sm:hidden">
                          {qty(it.quantity)} {it.unit}
                        </span>
                      </Td>
                      <Td className="hidden text-right whitespace-nowrap text-text-2 tabular sm:table-cell">
                        {qty(it.quantity)} {it.unit}
                      </Td>
                      {offers.map((q) => {
                        const mine = it.options.filter((o) => o.quoteId === q.id);
                        const o = mine.find((x) => x.id === it.cheapestLineId) ?? mine[0];
                        return (
                          <Cell
                            key={q.id}
                            empty={!o ? (it.hasParts ? "In its parts" : "Not offered") : null}
                            emptyWarn={!o && !it.hasParts}
                            noPrice={!!o && Number(o.unitPrice) === 0}
                            noRate={!!o && o.unitCost === null}
                            cheapest={!!o && o.id === it.cheapestLineId && it.options.length > 1}
                            value={o?.unitCost ? money(o.unitCost, view.currency) : null}
                            model={o?.model ?? null}
                          />
                        );
                      })}
                    </Tr>
                  ))
                : view.products.map((p) => (
                    <Tr key={p.key}>
                      <Td className="sticky left-0 z-10 max-w-80 bg-surface">
                        <span className="line-clamp-2 text-sm">{p.description}</span>
                        <span className="block text-xs text-muted tabular sm:hidden">
                          {qty(p.quantity)} {p.unit}
                        </span>
                      </Td>
                      <Td className="hidden text-right whitespace-nowrap text-text-2 tabular sm:table-cell">
                        {qty(p.quantity)} {p.unit}
                      </Td>
                      {offers.map((q) => {
                        const o = p.options.find((x) => x.quoteId === q.id);
                        return (
                          <Cell
                            key={q.id}
                            empty={!o ? "Not offered" : null}
                            emptyWarn={false}
                            noPrice={!!o && Number(o.unitPrice) === 0}
                            noRate={!!o && o.unitCost === null}
                            cheapest={!!o && o.id === p.cheapestLineId}
                            value={o?.unitCost ? money(o.unitCost, view.currency) : null}
                            model={o?.model ?? null}
                          />
                        );
                      })}
                    </Tr>
                  ))}
              <SummaryRow label="Our cost, whole offer" strong>
                {offers.map((q) => (
                  <Td key={q.id} className="border-l border-line text-right font-semibold whitespace-nowrap tabular">
                    {q.totalCost === null ? <span className="text-xs font-medium text-warn">No exchange rate</span> : money(q.totalCost, view.currency)}
                    {q.totalCost !== null && Number(q.totalCost) === cheapestTotal && (
                      <Badge tone="ok" className="ml-1.5">
                        Cheapest complete
                      </Badge>
                    )}
                  </Td>
                ))}
              </SummaryRow>
              {view.items.length > 0 && (
                <SummaryRow label="Covers the customer's list">
                  {offers.map((q) => (
                    <Td key={q.id} className={cn("border-l border-line text-right text-sm font-medium", q.coverage.missing.length ? "text-warn" : "text-ok")}>
                      {q.coverage.missing.length ? `Missing ${q.coverage.missing.join(", ")}` : "All items"}
                    </Td>
                  ))}
                </SummaryRow>
              )}
              <SummaryRow label="Items without a price">
                {offers.map((q) => (
                  <Td key={q.id} className={cn("border-l border-line text-right text-sm", q.unpriced ? "font-medium text-warn" : "text-muted")}>
                    {q.unpriced || "None"}
                  </Td>
                ))}
              </SummaryRow>
              <SummaryRow label="Valid until">
                {offers.map((q) => (
                  <Td key={q.id} className="border-l border-line text-right text-sm whitespace-nowrap">
                    {q.validUntil ? date(q.validUntil) : <span className="text-muted">—</span>}
                  </Td>
                ))}
              </SummaryRow>
              <SummaryRow label="Supplier's quotation file">
                {offers.map((q) => (
                  <Td key={q.id} className={cn("border-l border-line text-right text-sm font-medium", q.files.length ? "text-ok" : "text-warn")}>
                    {q.files.length ? "Attached" : "Missing"}
                  </Td>
                ))}
              </SummaryRow>
            </tbody>
          </Table>
        </div>
      </Card>
      {/* Terms (board): each offer's basis, lead time, payment, validity and their reference. */}
      <Card className="overflow-hidden">
        <CardHeader title="Terms" />
        <Table className="min-w-[560px]">
          <THead>
            <tr>
              <Th className="w-40" />
              {offers.map((q) => (
                <Th key={q.id}>{q.factory.name}</Th>
              ))}
            </tr>
          </THead>
          <tbody>
            {(
              [
                ["Incoterm", (q: FactoryQuoteView) => (q.basis ? basisText(q.basis, q.basisPlace) : "—")],
                ["Lead time", (q: FactoryQuoteView) => q.leadTime ?? "—"],
                ["Payment", (q: FactoryQuoteView) => q.paymentTerms ?? (q.advancePercent !== null ? `${q.advancePercent}% deposit` : "—")],
                ["Valid until", (q: FactoryQuoteView) => (q.validUntil ? date(q.validUntil) : "—")],
                ["Their ref.", (q: FactoryQuoteView) => q.reference ?? "—"],
              ] as const
            ).map(([label, value]) => (
              <Tr key={label}>
                <Td className="text-text-2">{label}</Td>
                {offers.map((q) => (
                  <Td key={q.id}>{value(q)}</Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

function SummaryRow({ label, strong, children }: { label: string; strong?: boolean; children: React.ReactNode }) {
  return (
    <Tr className="bg-surface-2/50">
      <Td className={cn("sticky left-0 z-10 bg-surface-2 text-sm", strong ? "font-semibold" : "text-text-2")}>{label}</Td>
      <Td className="hidden sm:table-cell" />
      {children}
    </Tr>
  );
}

function Cell({
  empty,
  emptyWarn,
  noPrice,
  noRate,
  cheapest,
  value,
  model,
}: {
  empty: string | null;
  emptyWarn: boolean;
  noPrice: boolean;
  noRate: boolean;
  cheapest: boolean;
  value: string | null;
  model: string | null;
}) {
  if (empty)
    return (
      <Td className={cn("border-l border-line text-right text-xs font-medium", emptyWarn ? "bg-warn-soft/40 text-warn" : "text-muted")}>{empty}</Td>
    );
  return (
    <Td className={cn("border-l border-line text-right whitespace-nowrap tabular", cheapest && "bg-ok-soft")}>
      {noPrice ? (
        <span className="text-xs font-medium text-warn">No price yet</span>
      ) : noRate ? (
        <span className="text-xs font-medium text-warn">No exchange rate</span>
      ) : (
        <span className={cn("font-medium", cheapest && "text-ok")}>
          {value}
          {cheapest && <span className="ml-1 text-xs">· cheapest</span>}
        </span>
      )}
      {model && <span className="block text-xs text-muted">{model}</span>}
    </Td>
  );
}
