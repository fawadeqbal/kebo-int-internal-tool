import { Card, CardBody, CardHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { factoryOf, partyHistoryOf, partyNotesOf } from "@/lib/party-data";
import { getPeople } from "@/lib/loaders";
import type { Person } from "@/lib/types";
import type { FollowUpList } from "@/lib/types-notes";
import { FollowUpsCard, NotesCard } from "@/components/notes/cards";
import { HistoryList } from "@/components/common/history-list";

export const metadata = { title: "Supplier notes and history" };

/** The supplier's Notes tab (the record's activity): notes and follow-ups, then every change, newest first. */
export default async function FactoryNotes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requirePermission("sourcing.manage");
  const [f, notes, followUps, people, history] = await Promise.all([
    factoryOf(id),
    partyNotesOf("factories", id),
    api.get<FollowUpList>("/follow-ups", { factoryId: id }).catch(() => null),
    getPeople().catch(() => [] as Person[]),
    partyHistoryOf("factory", id),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <NotesCard on={{ key: "factoryId", id: f.id }} notes={notes} canAdd />
        <FollowUpsCard on={{ key: "factoryId", id: f.id }} label={f.name} rows={followUps?.rows ?? []} people={people} meId={me.id} />
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
