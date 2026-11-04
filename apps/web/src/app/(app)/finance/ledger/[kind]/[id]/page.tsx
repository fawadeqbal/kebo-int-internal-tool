import Link from "next/link";
import { notFound } from "next/navigation";
import type { LedgerPartyKind } from "@kebo/shared";
import { buildHref, Card, cn, DataRow, EmptyState, FilterChip, PageHeader, Segmented, Td, Th, THead } from "@kebo/ui";
import { todayIn } from "@kebo/utils";
import { api } from "@/lib/api";
import { load, requirePermission } from "@/lib/session";
import { money } from "@/lib/format";
import { countryName } from "@/lib/countries";
import { ExportLink } from "@/components/sheets/export-link";
import { DataTable } from "@/components/common/data-table";
import { EntryPanel } from "@/components/ledger/entry-panel";
import { EntryBody } from "@/components/ledger/entry-body";
import { StatementButtons } from "@/components/ledger/statement-buttons";
import { AgeingTiles, day, LedgerFilters, PARTY_PATH, periodOf, span, TypeBadge } from "@/components/ledger/ledger-parts";
import type { LedgerEntry, LedgerParty } from "@/lib/types-ledger";
import { TZ } from "../../../sections";

const KIND: Record<string, LedgerPartyKind> = { customers: "customer", factories: "factory", staff: "staff" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Search = { period?: string; from?: string; to?: string; open?: string; removed?: string; cur?: string; panel?: string; id?: string };

export async function generateMetadata({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!KIND[kind] || !UUID.test(id)) return { title: "Ledger" };
  const p = await api.get<LedgerParty>(`/ledger/parties/${KIND[kind]}/${id}`).catch(() => null);
  return { title: p ? `${p.party.name} · Ledger` : "Ledger" };
}

/**
 * One customer's, factory's or person's ledger (approved page 34): what they owe us or we owe them, by how late,
 * then every entry between two days with the balance after it, opening and closing. "Only open items" hides the
 * orders already settled. The statement prints and shares from here.
 */
export default async function PartyLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<Search>;
}) {
  await requirePermission("ledger.view");
  const [{ kind: path, id }, sp] = await Promise.all([params, searchParams]);
  const kind = KIND[path];
  if (!kind || !UUID.test(id)) notFound();
  const today = todayIn(TZ);
  const period = periodOf(sp, today);
  const open = sp.open === "1";
  const p = await load(() =>
    api.get<LedgerParty>(`/ledger/parties/${kind}/${id}`, {
      from: period.from,
      to: period.to,
      onlyOpen: open ? "true" : undefined,
      removed: sp.removed === "1" ? "true" : undefined,
    }),
  );
  const base = `/finance/ledger/${path}/${id}`;
  const all = sp as Record<string, string | undefined>;
  const entry =
    sp.panel === "entry" && sp.id && UUID.test(sp.id) ? await api.get<LedgerEntry>(`/ledger/entries/${sp.id}`).catch(() => null) : null;
  const main = p.mainCurrency;
  const rows = sp.cur ? p.rows.filter((r) => r.currency === sp.cur) : p.rows;
  const currencies = p.currencies.filter((c) => !sp.cur || c.currency === sp.cur);
  const single = currencies.length === 1 ? currencies[0]!.currency : null;
  const plural = kind === "customer" ? "Customers" : kind === "factory" ? "Factories" : "Staff";
  const closing = p.currencies.filter((c) => Number(c.closing) !== 0).map((c) => money(c.closing, c.currency));
  const summary = [
    kind === "customer" ? "customer" : kind === "factory" ? "factory" : "staff (to repay)",
    p.party.country ? countryName(p.party.country) : null,
    `${kind === "customer" ? "owes us" : "we owe"} ${closing.join(" + ") || money(0, single ?? main)}`,
    kind === "customer"
      ? `credit we hold ${p.credit.map((c) => money(c.amount, c.currency)).join(" + ") || money(0, single ?? main)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const head =
    kind === "customer"
      ? { debit: "They owe (debit)", credit: "Paid (credit)" }
      : kind === "factory"
        ? { debit: "Paid / taken off (debit)", credit: "Ordered (credit)" }
        : { debit: "Repaid (debit)", credit: "Paid from own money (credit)" };
  const openEntry = (groupId: string) => buildHref(base, all, { panel: "entry", id: groupId });
  const cell = (v: string, cur: string) =>
    Number(v) ? (single ? Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 }) : money(v, cur)) : "";
  const bal = (v: string, cur: string) => (single ? Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 }) : money(v, cur));

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: "Finance" },
          { label: "Ledger", href: "/finance/ledger" },
          { label: plural, href: `/finance/ledger?view=${PARTY_PATH[kind]}` },
          { label: p.party.name },
        ]}
        title={p.party.name}
        summary={summary}
        phoneStack
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportLink
              what="ledger-party"
              query={{ kind, id, from: period.from, to: period.to, open: open ? "1" : undefined }}
              className="border-transparent bg-transparent shadow-none"
            />
            <StatementButtons kind={kind} id={id} from={period.from} to={period.to} cur={sp.cur ?? single ?? undefined} back={base} />
          </div>
        }
      />
      <Segmented
        label="Ledger views"
        className="mb-3"
        options={[
          { key: "all", label: "All entries" },
          { key: "accounts", label: "By account" },
          { key: "customers", label: "Customers" },
          { key: "factories", label: "Factories" },
          { key: "staff", label: "Staff" },
          { key: "orders", label: "Orders" },
        ].map((v) => ({
          href: buildHref("/finance/ledger", {}, { view: v.key === "all" ? undefined : v.key }),
          label: v.label,
          active: v.key === PARTY_PATH[kind],
        }))}
      />
      <LedgerFilters
        path={base}
        sp={all}
        period={period}
        keep={{ open: open ? "1" : undefined }}
        types={false}
        removedChip={false}
        end={
          <span className="flex items-center gap-2">
            <FilterChip href={`/finance/ledger?view=${PARTY_PATH[kind]}`} active pill>
              {p.party.name}
            </FilterChip>
            <FilterChip href={buildHref(base, all, { open: open ? undefined : "1", panel: undefined, id: undefined })} active={open} pill>
              Only open items
            </FilterChip>
          </span>
        }
      />
      <div className="mb-4">
        <AgeingTiles
          buckets={p.ageing.buckets}
          currency={main}
          label={kind === "customer" ? "What they owe, by how late" : "What we owe, by how late"}
        />
      </div>
      <Card className="overflow-clip p-0">
        {rows.length === 0 && currencies.every((c) => Number(c.opening) === 0) ? (
          <EmptyState
            framed
            title={`Nothing in ${span(period.from, period.to)}`}
            description="Try a longer period: the opening balance carries what came before."
          />
        ) : (
          <DataTable label={`${p.party.name}: ledger`}>
            <THead>
              <tr>
                <Th>Day</Th>
                <Th>What</Th>
                <Th>Type</Th>
                <Th className="text-right">{head.debit}</Th>
                <Th className="text-right">{head.credit}</Th>
                <Th className="text-right">Balance{single ? ` (${single})` : ""}</Th>
              </tr>
            </THead>
            <tbody>
              {currencies.map((c) => (
                <tr key={`o-${c.currency}`} className="border-b border-line">
                  <Td />
                  <Td className="text-text-2">
                    Opening balance on {day(period.from, today)}
                    {!single && ` · ${c.currency}`}
                  </Td>
                  <Td />
                  <Td />
                  <Td />
                  <Td className="text-right font-semibold tabular">{bal(c.opening, c.currency)}</Td>
                </tr>
              ))}
              {rows.map((r) => (
                <DataRow key={r.id} href={openEntry(r.groupId)} className={cn(r.removed && "text-muted")}>
                  <Td className="whitespace-nowrap tabular">{day(r.date, today)}</Td>
                  <Td className="min-w-56">
                    <Link href={openEntry(r.groupId)} scroll={false} className={cn("hover:text-primary", r.removed && "line-through")}>
                      {r.memo || r.accountLabel}
                    </Link>
                    <span className="block text-xs text-muted tabular">
                      {[
                        r.memo.includes(r.ref) ? null : r.ref,
                        r.order && !r.ref.includes(r.order.refNo) && !r.memo.includes(r.order.refNo) ? r.order.refNo : null,
                        r.reason,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </Td>
                  <Td>
                    <TypeBadge type={r.type} />
                  </Td>
                  <Td className="text-right whitespace-nowrap tabular">{cell(r.debit, r.currency)}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{cell(r.credit, r.currency)}</Td>
                  <Td className="text-right whitespace-nowrap tabular">{bal(r.balance, r.currency)}</Td>
                </DataRow>
              ))}
              {currencies.map((c) => (
                <tr key={`c-${c.currency}`} className="bg-surface-2/40">
                  <Td />
                  <Td className="font-medium">
                    Closing balance on {day(period.to, today)}
                    {!single && ` · ${c.currency}`}
                  </Td>
                  <Td />
                  <Td className="text-right font-semibold tabular">
                    {single ? Number(p.totals.debit).toLocaleString("en-US", { minimumFractionDigits: 2 }) : ""}
                  </Td>
                  <Td className="text-right font-semibold tabular">
                    {single ? Number(p.totals.credit).toLocaleString("en-US", { minimumFractionDigits: 2 }) : ""}
                  </Td>
                  <Td className="text-right font-semibold tabular">{bal(c.closing, c.currency)}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
      <p className="mt-2 px-1 text-xs text-muted">
        {kind === "customer" ? "Balance: what they owe us." : "Balance: what we owe them."} In {main}: {money(p.closing.base, main)} at each
        entry&rsquo;s rate.
        {sp.removed === "1" ? " Removed entries and their reversals are shown." : ""}{" "}
        <Link href={buildHref(base, all, { removed: sp.removed === "1" ? undefined : "1" })} className="underline">
          {sp.removed === "1" ? "Hide removed" : "Show removed"}
        </Link>
      </p>
      {entry && (
        <EntryPanel
          title={`${entry.ref || `Entry ${entry.entryNo}`} · ${entry.typeLabel}`}
          description={`posted ${entry.date} from ${entry.source.label || "its document"}`}
        >
          <EntryBody e={entry} main={main} back={base} />
        </EntryPanel>
      )}
    </div>
  );
}
