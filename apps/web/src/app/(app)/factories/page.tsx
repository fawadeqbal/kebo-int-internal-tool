import Link from "next/link";
import { can } from "@kebo/shared";
import { buildHref, ButtonLink, Card, DataRow, EmptyState, ListToolbar, PageHeader, Pager, PhoneList, PhoneRow, StatRow, StatTile, StatusBadge, Td, Th, THead, toPage } from "@kebo/ui";
import { Factory, Plus, Tag, UserRound, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { PartyExcel } from "@/components/sheets/party-excel";
import { DataTable } from "@/components/common/data-table";
import { RowMenu, type MenuEntry } from "@/components/common/more-menu";
import { OpenPanelButton } from "@/components/common/panel";
import { importFactoriesAction, removeFactoryAction, saveFactoryAction } from "./actions";
import { FactoryPanel } from "./factory-form";
import { hasFeature, requirePermission } from "@/lib/session";
import type { Paged } from "@/lib/types";
import type { FactoryDetail, FactoryRow, Owed } from "@/lib/types-people";
import { crumbsFor, labelFor } from "@/lib/nav";
import { money, plural } from "@/lib/format";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Suppliers" };

type Params = Record<string, string | undefined>;

/** How to reach them, in a few words. */
const reach = (f: FactoryRow) => [f.phone, f.wechat && `WeChat ${f.wechat}`, f.email].filter(Boolean).join(" · ");

/**
 * Factories (design system: List frame): the suppliers the team buys from,
 * who looks after each and how many price quotes each has. New factory is the
 * one primary (in the side panel, ?panel=new-factory; Edit is ?panel=edit-factory&id=…); search, All / Mine chips with counts and
 * Excel in one row; rows open the factory, ⋯ at the end; 25 a page. ?mine=1:
 * the ones I look after. Prices and costs here are never shown to customers.
 */
export default async function FactoriesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const mine = sp.mine === "1";
  const keep = { q: sp.q, mine: mine ? "1" : undefined };
  const href = (patch: Params) => buildHref("/factories", keep, { page: undefined, ...patch });
  const panel = sp.panel === "new-factory" || (sp.panel === "edit-factory" && sp.id) ? sp.panel : undefined;
  const [data, other, people, editing] = await Promise.all([
    api.get<Paged<FactoryRow>>("/factories", { q: sp.q, page: toPage(sp.page), mine: mine ? "true" : undefined }),
    // The other chip's count (for the same search).
    api.get<Paged<FactoryRow>>("/factories", { q: sp.q, pageSize: 1, mine: mine ? undefined : "true" }),
    panel ? getPeople() : null,
    panel === "edit-factory" ? api.get<FactoryDetail>(`/factories/${sp.id}`).catch(() => null) : null,
  ]);
  // What we owe each factory (people who see money, with Insights): the "We owe" column and figure.
  const owed =
    can(me, "expenses.manage") && can(me, "reports.view") && (await hasFeature("insights"))
      ? await api.get<Owed>("/insights/facts/owed", { side: "payable" }).catch(() => null)
      : null;
  const owes = new Map((owed?.rows ?? []).map((r) => [r.partyId, r]));
  const owedTotal = (owed?.rows ?? []).reduce((t, r) => t + Number(r.total), 0);
  const overdueTotal = (owed?.rows ?? []).reduce((t, r) => t + Number(r.overdue), 0);
  const all = mine ? other.total : data.total;
  const mineCount = mine ? data.total : other.total;
  const canRemove = can(me, "inquiries.updateAny");

  const rowMenu = (f: FactoryRow): MenuEntry[] => [
    { label: "Open", href: `/factories/${f.id}` },
    { label: "Edit", panel: "edit-factory", id: f.id },
    { label: "Copy link", copy: `/factories/${f.id}` },
    ...(canRemove
      ? [
          { separator: true as const },
          {
            label: "Remove…",
            danger: true as const,
            confirm: { title: `Remove ${f.name}?`, body: "It will no longer appear in lists and pickers. Its past prices stay on their inquiries.", confirmLabel: "Remove" },
            action: removeFactoryAction.bind(null, f.id),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        crumbs={crumbsFor("/factories")}
        icon={Factory}
        title={labelFor("/factories")}
        summary={
          <>
            {plural(all, "factory", "factories")}
            {mineCount > 0 && ` · ${mineCount} looked after by you`}
            <span className="max-sm:hidden"> · prices and costs here are never shown to customers</span>
          </>
        }
        primary={
          <OpenPanelButton panel="new-factory" variant="primary" label="New factory">
            <Plus aria-hidden /> <span className="sm:hidden">New</span>
            <span className="max-sm:hidden">New factory</span>
          </OpenPanelButton>
        }
      />

      <StatRow className="mb-4">
        <StatTile icon={Factory} iconColor={1} label="Suppliers" value={all} sub={mineCount ? `${mineCount} looked after by you` : "nobody's yet"} />
        {owed && (
          <StatTile
            icon={Wallet}
            iconColor={2}
            label="We owe"
            value={money(owedTotal, owed.currency)}
            tone={overdueTotal > 0.005 ? "bad" : undefined}
            sub={overdueTotal > 0.005 ? `${money(overdueTotal, owed.currency)} past its date` : `to ${plural(owed.rows.length, "factory", "factories")}`}
            href="/purchasing/to-pay"
          />
        )}
        <StatTile icon={Tag} iconColor={4} label="Price offers" value={data.rows.reduce((t, f) => t + f._count.quotes, 0)} sub={data.total > data.rows.length ? "on this page" : "from these factories"} />
        <StatTile icon={UserRound} iconColor={3} label="Mine" value={mineCount} sub="factories you look after" href={href({ mine: "1" })} />
      </StatRow>

      <ListToolbar
        search={{ placeholder: "Search factory or contact person…", value: sp.q, clearHref: href({ q: undefined }) }}
        keep={keep}
        chips={[
          { key: "all", label: "All", count: all, href: href({ mine: undefined }), active: !mine },
          { key: "mine", label: "Mine", count: mineCount, href: href({ mine: "1" }), active: mine },
        ]}
        label="Filter factories"
        end={<PartyExcel kind="factories" importAction={importFactoriesAction} exportHref={buildHref("/sheets/export/factories", {}, keep)} />}
      />

      <Card className="overflow-clip p-0">
        {data.rows.length === 0 ? (
          all === 0 && !sp.q ? (
            <EmptyState
              framed
              title="No factories yet"
              description="The suppliers you buy from show here, with who looks after each. They are added here, or when you record a factory's prices on an inquiry."
              action={
                <OpenPanelButton panel="new-factory" size="sm">
                  <Plus aria-hidden /> Add the first factory
                </OpenPanelButton>
              }
            />
          ) : (
            <EmptyState
              framed
              title={mine && !sp.q ? "No factories are yours yet" : "No factories match these filters"}
              description={mine && !sp.q ? "Choose “Looked after by” on a factory to make it yours." : "Try part of the name or the contact, or clear the filters."}
              action={
                <ButtonLink href="/factories" size="sm">
                  {mine && !sp.q ? "All factories" : "Clear filters"}
                </ButtonLink>
              }
            />
          )
        ) : (
          <>
            <PhoneList label="Factories">
              {data.rows.map((f) => (
                <PhoneRow
                  key={f.id}
                  href={`/factories/${f.id}`}
                  flash={sp.saved === f.id}
                  title={f.name}
                  line={`${f.contactPerson ?? "No contact person"} · ${f.owner ? `looked after by ${f.owner.name}` : "nobody looks after it yet"}`}
                  figure={plural(f._count.quotes, "quote")}
                />
              ))}
            </PhoneList>
            <DataTable label="Factories" clearParam="saved" className="max-sm:hidden">
              <THead>
                <tr>
                  <Th>Factory</Th>
                  <Th>Contact</Th>
                  <Th>Looked after by</Th>
                  <Th className="text-right">Price offers</Th>
                  {owed && <Th className="text-right">We owe</Th>}
                  <Th>Status</Th>
                  <Th className="w-12">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </THead>
              <tbody>
                {data.rows.map((f) => (
                  <DataRow key={f.id} href={`/factories/${f.id}`} flash={sp.saved === f.id}>
                    <Td>
                      <Link href={`/factories/${f.id}`} className="font-semibold hover:text-primary">
                        {f.name}
                      </Link>
                      {f.address && <span className="block max-w-72 truncate text-xs text-text-2">{f.address}</span>}
                    </Td>
                    <Td>
                      {f.contactPerson || reach(f) ? (
                        <>
                          <span className="block text-sm">{f.contactPerson ?? "—"}</span>
                          <span className="block max-w-60 truncate text-xs text-text-2">{reach(f)}</span>
                        </>
                      ) : (
                        <span className="text-xs text-text-2">No contact details</span>
                      )}
                    </Td>
                    <Td className="text-sm">{f.owner?.name ?? <span className="text-xs text-text-2">Nobody yet</span>}</Td>
                    <Td className="text-right tabular">{f._count.quotes || <span className="text-muted">0</span>}</Td>
                    {owed && (
                      <Td className="text-right font-semibold tabular">
                        {owes.has(f.id) ? money(owes.get(f.id)!.total, owed.currency) : <span className="font-normal text-muted">—</span>}
                      </Td>
                    )}
                    <Td>
                      {owes.has(f.id) ? (
                        Number(owes.get(f.id)!.overdue) > 0.005 ? (
                          <StatusBadge meaning="bad">Payment late</StatusBadge>
                        ) : (
                          <StatusBadge meaning="warn">To pay</StatusBadge>
                        )
                      ) : f._count.quotes > 0 ? (
                        <StatusBadge meaning="ok">Offers in</StatusBadge>
                      ) : (
                        <StatusBadge meaning="neutral">No offers yet</StatusBadge>
                      )}
                    </Td>
                    <Td className="text-right">
                      <RowMenu items={rowMenu(f)} label={`Actions for ${f.name}`} />
                    </Td>
                  </DataRow>
                ))}
              </tbody>
            </DataTable>
          </>
        )}
        <Pager base="/factories" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>

      {people && (panel === "new-factory" || editing) && (
        <FactoryPanel key={editing?.id ?? "new"} action={saveFactoryAction.bind(null, editing?.id ?? null)} factory={editing} people={people} meId={me.id} />
      )}
    </div>
  );
}
