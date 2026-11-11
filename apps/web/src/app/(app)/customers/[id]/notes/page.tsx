import { can } from "@kebo/shared";
import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { customerOf, partyHistoryOf, partyNotesOf } from "@/lib/party-data";
import { getPeople } from "@/lib/loaders";
import type { Person } from "@/lib/types";
import type { FollowUpList } from "@/lib/types-notes";
import { FollowUpsCard, NotesCard } from "@/components/notes/cards";
import { HistoryList } from "@/components/common/history-list";

export const metadata = { title: "Customer notes and history" };

/** The customer's Notes tab (the record's activity): notes and follow-ups, then every change, newest first. */
export default async function CustomerNotes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [c, notes, followUps, people, history] = await Promise.all([
    customerOf(id),
    partyNotesOf("customers", id),
    api.get<FollowUpList>("/follow-ups", { customerId: id }).catch(() => null),
    getPeople().catch(() => [] as Person[]),
    partyHistoryOf("customer", id),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <NotesCard
          on={{ key: "customerId", id: c.id }}
          notes={notes}
          canAdd={can(me, "customers.manage")}
          contacts={c.contacts.map((p) => ({ id: p.id, name: p.name }))}
        />
        <FollowUpsCard on={{ key: "customerId", id: c.id }} label={c.name} rows={followUps?.rows ?? []} people={people} meId={me.id} />
      </div>
      <Card>
        <CardHeader title="History" description="Every change, newest first, with the reason when one was asked." />
        <CardBody>
          <HistoryList entries={history} />
        </CardBody>
      </Card>
    </div>
  );
}
