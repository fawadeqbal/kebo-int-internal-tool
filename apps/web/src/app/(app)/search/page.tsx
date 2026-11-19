import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SEARCH_KIND_LABEL, SEARCH_KINDS, type SearchItem, type SearchKind, type SearchResult } from "@kebo/shared";
import { Badge, buildHref, ButtonLink, Card, EmptyState, LinkTabs, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { countOf } from "@/lib/format";
import { FilterCard } from "@/components/common/filter-card";
import { kindCount, kindOne, Marked, SEARCH_ICON } from "@/components/shell/search-bits";

export const metadata = { title: "Search" };

/** On "All", the first few of each kind; one kind's tab shows up to this many. */
const FIRST = 5;
const MOST = 50;

/**
 * Search (design "search everything", board LSearchAll): every result for some words, a tab per kind with how
 * many there are, each result with what it is, a line about it and where it stands. Only what this person may
 * see is found. The address keeps the words and the tab, so Back returns to them. A number typed whole is
 * offered at the top to open.
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const kind = (SEARCH_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as SearchKind) : undefined;
  const asked = q.length >= 2;
  const [counts, found] = asked
    ? await Promise.all([api.get<SearchResult>("/search", { q, limit: 0 }), api.get<SearchResult>("/search", { q, kind, limit: kind ? MOST : FIRST })])
    : [null, null];
  const total = counts?.groups.reduce((t, g) => t + g.total, 0) ?? 0;
  const countFor = (k: SearchKind) => counts?.groups.find((g) => g.kind === k)?.total ?? 0;
  const tab = (k?: SearchKind) => buildHref("/search", { q }, { kind: k });

  return (
    <>
      <PageHeader
        kind="list"
        crumbs={[{ label: "Search" }]}
        title="Search"
        summary={asked ? `${countOf(total, "result")} for “${q}” · everything you may see` : "Customers, suppliers, inquiries, quotations, orders, purchase orders and payments"}
      />
      <FilterCard search="Search everything: names, numbers, phones…" value={q} keep={{ kind }} count={asked ? countOf(kind ? countFor(kind) : total, "result") : undefined} />
      {asked && (
        <LinkTabs
          label="Which kind"
          className="mb-4"
          tabs={[
            { href: tab(undefined), label: "All", count: total, active: !kind },
            ...SEARCH_KINDS.filter((k) => countFor(k) > 0 || k === kind).map((k) => ({ href: tab(k), label: SEARCH_KIND_LABEL[k], count: countFor(k), active: k === kind })),
          ]}
        />
      )}
      {counts?.exact && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">{counts.exact.label}</span> <span className="text-text-2">· {kindOne(counts.exact.kind)}</span>
          </span>
          <ButtonLink href={counts.exact.href} size="sm" variant="strong">
            Open it <ArrowRight aria-hidden />
          </ButtonLink>
        </Card>
      )}
      {!asked ? (
        <Card className="p-0">
          <EmptyState
            framed
            title="Search everything"
            description="Type a name, a number (RFQ-, SO-, QUO-, PO-, PR-, RC-…), a contact, a phone or a reference. The box at the top of every page does the same: press / to start."
          />
        </Card>
      ) : !found || found.groups.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            framed
            title={`Nothing found for “${q}”`}
            description="Try a part of a name, a number or a phone. Only what you may see is found."
            action={
              kind ? (
                <ButtonLink href={tab(undefined)} size="sm">
                  Search every kind
                </ButtonLink>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="flex max-w-[960px] flex-col gap-4">
          {found.groups.map((g) => (
            <Card key={g.kind} className="overflow-clip p-0">
              <section aria-label={SEARCH_KIND_LABEL[g.kind]}>
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
                  <h2 className="text-md font-semibold tracking-wide text-text-2 uppercase">
                    {SEARCH_KIND_LABEL[g.kind]} · {g.total}
                  </h2>
                  {!kind && (
                    <Link href={tab(g.kind)} className="inline-flex min-h-8 items-center text-md font-medium text-primary hover:underline">
                      {g.total > g.items.length ? `See all ${kindCount(g.kind, g.total)}` : `Only ${SEARCH_KIND_LABEL[g.kind].toLowerCase()}`}
                    </Link>
                  )}
                </div>
                <ul aria-label={SEARCH_KIND_LABEL[g.kind]}>
                  {g.items.map((x) => (
                    <ResultRow key={x.href} x={x} q={q} />
                  ))}
                </ul>
                {kind && g.total > g.items.length && (
                  <p className="border-t border-line px-4 py-2.5 text-md text-text-2 sm:px-5">
                    The first {g.items.length} of {g.total}: add words to narrow it.
                  </p>
                )}
              </section>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function ResultRow({ x, q }: { x: SearchItem; q: string }) {
  const Icon = SEARCH_ICON[x.kind];
  return (
    <li className="border-t border-line first:border-t-0">
      <Link href={x.href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60 sm:px-5">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-text-2">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-text">
            <Marked text={x.title} q={q} />
          </span>
          <span className="block truncate text-md text-text-2">
            <Marked text={x.sub} q={q} />
          </span>
        </span>
        {x.badge && (
          <Badge tone={x.badge.tone} className="shrink-0">
            {x.badge.label}
          </Badge>
        )}
      </Link>
    </li>
  );
}
