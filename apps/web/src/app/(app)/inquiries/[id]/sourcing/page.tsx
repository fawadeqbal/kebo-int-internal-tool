import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Factory, FileText } from "lucide-react";
import { basisText, REQUEST_CHANNEL_LABEL } from "@kebo/shared";
import { Alert, Badge, buttonClass, ButtonLink, Card, CardHeader, cn, EmptyState, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { requirePermission } from "@/lib/session";
import { date, money, plural, qty, TZ } from "@/lib/format";
import { dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import type { FactoryQuoteView, SourcingView } from "@/lib/types-deals";
import { optional } from "@/components/print/data";
import { cheapestComplete, coverOf } from "@/components/deals/offer-facts";
import { AddOfferButton, OfferDetails, OfferLines } from "@/components/deals/offer-work";
import { removeFileAction } from "../../actions";
import { askFactories } from "../ask";
import { NextCard } from "@/components/deals/inquiry-nav";
import { offerFactsOf, requestsOf } from "../facts";
import { WithSide } from "../side";
import { inquiryNext } from "../steps";
import { RequestMore } from "@/components/deals/ask-window";
import { factoryRequestStatusAction, removeFactoryRequestAction } from "../../factory-request-actions";
import { addOfferLinesAction, copyOfferLinesAction, editOfferLineAction, moveOfferLineAction, offerFieldsAction, removeFactoryQuoteAction, removeOfferLineAction, saveFactoryQuoteAction, searchFactoriesAction } from "./actions";
import { getSettings } from "@/lib/loaders";
import { editsOf } from "@/lib/edit-data";

export const metadata = { title: "Factory offers" };


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
  const me = await requirePermission("sourcing.manage");
  const [d, s, settings, q] = await Promise.all([
    dealOf(id),
    sourcingOf(id),
    getSettings(),
    optional(() => quotationOf(id)),
  ]);
  const canEdit = d.allowed.source;
  const base = `/inquiries/${d.id}/sourcing`;
  const today = todayIn(TZ);
  const ask = await askFactories(d, me, "secondary", { label: "Ask more factories", size: "sm" });
  const compare = sp.view === "compare";
  const cheapest = cheapestComplete(s.quotes);
  // Which quotation option each offer is, on the newest revision (a draft when one is open).
  const revs = [...(q?.revisions ?? [])].sort((a, b) => b.number - a.number);
  const current = revs[0] ?? null;
  const letterOf = new Map((current?.options ?? []).filter((o) => o.factoryQuoteId).map((o) => [o.factoryQuoteId!, o.letter]));
  const lines = {
    add: addOfferLinesAction.bind(null, d.id),
    edit: editOfferLineAction.bind(null, d.id),
    move: moveOfferLineAction.bind(null, d.id),
    remove: removeOfferLineAction.bind(null, d.id),
    copy: copyOfferLinesAction.bind(null, d.id),
    removeFile: removeFileAction.bind(null, d.id),
  };
  const addOffer = (props: { variant?: "primary" | "secondary" | "ghost"; size?: "xs" | "sm" | "md"; label?: string; open?: boolean }) =>
    canEdit ? (
      <AddOfferButton
        dealId={d.id}
        refNo={d.refNo}
        items={s.items}
        today={today}
        mainCurrency={s.currency}
        rates={settings.sales.exchangeRates}
        searchFactories={searchFactoriesAction}
        createAction={saveFactoryQuoteAction.bind(null, d.id, null)}
        taxDefault={{ included: settings.sales.factoryTaxIncluded ?? false, rate: settings.sales.factoryTaxRate ?? 0 }}
        variant={props.variant}
        size={props.size}
        label={props.label}
        defaultOpen={props.open}
      />
    ) : null;

  const requests = await requestsOf(d.id);
  const waiting = (requests?.items ?? []).filter((r) => !r.factoryQuoteId && r.status === "sent");
  const editing = s.quotes.find((x) => x.id === sp.offer) ?? null;
  const offerEdits = editing ? await editsOf("factory_quote", editing.id) : null;

  const notice = !canEdit && (
    <Alert tone="info">
      {d.stage === "won" || d.stage === "lost"
        ? "This inquiry is closed, so its factory prices can no longer change."
        : "Only the person handling this inquiry (or a manager) can change its factory prices."}
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
            {requests.counts.waiting ? `${requests.counts.waiting} still to answer.` : "Every factory asked has answered."}
          </Alert>
        )}
        <CompareView view={s} dealId={d.id} />
      </div>
    );

  // "Do next" with its working button, when the next thing is done on this tab (else the frame points to its tab).
  const next = inquiryNext(d, await offerFactsOf(id));
  const ownNext = next?.tab === "sourcing" && canEdit;
  const top = ownNext ? (
    <NextCard title={next.title} meta={next.meta}>
      {waiting.length > 0 || s.quotes.length > 0 ? (
        <>
          {ask?.button}
          {addOffer({ variant: "primary", size: "md", label: "Enter an offer", open: sp.add === "1" })}
        </>
      ) : (
        <>
          {addOffer({ variant: "secondary", size: "md", label: "Enter an offer", open: sp.add === "1" })}
          {(await askFactories(d, me, "primary", { label: "Ask factories", size: "md" }))?.button}
        </>
      )}
    </NextCard>
  ) : null;

  // One line per factory: its offer once it is in, or that it was asked and has not answered. Others asked and closed (declined, no reply) come last.
  const askedOf = new Map((requests?.items ?? []).filter((r) => r.factoryQuoteId).map((r) => [r.factoryQuoteId!, r]));
  const others = (requests?.items ?? []).filter((r) => !r.factoryQuoteId);
  const answered = s.quotes.length;
  const asked = answered + others.length;
  const COLS = "md:grid-cols-[16px_minmax(0,1fr)_128px_112px_92px_92px_76px_72px]";
  const dash = <span className="text-muted">—</span>;

  return (
    <WithSide id={id} top={top}>
      {notice}
      <Card className="overflow-clip">
        <CardHeader
          title="Factory offers"
          description={asked > 0 ? `${asked} asked · ${answered} answered` : "Nobody was asked yet."}
          actions={
            <span className="flex flex-wrap items-center gap-2 sm:justify-end">
              {s.quotes.length > 1 && (
                <ButtonLink href={`${base}?view=compare`} size="sm" variant="ghost">
                  Compare side by side
                </ButtonLink>
              )}
              {!ownNext && ask?.button}
              {!ownNext && addOffer({ variant: "secondary", size: "sm", label: "Enter an offer", open: sp.add === "1" })}
            </span>
          }
        />
        {asked === 0 ? (
          <NoOffers items={s.items} />
        ) : (
          <div>
            <div className={cn("hidden items-center gap-x-4 border-b border-line px-5 py-2 text-xs font-medium text-text-2 md:grid", COLS)}>
              <span />
              <span>Factory</span>
              <span className="text-right">Offer total</span>
              <span>Covers</span>
              <span>Lead time</span>
              <span>Valid until</span>
              <span>Used in</span>
              <span>Status</span>
            </div>
            {s.quotes.map((x) => {
              const open = editing?.id === x.id;
              const cover = coverOf(x, s.items);
              const letter = letterOf.get(x.id);
              return (
                <div key={x.id} id={open ? "offer" : undefined} className="scroll-mt-24 border-b border-line last:border-b-0">
                  <Link
                    href={open ? base : `${base}?offer=${x.id}#offer`}
                    scroll={false}
                    aria-expanded={open}
                    className={cn("grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-surface-2/60", COLS, open && "bg-primary-soft/40")}
                  >
                    {open ? <ChevronDown className="size-4 text-text-2" aria-hidden /> : <ChevronRight className="size-4 text-text-2" aria-hidden />}
                    <span className="min-w-0">
                      <span className="line-clamp-2 font-semibold">{x.factory.name}</span>
                      <span className="block text-xs text-text-2 md:hidden">
                        {[!x.lines.length ? "No lines yet" : cover ? (cover.all ? `All ${cover.of} items` : `${cover.n} of ${cover.of} items`) : null, x.leadTime, letter ? `Option ${letter}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="text-right font-semibold whitespace-nowrap tabular">{x.lines.length ? money(x.factoryTotal, x.currency) : dash}</span>
                    <span className="max-md:hidden">
                      {!x.lines.length ? (
                        <span className="text-warn">No lines yet</span>
                      ) : cover ? (
                        cover.all ? (
                          `All ${cover.of} items`
                        ) : (
                          `${cover.n} of ${cover.of} items`
                        )
                      ) : (
                        plural(x.lines.length, "line")
                      )}
                      {x.unpriced > 0 && <span className="block text-xs text-warn">{x.unpriced} without a price</span>}
                    </span>
                    <span className="max-md:hidden">{x.leadTime ?? dash}</span>
                    <span className="max-md:hidden">{x.validUntil ? date(x.validUntil) : dash}</span>
                    <span className="max-md:hidden">{letter ? <Badge tone="ok">Option {letter}</Badge> : dash}</span>
                    <span className="max-md:hidden">
                      <span className="font-semibold text-ok">Offer in</span>
                      {cheapest?.id === x.id && s.quotes.length > 1 && <span className="block text-xs text-text-2">cheapest complete</span>}
                    </span>
                  </Link>
                  {open && (
                    <div className="flex flex-col gap-4 border-t border-line bg-surface-2/40 p-2 sm:p-4 md:pl-12">
                      {askedOf.get(x.id) && (
                        <p className="text-xs text-text-2">
                          Asked {date(askedOf.get(x.id)!.sentOn)}
                          {askedOf.get(x.id)!.channel ? ` by ${REQUEST_CHANNEL_LABEL[askedOf.get(x.id)!.channel!].toLowerCase()}` : ""} · offer received {date(x.receivedOn)}
                        </p>
                      )}
                      <OfferLines
                        key={`l-${x.id}`}
                        q={x}
                        others={s.quotes.filter((o) => o.id !== x.id && o.lines.length)}
                        items={s.items}
                        canEdit={canEdit}
                        mainCurrency={s.currency}
                        lines={lines}
                        edits={offerEdits?.cards.lines}
                      />
                      <OfferDetails
                        key={`d-${x.id}`}
                        dealId={d.id}
                        q={x}
                        canEdit={canEdit}
                        today={today}
                        mainCurrency={s.currency}
                        rates={settings.sales.exchangeRates}
                        searchFactories={searchFactoriesAction}
                        saveAction={saveFactoryQuoteAction.bind(null, d.id, x.id)}
                        fieldsAction={offerFieldsAction.bind(null, d.id, x.id)}
                        removeAction={removeFactoryQuoteAction.bind(null, d.id, x.id)}
                        removeFile={lines.removeFile}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {others.map((r) => (
              <div key={r.id} className={cn("grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-sm last:border-b-0", COLS)}>
                <span />
                <span className="min-w-0">
                  <Link href={`/factories/${r.factory.id}`} className="line-clamp-2 font-semibold hover:text-primary">
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
                <span className="max-md:hidden">{dash}</span>
                <span className="max-md:hidden">{dash}</span>
                <span className="flex items-center justify-between gap-2 max-md:col-start-2 max-md:col-end-4">
                  <span>
                    <span className={cn("font-semibold", r.status === "sent" ? "text-action" : r.status === "declined" ? "text-bad" : "text-text-2")}>
                      {r.status === "sent" ? "Waiting" : r.statusLabel}
                    </span>
                    {r.status === "sent" && r.replyBy && <span className={cn("block text-xs", r.late ? "text-bad" : "text-text-2")}>due {date(r.replyBy)}</span>}
                  </span>
                  {canEdit && (
                    <RequestMore
                      name={r.factory.name}
                      status={r.status}
                      setStatus={factoryRequestStatusAction.bind(null, d.id, r.id)}
                      remove={removeFactoryRequestAction.bind(null, d.id, r.id)}
                    />
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
      {s.quotes.length > 0 && (
        <p className="text-xs text-muted">
          Our cost = their price to our basis, plus tax unless it is included, in {s.currency}. Click a line to open the offer: its lines and its details, each with its own Edit.
        </p>
      )}
    </WithSide>
  );
}

function NoOffers({ items }: { items: SourcingView["items"] }) {
  return (
    <div>
      <EmptyState
        icon={Factory}
        title="No factory asked yet"
        description="Send the customer's list to two or three factories. Each one shows here as a line; when it replies, enter its offer: the customer's items are listed with a price box each."
      />
      {items.length > 0 && (
        <div className="border-t border-line px-5 py-4">
          <h3 className="text-sm font-semibold">What the factories quote on</h3>
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
        <h2 className="text-base font-semibold">{offers.length === 0 ? "No offer has lines yet" : "Only one offer so far"}</h2>
        <p className="max-w-md text-sm text-text-2">
          Comparing needs at least two offers with their lines. Ask another factory and add its offer
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
        {[q.basis ? basisText(q.basis, q.basisPlace) : "Basis not said", q.leadTime].filter(Boolean).join(" · ")}
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
                <Th className="sticky left-0 z-10 min-w-36 bg-surface-2 sm:min-w-48">{view.items.length ? "Customer's item" : "Product"}</Th>
                <Th className="hidden text-right sm:table-cell">Qty</Th>
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
              <SummaryRow label="Lines without a price">
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
              <SummaryRow label="Factory's quotation file">
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
                ["Basis", (q: FactoryQuoteView) => (q.basis ? basisText(q.basis, q.basisPlace) : "—")],
                ["Lead time", (q: FactoryQuoteView) => q.leadTime ?? "—"],
                ["Payment", (q: FactoryQuoteView) => q.paymentTerms ?? (q.advancePercent !== null ? `${q.advancePercent}% advance` : "—")],
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
