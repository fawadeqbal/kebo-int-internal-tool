import Link from "next/link";
import { Factory as FactoryIcon } from "lucide-react";
import {
  buildHref,
  ButtonLink,
  Card,
  EmptyState,
  FilterBar,
  LinkTabs,
  PageHeader,
  Pagination,
  SearchField,
  Table,
  Td,
  Th,
  THead,
  toPage,
  Tr,
} from "@kebo/ui";
import { api } from "@/lib/api";
import { PartyExcel } from "@/components/sheets/party-excel";
import { importFactoriesAction } from "./actions";
import { requirePermission } from "@/lib/session";
import type { Paged } from "@/lib/types";
import type { FactoryRow } from "@/lib/types-people";

export const metadata = { title: "Factories" };

/** The suppliers the team buys from, who looks after each, and how many price quotes each has. ?mine=1: the ones I look after. */
export default async function FactoriesPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; mine?: string }> }) {
  await requirePermission("sourcing.manage");
  const sp = await searchParams;
  const mine = sp.mine === "1";
  const data = await api.get<Paged<FactoryRow>>("/factories", { q: sp.q, page: toPage(sp.page), mine: mine ? "true" : undefined });
  const keep = { q: sp.q, mine: mine ? "1" : undefined };
  return (
    <div>
      <PageHeader
        title="Factories"
        description="The suppliers we source from. Prices and costs here are never shown to customers."
        actions={
          <>
            <PartyExcel kind="factories" importAction={importFactoriesAction} />
            <ButtonLink href="/factories/new" variant="primary">
              New factory
            </ButtonLink>
          </>
        }
      />
      <LinkTabs
        label="Which factories"
        className="mb-4"
        tabs={[
          { href: buildHref("/factories", keep, { mine: undefined, page: undefined }), label: "All factories", active: !mine },
          { href: buildHref("/factories", keep, { mine: "1", page: undefined }), label: "My factories", active: mine },
        ]}
      />
      <Card className="overflow-hidden p-0">
        <FilterBar>
          <form className="flex flex-1 flex-wrap items-center gap-2">
            {mine && <input type="hidden" name="mine" value="1" />}
            <SearchField
              defaultValue={sp.q}
              placeholder="Search factory or contact person…"
              clearHref={mine ? "/factories?mine=1" : "/factories"}
              className="min-w-56 flex-1 sm:max-w-80"
            />
          </form>
        </FilterBar>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={FactoryIcon}
            title={sp.q ? `No factory matches "${sp.q}"` : mine ? "No factories are yours yet" : "No factories yet"}
            description={
              sp.q
                ? "Try part of the name, or add it as a new factory."
                : mine
                  ? "Choose “Looked after by” on a factory to make it yours."
                  : "Factories are added here, or when you record a factory's prices on a deal."
            }
            action={<ButtonLink href="/factories/new">New factory</ButtonLink>}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Factory</Th>
                <Th>Contact</Th>
                <Th>Looked after by</Th>
                <Th className="text-right">Price quotes</Th>
              </tr>
            </THead>
            <tbody>
              {data.rows.map((f) => (
                <Tr key={f.id} className="hover:bg-surface-2/50">
                  <Td>
                    <Link href={`/factories/${f.id}`} className="font-medium hover:text-primary">
                      {f.name}
                    </Link>
                    {f.address && <span className="block max-w-72 truncate text-xs text-muted">{f.address}</span>}
                  </Td>
                  <Td>
                    {f.contactPerson || f.phone || f.wechat || f.email ? (
                      <>
                        <span className="block text-sm">{f.contactPerson ?? "—"}</span>
                        <span className="block max-w-60 truncate text-xs text-muted">
                          {[f.phone, f.wechat && `WeChat ${f.wechat}`, f.email].filter(Boolean).join(" · ")}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted">No contact details</span>
                    )}
                  </Td>
                  <Td className="text-sm">{f.owner?.name ?? <span className="text-xs text-muted">Nobody yet</span>}</Td>
                  <Td className="text-right tabular">{f._count.quotes || <span className="text-muted">0</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {data.total > data.pageSize && (
          <Pagination base="/factories" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} />
        )}
      </Card>
    </div>
  );
}
