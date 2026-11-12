import { AdminTabs } from "@/components/common/admin-tabs";
import Link from "next/link";
import { History } from "lucide-react";
import { buildHref, ButtonLink, Card, EmptyState, FilterBar, FilterChip, Pagination, SearchField, toPage } from "@kebo/ui";
import { PageHeader } from "@kebo/ui";
import { crumbsFor } from "@/lib/nav";
import { AutoSelect } from "@kebo/ui/client";
import { api } from "@/lib/api";
import type { Paged } from "@/lib/types";
import type { SignInRow } from "@/lib/types-people";
import { SignInList } from "@/components/security/sign-in-list";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Sign-ins" };

const PAGE_SIZE = 50;

/** Every sign-in attempt for a year, right and wrong: by person, failed only, or by email or address. */
export default async function SignInsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const failed = sp.failed === "1";
  const [data, people] = await Promise.all([
    api.get<Paged<SignInRow>>("/security/sign-ins", { userId: sp.person, failed: failed || undefined, q: sp.q, page: toPage(sp.page), pageSize: PAGE_SIZE }),
    getPeople(),
  ]);
  const keep = { person: sp.person, failed: sp.failed, q: sp.q };
  const filtered = !!(sp.person || failed || sp.q);
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/access/sign-ins")} title="Sign-ins" description="Every sign-in attempt for a year, right and wrong.">
        <AdminTabs set="people" current="/access/sign-ins" />
      </PageHeader>
    <Card className="overflow-hidden p-0">
      <FilterBar end={<span className="text-xs text-muted tabular">{data.total.toLocaleString("en-US")} attempts</span>}>
        <FilterChip href={buildHref("/access/sign-ins", keep, { failed: undefined, page: undefined })} active={!failed}>
          All
        </FilterChip>
        <FilterChip href={buildHref("/access/sign-ins", keep, { failed: "1", page: undefined })} active={failed}>
          Failed only
        </FilterChip>
        <form className="flex flex-1 flex-wrap items-center gap-2">
          {failed && <input type="hidden" name="failed" value="1" />}
          <AutoSelect name="person" defaultValue={sp.person ?? ""} aria-label="Person" className="w-full sm:w-48">
            <option value="">Anyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </AutoSelect>
          <SearchField defaultValue={sp.q} placeholder="Email or address" clearHref={buildHref("/access/sign-ins", keep, { q: undefined, page: undefined })} className="w-full sm:w-56" />
          {filtered && (
            <Link href="/access/sign-ins" className="text-xs font-medium text-muted hover:text-text">
              Clear filters
            </Link>
          )}
        </form>
      </FilterBar>
      {data.rows.length === 0 ? (
        <EmptyState
          icon={History}
          title={failed ? "No failed sign-ins" : "No sign-ins"}
          description={filtered ? "Nothing matches these filters." : "Attempts will be listed here."}
          action={filtered ? <ButtonLink href="/access/sign-ins">Clear filters</ButtonLink> : undefined}
        />
      ) : (
        <SignInList rows={data.rows} showPerson />
      )}
      <Pagination base="/access/sign-ins" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} />
    </Card>
    </div>
  );
}
