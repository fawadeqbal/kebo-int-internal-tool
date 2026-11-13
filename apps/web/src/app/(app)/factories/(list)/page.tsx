import Link from "next/link";
import { Clock, Download, Factory, Plus, ShoppingCart, TrendingUp, X } from "lucide-react";
import { can } from "@kebo/shared";
import {
  RefCode,
  buildHref,
  ButtonLink,
  Card,
  DataRow,
  EmptyState,
  PageHeader,
  Pager,
  PhoneList,
  PhoneRow,
  StatRow,
  StatTile,
  StatusBadge,
  Td,
  Th,
  THead,
  toPage,
} from "@kebo/ui";
import { api } from "@/lib/api";
import { PartyExcel } from "@/components/sheets/party-excel";
import { DataTable } from "@/components/common/data-table";
import { FilterCard } from "@/components/common/filter-card";
import { OpenPanelButton } from "@/components/common/panel";
import { importFactoriesAction, saveFactoryAction } from "../actions";
import { FactoryPanel } from "../factory-form";
import { hasFeature, requirePermission } from "@/lib/session";
import type { Paged } from "@/lib/types";
import type { FactoryGroups } from "@/lib/types-facts";
import type { FactoryDetail, FactoryRow, Owed } from "@/lib/types-people";
import { crumbsFor, labelFor } from "@/lib/nav";
import { plural, short, whole } from "@/lib/format";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Suppliers" };

type Params = Record<string, string | undefined>;
type List = Paged<FactoryRow & { city: string | null }> & { cities: string[]; waiting: number };

/** How to reach them, in a few words: "Mr. Zhang · WeChat zhang_jpm". */
const reach = (f: FactoryRow) => [f.contactPerson, f.wechat ? `WeChat ${f.wechat}` : (f.email ?? f.phone)].filter(Boolean).join(" · ");

const STATUSES = [
  { value: "offers", label: "Offers in" },
  { value: "none", label: "No offers yet" },
];

/**
 * Suppliers (board "Suppliers — list"): Export CSV and Add supplier; Suppliers, We owe, Bought this year and
 * Offers waiting; search with City, Owner and Status; each factory with its city, who looks after it, orders,
 * offers, what we bought from it, what we owe it and where things stand. Never shown to customers.
 */
export default async function FactoriesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const status = STATUSES.find((x) => x.value === sp.status)?.value;
  const keep = { q: sp.q, city: sp.city || undefined, owner: sp.owner || undefined, status };
  const query = { q: sp.q?.trim() || undefined, city: keep.city, owner: keep.owner === "me" ? me.id : keep.owner, status };
  const panel = sp.panel === "new-factory" || (sp.panel === "edit-factory" && sp.id) ? sp.panel : undefined;
  const money = can(me, "expenses.manage") && can(me, "reports.view") && (await hasFeature("insights"));
  const year = new Date().getFullYear();
  const [data, all, mine, people, editing, owed, groups, thisYear, lastYear] = await Promise.all([
    api.get<List>("/factories", { ...query, page: toPage(sp.page) }),
    api.get<List>("/factories", { pageSize: 1 }),
    api.get<List>("/factories", { pageSize: 1, mine: "true" }),
    getPeople().catch(() => []),
    panel === "edit-factory" ? api.get<FactoryDetail>(`/factories/${sp.id}`).catch(() => null) : null,
    // What we owe each factory and what we bought from it (people who see money, with Insights).
    money ? api.get<Owed>("/insights/facts/owed", { side: "payable" }).catch(() => null) : null,
    money ? api.get<FactoryGroups>("/insights/facts/factories/groups", { period: "all", by: "factory" }).catch(() => null) : null,
    money
      ? api
          .get<FactoryGroups>("/insights/facts/factories/groups", {
            period: "all",
            by: "factory",
            from: `${year}-01-01`,
            to: `${year}-12-31`,
          })
          .catch(() => null)
      : null,
    money
      ? api
          .get<FactoryGroups>("/insights/facts/factories/groups", {
            period: "all",
            by: "factory",
            from: `${year - 1}-01-01`,
            to: `${year - 1}-12-31`,
          })
          .catch(() => null)
      : null,
  ]);
  const owes = new Map((owed?.rows ?? []).map((r) => [r.partyId, r]));
  const bought = new Map((groups?.rows ?? []).map((r) => [r.key, r]));
  const owedTotal = (owed?.rows ?? []).reduce((t, r) => t + Number(r.total), 0);
  const overdueTotal = (owed?.rows ?? []).reduce((t, r) => t + Number(r.overdue), 0);
  const spend = (g: FactoryGroups | null) => (g?.rows ?? []).reduce((t, r) => t + Number(r.spend ?? 0), 0);
  const boughtYear = spend(thisYear);
  const boughtLast = spend(lastYear);
  const filtered = !!(sp.q || keep.city || keep.owner || status);
  const people_ = people.map((p) => ({ value: p.id, label: p.id === me.id ? "Me" : p.name }));

  /** Where things stand with the factory, in a word. */
  const stateOf = (f: FactoryRow) => {
    const o = owes.get(f.id);
    if (o && Number(o.overdue) > 0.005) return <StatusBadge meaning="bad">Payment late</StatusBadge>;
    if (o) return <StatusBadge meaning="warn">To pay</StatusBadge>;
    if (f._count.quotes > 0) return <StatusBadge meaning="ok">Offers in</StatusBadge>;
    return <StatusBadge meaning="neutral">No offers yet</StatusBadge>;
  };

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/factories")}
        icon={Factory}
        title={labelFor("/factories")}
        summary="Factories you buy from"
        papers={
          <>
            <PartyExcel kind="factories" importAction={importFactoriesAction} />
            <ButtonLink href={buildHref("/sheets/export/factories", {}, { ...query, format: "csv" })} prefetch={false}>
              <Download aria-hidden /> Export CSV
            </ButtonLink>
          </>
        }
        primary={
          <OpenPanelButton panel="new-factory" variant="primary" label="Add supplier">
            <Plus aria-hidden /> <span className="sm:hidden">Add</span>
            <span className="max-sm:hidden">Add supplier</span>
          </OpenPanelButton>
        }
      />

      <StatRow className="mb-4">
        <StatTile
          icon={Factory}
          iconColor={1}
          label="Suppliers"
          value={all.total}
          sub={mine.total ? `${mine.total} looked after by you` : "nobody's yet"}
          href={mine.total ? "/factories?owner=me" : undefined}
        />
        {owed && (
          <StatTile
            icon={ShoppingCart}
            iconColor={2}
            label="We owe"
            value={short(owedTotal, owed.currency)}
            tone={overdueTotal > 0.005 ? "bad" : undefined}
            sub={
              overdueTotal > 0.005
                ? `${short(overdueTotal, owed.currency)} past its date`
                : `to ${plural(owed.rows.length, "factory", "factories")}`
            }
            href="/money/due?side=suppliers"
          />
        )}
        {thisYear && (
          <StatTile
            icon={TrendingUp}
            iconColor={3}
            label="Bought this year"
            value={short(boughtYear, thisYear.currency)}
            sub={
              boughtLast > 0
                ? `${boughtYear >= boughtLast ? "▲" : "▼"} ${Math.abs(Math.round(((boughtYear - boughtLast) / boughtLast) * 100))}%`
                : `${year}`
            }
          />
        )}
        <StatTile icon={Clock} iconColor={4} label="Offers waiting" value={data.waiting} sub="asked for prices, no answer yet" />
      </StatRow>

      <FilterCard
        search="Search factory, person, WeChat…"
        value={sp.q}
        clearHref={buildHref("/factories", keep, { q: undefined })}
        selects={[
          { name: "city", label: "City", value: keep.city, options: data.cities.map((c) => ({ value: c, label: c })) },
          { name: "owner", label: "Owner", value: keep.owner, options: [{ value: "none", label: "Nobody yet" }, ...people_] },
          { name: "status", label: "Status", value: status, options: STATUSES },
        ]}
      />

      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          <EmptyState
            icon={Factory}
            title={filtered ? "No suppliers match" : "No suppliers yet"}
            description={
              filtered
                ? "Try another name or filter, or clear the filters."
                : "Add the factories you buy from: their offers, orders and what we owe them show here."
            }
            action={
              filtered ? (
                <ButtonLink href="/factories">
                  <X aria-hidden /> Clear filters
                </ButtonLink>
              ) : (
                <OpenPanelButton panel="new-factory">
                  <Plus aria-hidden /> Add the first supplier
                </OpenPanelButton>
              )
            }
          />
        ) : (
          <>
            <PhoneList label="Suppliers">
              {data.rows.map((f) => (
                <PhoneRow
                  key={f.id}
                  href={`/factories/${f.id}`}
                  flash={sp.saved === f.id}
                  title={f.name}
                  line={[f.city, f.owner?.name, plural(f._count.quotes, "offer")].filter(Boolean).join(" · ")}
                  status={stateOf(f)}
                  figure={owed && owes.has(f.id) ? whole(owes.get(f.id)!.total, owed.currency) : undefined}
                />
              ))}
            </PhoneList>
            <DataTable label="Suppliers" clearParam="saved" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Code</Th>
                  <Th>Supplier</Th>
                  <Th>City</Th>
                  <Th>Owner</Th>
                  {groups && <Th className="text-right">Orders</Th>}
                  <Th className="text-right">Offers</Th>
                  {groups && <Th className="text-right">Bought</Th>}
                  {owed && <Th className="text-right">We owe</Th>}
                  <Th>Now</Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((f) => {
                  const g = bought.get(f.id);
                  return (
                    <DataRow key={f.id} href={`/factories/${f.id}`} flash={sp.saved === f.id}>
                      <Td>{f.supplierCode ? <RefCode>{f.supplierCode}</RefCode> : "—"}</Td>
                      <Td>
                        <Link href={`/factories/${f.id}`} className="font-semibold hover:text-primary">
                          {f.name}
                        </Link>
                        <span className="block text-xs text-text-2">{reach(f) || "No contact details"}</span>
                      </Td>
                      <Td>{f.city ?? "—"}</Td>
                      <Td>{f.owner?.name ?? "—"}</Td>
                      {groups && <Td className="text-right tabular">{g?.orders ?? 0}</Td>}
                      <Td className="text-right tabular">{f._count.quotes}</Td>
                      {groups && (
                        <Td className="text-right whitespace-nowrap tabular">
                          {g && Number(g.spend) > 0 ? whole(g.spend, groups.currency) : "—"}
                        </Td>
                      )}
                      {owed && (
                        <Td className="text-right font-bold whitespace-nowrap tabular">
                          {owes.has(f.id) ? whole(owes.get(f.id)!.total, owed.currency) : <span className="font-normal">—</span>}
                        </Td>
                      )}
                      <Td>{stateOf(f)}</Td>
                    </DataRow>
                  );
                })}
              </tbody>
            </DataTable>
          </>
        )}
      </Card>
      <Pager base="/factories" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} bare />

      {panel && (panel === "new-factory" || editing) && (
        <FactoryPanel
          key={editing?.id ?? "new"}
          action={saveFactoryAction.bind(null, editing?.id ?? null)}
          factory={editing}
          people={people}
          meId={me.id}
        />
      )}
    </div>
  );
}
