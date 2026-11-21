import { MonitorSmartphone } from "lucide-react";
import { buildHref, Card, CardHeader, EmptyState, Pager, toPage, toPageSize, Stack } from "@kebo/ui";
import { PageHeader } from "@kebo/ui";
import { crumbsFor } from "@/lib/nav";
import { api } from "@/lib/api";
import type { SessionRow } from "@/lib/types-people";
import type { Paged } from "@/lib/types";
import { FilterCard } from "@/components/common/filter-card";
import { ConfirmAction } from "@/components/people/confirm-action";
import { SessionList } from "@/components/security/session-list";
import { endSessionAction, signOutEverywhereAction } from "../actions";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Active sessions" };

/** Every browser and phone signed in now, newest use first; sign out one, or someone everywhere. 25 a page. */
export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ person?: string; q?: string; page?: string; size?: string }> }) {
  const sp = await searchParams;
  const person = sp.person;
  const [list, people] = await Promise.all([
    api.get<Paged<SessionRow> & { people: number }>("/security/sessions", { userId: person, q: sp.q?.trim() || undefined, page: toPage(sp.page), pageSize: toPageSize(sp.size) }),
    getPeople(),
  ]);
  const who = person ? people.find((p) => p.id === person) : null;
  const keep = { person, q: sp.q };
  const href = (patch: Record<string, string | undefined>) => buildHref("/access/sessions", keep, { page: undefined, ...patch });
  const filtered = !!(person || sp.q);
  return (
    <Stack>
      <PageHeader
        kind="list"
        crumbs={crumbsFor("/access/sessions")}
        title="Active sessions"
        actions={
          who && list.total ? (
            <ConfirmAction action={signOutEverywhereAction.bind(null, who.id)} confirm={`Sign ${who.name} out on every device?`} label="Sign out everywhere" pendingText="Signing out…" variant="secondary" size="md" />
          ) : undefined
        }
      />
      <FilterCard
        search="Search name or email…"
        value={sp.q}
        keep={{}}
        clearHref={href({ q: undefined })}
        selects={[{ name: "person", label: "Person", all: "Everyone", value: person, options: people.map((p) => ({ value: p.id, label: p.name })) }]}
      />
      <Card className="overflow-hidden">
        <CardHeader
          title={who ? `${who.name}: signed in on ${list.total} device${list.total === 1 ? "" : "s"}` : `${list.total} device${list.total === 1 ? "" : "s"} signed in, ${list.people} ${list.people === 1 ? "person" : "people"}`}
          description="A session ends after 30 days unused, and after 90 days whatever happens. Signing out takes effect at their next click."
        />
        {list.rows.length === 0 ? (
          <EmptyState
            icon={MonitorSmartphone}
            title={filtered && !who ? "No session matches" : "Not signed in anywhere"}
            description={who ? `${who.name} has no live sessions.` : filtered ? "Try other words, or clear the search." : "Nobody is signed in."}
          />
        ) : (
          <SessionList sessions={list.rows} end={(id) => endSessionAction.bind(null, id)} showPerson={!who} />
        )}
      </Card>
      <Pager base="/access/sessions" params={keep} page={list.page} pageSize={list.pageSize} total={list.total} bare />
    </Stack>
  );
}
