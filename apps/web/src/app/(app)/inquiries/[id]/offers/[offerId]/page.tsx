import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { RECORD_KIND, REQUEST_CHANNEL_LABEL, REVISION_STATUS_LABEL } from "@kebo/shared";
import { ButtonLink, RevisionBadge } from "@kebo/ui";
import { recordActions } from "@/components/records/actions";
import { requirePermission } from "@/lib/session";
import { companyToday, date } from "@/lib/format";
import { dealOf, quotationOf, sourcingOf } from "@/lib/deal-data";
import { optional } from "@/components/print/data";
import { coverOf } from "@/components/deals/offer-facts";
import { OfferBoxes, OfferUrlWindow, type OfferKit } from "@/components/deals/offer-work";
import { RecordPage } from "@/components/records/record-page";
import { getSettings } from "@/lib/loaders";
import { editsOf } from "@/lib/edit-data";
import { inquiryTitle } from "@/lib/titles";
import { removeFileAction } from "../../../actions";
import { requestsOf } from "../../facts";
import {
  addOfferLinesAction,
  copyOfferLinesAction,
  editOfferLineAction,
  moveOfferLineAction,
  removeFactoryQuoteAction,
  removeOfferLineAction,
  saveFactoryQuoteAction,
  searchFactoriesAction,
} from "../../sourcing/actions";

export const generateMetadata = inquiryTitle("Supplier offer");

/**
 * One factory offer on its own page (design 17 Nov: each on its own page). Its top: the factory, its reference,
 * when it came and how long it holds, its tax; Quote this offer; ‹ 2 of 5 › through the inquiry's offers. Its
 * lines (Edit lines) and its details (Edit); beside them the quotations made from it and when it was asked.
 */
export default async function OfferOwnPage({ params, searchParams }: { params: Promise<{ id: string; offerId: string }>; searchParams: Promise<{ panel?: string }> }) {
  const [{ id, offerId }, sp] = await Promise.all([params, searchParams]);
  await requirePermission("sourcing.manage");
  const [d, s, settings, q, requests] = await Promise.all([dealOf(id), sourcingOf(id), getSettings(), optional(() => quotationOf(id)), requestsOf(id)]);
  const at = s.quotes.findIndex((x) => x.id === offerId);
  const x = s.quotes[at];
  if (!x) notFound();
  const canEdit = d.allowed.source;
  const today = companyToday();
  const base = `/inquiries/${d.id}`;
  const edits = await editsOf("factory_quote", x.id);
  const cover = coverOf(x, s.items);
  const asked = (requests?.items ?? []).find((r) => r.factoryQuoteId === x.id) ?? null;
  const lines = {
    add: addOfferLinesAction.bind(null, d.id),
    edit: editOfferLineAction.bind(null, d.id),
    move: moveOfferLineAction.bind(null, d.id),
    remove: removeOfferLineAction.bind(null, d.id),
    copy: copyOfferLinesAction.bind(null, d.id),
    removeFile: removeFileAction.bind(null, d.id),
  };
  // The quotations made from this offer (their newest revision quotes it).
  const quotedIn = (q?.quotations ?? []).flatMap((y) => {
    const c = y.revisions.find((r) => r.status === "draft") ?? y.revisions[0];
    return c && c.options.some((o) => o.factoryQuoteId === x.id) ? [{ id: y.id, refNo: y.refNo, number: c.number, status: c.status }] : [];
  });
  // Every Edit on the page opens the offer's steps window on its step (Lines · Delivery · Payment · Warranty & conditions).
  const kit: OfferKit = {
    dealId: d.id,
    today,
    mainCurrency: s.currency,
    rates: settings.sales.exchangeRates,
    searchFactories: searchFactoriesAction,
    saveAction: saveFactoryQuoteAction.bind(null, d.id, x.id),
    removeAction: removeFactoryQuoteAction.bind(null, d.id, x.id),
    removeFile: lines.removeFile,
    items: s.items,
    others: s.quotes.filter((o) => o.id !== x.id && o.lines.length),
    lineActions: lines,
    linesCard: edits?.cards.lines,
    refNo: d.refNo,
  };
  const prev = at > 0 ? s.quotes[at - 1]! : null;
  const next = at < s.quotes.length - 1 ? s.quotes[at + 1]! : null;
  // What it covers; its reference, dates, currency and tax are in Details beside (each said once).
  const summary = [
    !x.lines.length ? "no items yet" : cover ? (cover.all ? (cover.of === 1 ? "covers the 1 item" : `covers all ${cover.of} items`) : `covers ${cover.n} of ${cover.of} items`) : null,
  ].filter(Boolean);

  const pager = {
    label: `Supplier offers of ${d.refNo}`,
    what: "offer",
    at,
    of: s.quotes.length,
    prev: prev ? { href: `${base}/offers/${prev.id}`, name: prev.factory.name } : null,
    next: next ? { href: `${base}/offers/${next.id}`, name: next.factory.name } : null,
  };

  return (
    <RecordPage
      pager={pager}
      header={{
        crumbs: [{ label: "Sales" }, { label: "Inquiries", href: "/inquiries" }, { label: d.refNo, href: base }, { label: x.factory.name }],
        back: { href: `${base}/sourcing`, label: `${d.refNo} · Supplier offers` },
        title: x.factory.name,
        record: { kind: RECORD_KIND.offer, number: d.refNo },
        summary: summary.length ? <p className="min-w-0">{summary.join(" · ")}</p> : undefined,
        // One strong button (design rules 2 and 3), the rest in ⋯ (canvas board "Actions: one list per record type").
        ...recordActions(`More for ${x.factory.name}’s offer`, [
          {
            id: "quote",
            place: "primary",
            when: d.allowed.quote && x.lines.length > 0,
            node: (
              <ButtonLink href={`${base}/quotation?start=1&offer=${x.id}`} variant="primary">
                <Plus aria-hidden /> Quote this offer
              </ButtonLink>
            ),
          },
          { id: "edit", place: "more", when: canEdit, label: "Edit offer", href: `${base}/offers/${x.id}?panel=edit-offer` },
          { id: "supplier", place: "more", label: `Open the supplier ${x.factory.name}`, href: `/suppliers/${x.factory.id}` },
          { id: "compare", place: "more", label: "Compare the offers side by side", href: `${base}/sourcing?view=compare` },
          { id: "link", place: "more", label: "Copy link to this offer", copy: `${base}/offers/${x.id}` },
        ]),
      }}
      panel={{
        label: "About this offer",
        // The bar on a phone: where it is quoted, and when it was asked.
        summary: [
          quotedIn.length ? quotedIn.map((y) => `${y.refNo} R${y.number} ${REVISION_STATUS_LABEL[y.status].toLowerCase()}`).join(", ") : "Not quoted yet",
          asked ? `asked ${date(asked.sentOn)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        sections: [
          {
            id: "o-quoted",
            title: "Quoted in",
            children: quotedIn.length ? (
              quotedIn.map((y) => (
                <Link key={y.id} href={`${base}/quotations/${y.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-md hover:bg-surface-2">
                  <span className="font-semibold">
                    {y.refNo} <span className="font-normal text-text-2">R{y.number}</span>
                  </span>
                  <RevisionBadge status={y.status} />
                </Link>
              ))
            ) : (
              <p className="text-md text-text-2">Not quoted yet.</p>
            ),
          },
          ...(asked
            ? [
                {
                  id: "o-asked",
                  title: "Asked",
                  children: <p className="text-md text-text-2">{`${date(asked.sentOn)}${asked.channel ? ` by ${REQUEST_CHANNEL_LABEL[asked.channel].toLowerCase()}` : ""}`}</p>,
                },
              ]
            : []),
        ],
      }}
    >
      {/* The same boxes as its steps (design 18 Nov), each with its history and Edit. */}
      <OfferBoxes q={x} kit={kit} canEdit={canEdit} edits={edits ?? undefined} mainCurrency={s.currency} historyHref={`${base}/history`} />
      {canEdit && sp.panel === "edit-offer" && <OfferUrlWindow kit={kit} q={x} />}
    </RecordPage>
  );
}
