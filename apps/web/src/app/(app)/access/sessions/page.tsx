import { AdminTabs } from "@/components/common/admin-tabs";
import Link from "next/link";
import { MonitorSmartphone } from "lucide-react";
import { Card, CardHeader, EmptyState, FilterBar } from "@kebo/ui";
import { PageHeader } from "@kebo/ui";
import { crumbsFor } from "@/lib/nav";
import { AutoSelect } from "@kebo/ui/client";
import { api } from "@/lib/api";
import type { SessionRow } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { SessionList } from "@/components/security/session-list";
import { endSessionAction, signOutEverywhereAction } from "../actions";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Sessions" };

/** Every browser and phone signed in now, newest use first; sign out one, or someone everywhere. */
export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const { person } = await searchParams;
  const [sessions, people] = await Promise.all([api.get<SessionRow[]>("/security/sessions", { userId: person }), getPeople()]);
  const who = person ? people.find((p) => p.id === person) : null;
  const byPerson = new Set(sessions.map((s) => s.user.id)).size;
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/access/sessions")} title="Sessions" description="Every browser and phone signed in now. Sign one out, or someone everywhere.">
        <AdminTabs set="people" current="/access/sessions" />
      </PageHeader>
    <Card className="overflow-hidden p-0">
      <CardHeader
        title={who ? `${who.name}: signed in on ${sessions.length} device${sessions.length === 1 ? "" : "s"}` : `${sessions.length} device${sessions.length === 1 ? "" : "s"} signed in, ${byPerson} ${byPerson === 1 ? "person" : "people"}`}
        description="A session ends after 30 days unused, and after 90 days whatever happens. Signing out takes effect at their next click."
        actions={
          who && sessions.length ? (
            <ConfirmAction action={signOutEverywhereAction.bind(null, who.id)} confirm={`Sign ${who.name} out on every device?`} label="Sign out everywhere" pendingText="Signing out…" variant="secondary" size="xs" />
          ) : undefined
        }
      />
      <FilterBar>
        <form className="flex flex-1 flex-wrap items-center gap-2">
          <AutoSelect name="person" defaultValue={person ?? ""} aria-label="Person" className="w-full sm:w-56">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </AutoSelect>
          {person && (
            <Link href="/access/sessions" className="text-xs font-medium text-muted hover:text-text">
              Everyone
            </Link>
          )}
        </form>
      </FilterBar>
      {sessions.length === 0 ? (
        <EmptyState icon={MonitorSmartphone} title="Not signed in anywhere" description={who ? `${who.name} has no live sessions.` : "Nobody is signed in."} />
      ) : (
        <SessionList sessions={sessions} end={(id) => endSessionAction.bind(null, id)} showPerson={!who} />
      )}
    </Card>
    </div>
  );
}
