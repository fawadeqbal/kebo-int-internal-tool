import Link from "next/link";
import { ChevronRight, Factory, Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listSuppliers } from "@/modules/sourcing/repository";
import { ButtonLink, EmptyState, PageHeader, SearchField } from "@/components/ui";
import { Pagination, toPage } from "@/components/ui/pagination";
import { formatDate } from "@/lib/utils/dates";

export const metadata = { title: "Factories" };

export default async function FactoriesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePagePermission("sourcing.manage");
  const sp = await searchParams;
  const data = await listSuppliers({ q: sp.q, page: toPage(sp.page) });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Factories"
        description="The manufacturers you buy from. Their prices are added on each inquiry (Factory prices); customers never see them."
        actions={
          <ButtonLink href="/factories/new" variant="primary" size="sm">
            <Plus aria-hidden /> Add factory
          </ButtonLink>
        }
      />
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
          <div className="w-full max-w-sm">
            <SearchField defaultValue={sp.q} placeholder="Name, contact, phone or WeChat" clearHref="/factories" label="Search factories" />
          </div>
          <span className="text-xs text-muted">{data.total} factories</span>
        </div>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={Factory}
            title={sp.q ? "No factory matches" : "No factories yet"}
            description={sp.q ? "Try another name." : "Add one here, or just type its name when you add a factory price on an inquiry."}
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((r) => (
              <li key={r.id}>
                <Link href={`/factories/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    <Factory className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text">{r.name}</span>
                    <span className="block truncate text-xs text-muted">{[r.contactPerson, r.phone, r.wechat && `WeChat ${r.wechat}`].filter(Boolean).join(" · ") || "No contact details yet"}</span>
                  </span>
                  <span className="hidden text-right text-xs text-muted sm:block">
                    {r.offers} {r.offers === 1 ? "inquiry" : "inquiries"}
                    {r.lastOfferOn && <span className="block">last {formatDate(r.lastOfferOn)}</span>}
                  </span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Pagination base="/factories" params={{ q: sp.q }} page={data.page} pageSize={data.pageSize} total={data.total} />
      </div>
    </div>
  );
}
