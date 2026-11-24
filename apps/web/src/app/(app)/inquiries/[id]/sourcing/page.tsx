import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Columns3, List } from "lucide-react";
import { REQUEST_CHANNEL_LABEL } from "@kebo/shared";
import { THead, Th, Tr, Badge, cn, EmptyLine, Notice, RULES, subTitleClass, Dash } from "@kebo/ui";
import { requirePermission } from "@/lib/session";
import { dayMonth, money, qty, companyToday } from "@/lib/format";
import { dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import type { FactoryQuoteView, SourcingView } from "@/lib/types-deals";
import { TabList } from "@/components/lists/tab-list";
import { offerFigures, OfferCompare, offerLine } from "@/components/deals/offer-list";
import { optional } from "@/components/print/data";
import { coverText } from "@/components/deals/offer-facts";
import { AddOfferButton } from "@/components/deals/offer-work";
import { requestsOf } from "../facts";
import { WithSide } from "../side";
import { RequestMore } from "@/components/deals/ask-window";
import { factoryRequestStatusAction, removeFactoryRequestAction } from "../../factory-request-actions";
import { addOfferLinesAction, copyOfferLinesAction, editOfferLineAction, moveOfferLineAction, removeOfferLineAction, saveFactoryQuoteAction, searchFactoriesAction } from "./actions";
import { removeFileAction } from "../../actions";
import { getSettings } from "@/lib/loaders";
import { inquiryTitle } from "@/lib/titles";

export const generateMetadata = inquiryTitle("Supplier offers");


/**
 * Supplier offers (design "RFQ Desk — list pages", 18 Nov 2026): who was asked and what they offered in one list —
 * Supplier · Amount (with tax, and how) · Covers · Lead time · Incoterm · Deposit · Status (In quotation A, Offer in,
 * Waiting 3 days, Declined). A supplier still to answer is a row too, its ⋯ with Remind, They declined, Remove. The
 * page's one strong button stays in the header; the card has one plain button, New supplier offer (the list's last row
 * on a phone). Ask more suppliers is off for now (asked 19 Nov; the window stays in ../ask.tsx).
 * List | Compare once two offers have items: the offers side by side, lowest, fastest and longest marked.
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
  await requirePermission("sourcing.manage");
  const [d, s, settings, q] = await Promise.all([
    dealOf(id),
    sourcingOf(id),
    getSettings(),
    optional(() => quotationOf(id)),
  ]);
  const canEdit = d.allowed.source;
  const base = `/inquiries/${d.id}/sourcing`;
  const today = companyToday();
  const compare = sp.view === "compare";
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
    <Notice tone="info">
      {d.stage === "won" || d.stage === "lost"
        ? "This inquiry is closed, so its supplier prices can no longer change."
        : "Only the person handling this inquiry (or a manager) can change its supplier prices."}
    </Notice>
  );

  // One row per supplier: its offer once it is in, else that it was asked (still waiting, declined, no reply), last.
  const others = (requests?.items ?? []).filter((r) => !r.factoryQuoteId);
  const answered = s.quotes.length;
  const asked = answered + others.length;

  const priced = s.quotes.filter((x) => x.lines.length).length;
  const declined = others.filter((r) => r.status === "declined").length;
  const summary =
    asked > 0
      ? // An offer typed in is not a supplier asked: "asked" only for the asks recorded (review 24 Nov, S-13: "2 asked" counted offers).
        [
          requests?.items.length ? `${requests.items.length} asked` : null,
          `${answered} offer${answered === 1 ? "" : "s"} in`,
          waiting.length ? `${waiting.length} waiting` : null,
          declined ? `${declined} declined` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "No offer yet";
  const status = (x: FactoryQuoteView) => {
    const letters = usedIn.get(x.id) ?? [];
    return letters.length ? <Badge tone="ok">In quotation {letters.join(", ")}</Badge> : <Badge tone="info">Offer in</Badge>;
  };
  const requestStatus = (r: (typeof others)[number]) => {
    if (r.status !== "sent") return <Badge tone="neutral">{r.statusLabel}</Badge>;
    const days = r.waitingDays ?? 0;
    return <Badge tone={r.late ? "bad" : "warn"}>{days < 1 ? "Waiting" : `Waiting ${days} day${days === 1 ? "" : "s"}`}</Badge>;
  };
  const askedLine = (r: (typeof others)[number]) =>
    [
      `asked ${dayMonth(r.sentOn)}${r.channel ? ` by ${REQUEST_CHANNEL_LABEL[r.channel].toLowerCase()}` : ""}`,
      r.status === "sent" ? (r.replyBy ? `answer due ${dayMonth(r.replyBy)}` : null) : r.statusLabel.toLowerCase(),
      r.note,
    ]
      .filter(Boolean)
      .join(" · ");
  // An offer with its items but not one price yet says so (not "USD 0.00").
  const unpriced = (x: FactoryQuoteView) => x.lines.length > 0 && x.unpriced >= x.lines.length;
  const covers = (x: FactoryQuoteView) => {
    return coverText(x, s.items, "cell");
  };
  const more = (r: (typeof others)[number]) =>
    canEdit && <RequestMore name={r.factory.name} status={r.status} setStatus={factoryRequestStatusAction.bind(null, d.id, r.id)} remove={removeFactoryRequestAction.bind(null, d.id, r.id)} />;
  const dash = <Dash />;
  const two = (v: { main: string; sub: string | null } | null) =>
    v ? (
      <>
        <span className="block">{v.main}</span>
        {v.sub && <span className="block text-xs text-text-2">{v.sub}</span>}
      </>
    ) : (
      dash
    );
  // The one table head (Th) with this table's tighter padding. Its status may wrap and the supplier's column has no
  // fixed width, so the table fits its column on a laptop instead of scrolling sideways.
  const th = "px-2 first:pl-5 last:pr-3";
  const td = "border-t border-line/70 px-2 py-2.5 align-middle first:pl-5 last:pr-3";

  return (
    <WithSide id={id}>
      {notice}
      <TabList
        title="Supplier offers"
        summary={summary}
        views={
          priced > 1
            ? {
                label: "Show the offers as",
                current: compare ? "compare" : "list",
                options: [
                  { key: "list", label: "List", icon: <List aria-hidden className="size-4" />, href: base },
                  { key: "compare", label: "Compare", icon: <Columns3 aria-hidden className="size-4" />, href: `${base}?view=compare` },
                ],
              }
            : null
        }
        // The card's one button is plain: the page's one strong button is the header's (design rules).
        add={addOffer({ variant: "secondary", size: "sm", label: "New supplier offer", open: sp.add === "1" })}
      >
        {asked === 0 ? (
          <NoOffers items={s.items} />
        ) : compare && priced > 1 ? (
          <OfferCompare
            view={s}
            status={status}
            dealId={d.id}
            waiting={others.map((r) => (r.status === "sent" ? `${r.factory.name} has not answered yet (asked ${dayMonth(r.sentOn)}).` : `${r.factory.name}: ${r.statusLabel.toLowerCase()}.`))}
          />
        ) : (
          <>
            {/* A phone: each supplier in three lines (what it is and its status; the amount and what it covers; its terms). */}
            <ul aria-label="Supplier offers" className="divide-y divide-line md:hidden">
              {s.quotes.map((x) => {
                const f = offerFigures(x);
                return (
                  <li key={x.id}>
                    <Link href={`/inquiries/${d.id}/offers/${x.id}`} className="block px-4 py-3 text-md leading-[18px] active:bg-surface-2">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text">{x.factory.name}</span>
                        {status(x)}
                      </span>
                      <span className="mt-1 block font-semibold text-text tabular">
                        {!x.lines.length ? "—" : unpriced(x) ? <span className="text-warn">No prices yet</span> : money(f.withTax, x.currency)}{" "}
                        <span className="font-normal text-text-2">· {covers(x)}</span>
                      </span>
                      <span className="block text-text-2">{[x.leadTime, x.basis ? [x.basis, x.basisPlace].filter(Boolean).join(" ") : null, f.deposit ? `${f.deposit} deposit` : null].filter(Boolean).join(" · ") || offerLine(x)}</span>
                    </Link>
                  </li>
                );
              })}
              {others.map((r) => (
                <li key={r.id} className="flex items-start gap-2 px-4 py-3 text-md leading-[18px]">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Link href={`/suppliers/${r.factory.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-text">
                        {r.factory.name}
                      </Link>
                      {requestStatus(r)}
                    </span>
                    <span className={cn("mt-1 block text-text-2", r.late && "text-bad")}>{askedLine(r)}</span>
                  </span>
                  <span className="-mr-2 -mt-1.5">{more(r)}</span>
                </li>
              ))}
            </ul>
            <div className="scroll-x max-md:hidden">
              <table aria-label="Supplier offers" className="w-full border-collapse text-md">
                <THead>
                  <tr>
                    <Th className={th}>Supplier</Th>
                    <Th className={cn(th, "text-right")}>Amount</Th>
                    <Th className={th}>Covers</Th>
                    <Th className={th}>Lead time</Th>
                    <Th className={th}>Incoterm</Th>
                    <Th className={cn(th, "text-right")}>Deposit</Th>
                    <Th className={th}>Status</Th>
                    <Th className={th}>
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </THead>
                <tbody>
                  {s.quotes.map((x) => {
                    const f = offerFigures(x);
                    const href = `/inquiries/${d.id}/offers/${x.id}`;
                    return (
                      <Tr key={x.id} href={href}>
                        <td className={td}>
                          <Link href={href} className="font-semibold text-text hover:text-primary">
                            {x.factory.name}
                          </Link>
                          <span className="block text-xs text-text-2">{offerLine(x)}</span>
                        </td>
                        <td className={cn(td, "text-right whitespace-nowrap tabular")}>
                          {x.lines.length && unpriced(x) ? (
                            <span className="font-semibold text-warn">No prices yet</span>
                          ) : x.lines.length ? (
                            <>
                              <b className="block font-semibold">{money(f.withTax, x.currency)}</b>
                              <span className="block text-xs text-text-2">{f.taxWord}</span>
                            </>
                          ) : (
                            dash
                          )}
                        </td>
                        <td className={cn(td, "whitespace-nowrap", !x.lines.length && "text-warn")}>
                          {covers(x)}
                          {x.unpriced > 0 && <span className="block text-xs text-warn">{x.unpriced} without a price</span>}
                        </td>
                        <td className={cn(td, "whitespace-nowrap")}>{two(f.lead)}</td>
                        <td className={cn(td, "whitespace-nowrap")}>{two(f.basis)}</td>
                        <td className={cn(td, "text-right tabular")}>{f.deposit ?? dash}</td>
                        <td className={td}>{status(x)}</td>
                        <td className={cn(td, "w-8 text-text-2")}>
                          <ChevronRight className="size-4" aria-hidden />
                        </td>
                      </Tr>
                    );
                  })}
                  {others.map((r) => (
                    <Tr key={r.id} href={`/suppliers/${r.factory.id}`}>
                      <td className={td}>
                        <Link href={`/suppliers/${r.factory.id}`} className="font-semibold text-text hover:text-primary">
                          {r.factory.name}
                        </Link>
                        <span className={cn("block text-xs text-text-2", r.late && "text-bad")}>{askedLine(r)}</span>
                      </td>
                      <td className={cn(td, "text-right")}>{dash}</td>
                      <td className={td}>{dash}</td>
                      <td className={td}>{dash}</td>
                      <td className={td}>{dash}</td>
                      <td className={cn(td, "text-right")}>{dash}</td>
                      <td className={td}>{requestStatus(r)}</td>
                      <td className={cn(td, "w-8")}>{more(r)}</td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </TabList>
    </WithSide>
  );
}

function NoOffers({ items }: { items: SourcingView["items"] }) {
  return (
    <div>
      <EmptyLine inset>No supplier offer yet. Enter one when a supplier sends its prices: each item gets a price box.</EmptyLine>
      {items.length > 0 && (
        <div className={cn("border-t border-line", RULES.box.body)}>
          <h3 className={subTitleClass}>What the suppliers quote on</h3>
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
