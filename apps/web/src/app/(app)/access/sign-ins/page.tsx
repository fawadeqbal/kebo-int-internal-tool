import { History } from "lucide-react";
import { buildHref, ButtonLink, Card, EmptyState, LinkTabs, PAGE_SIZE, Pager, toPage } from "@kebo/ui";
import { PageHeader } from "@kebo/ui";
import { crumbsFor } from "@/lib/nav";
import { api } from "@/lib/api";
import type { Paged } from "@/lib/types";
import type { SignInRow } from "@/lib/types-people";
import { SignInList } from "@/components/security/sign-in-list";
import { getPeople } from "@/lib/loaders";
import { FilterCard } from "@/components/common/filter-card";

export const metadata = { title: "Sign-ins" };

/** Every sign-in attempt for a year, right and wrong: by person, failed only, or by email or address. */
export default async function SignInsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const failed = sp.failed === "1";
  const q = sp.q?.trim() || undefined;
  const ask = (onlyFailed: boolean, page: number, pageSize: number) =>
    api.get<Paged<SignInRow>>("/security/sign-ins", { userId: sp.person, failed: onlyFailed || undefined, q, page, pageSize });
  // The list, and the other tab's number (each tab counts what it lists, for the same person and search).
  const [data, other, people] = await Promise.all([ask(failed, toPage(sp.page), PAGE_SIZE), ask(!failed, 1, 1), getPeople()]);
  const counts = failed ? { all: other.total, failed: data.total } : { all: data.total, failed: other.total };
  const keep = { person: sp.person, failed: sp.failed, q: sp.q };
  const href = (patch: Record<string, string | undefined>) => buildHref("/access/sign-ins", keep, { page: undefined, ...patch });
  const filtered = !!(sp.person || failed || sp.q);
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/access/sign-ins")} title="Sign-ins" />
      <LinkTabs
        label="Which attempts"
        className="mb-4"
        tabs={[
          { href: href({ failed: undefined }), label: "All", count: counts.all, active: !failed },
          { href: href({ failed: "1" }), label: "Failed", count: counts.failed, alert: counts.failed > 0, active: failed },
        ]}
      />
      <FilterCard
        search="Search email or address…"
        value={sp.q}
        keep={{ failed: sp.failed }}
        clearHref={href({ q: undefined })}
        selects={[{ name: "person", label: "Person", all: "Anyone", value: sp.person, options: people.map((p) => ({ value: p.id, label: p.name })) }]}
      />
      <Card className="overflow-hidden p-0">
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
      </Card>
      <Pager base="/access/sign-ins" params={keep} page={data.page} pageSize={data.pageSize} total={data.total} bare />
    </div>
  );
}
