import { Card } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { getPeople } from "@/lib/loaders";
import { dealOf } from "@/lib/deal-data";
import type { HistoryEntry } from "@/lib/types";
import type { FollowUpList } from "@/lib/types-notes";
import { FilterCard } from "@/components/common/filter-card";
import { HistoryTable, historyText } from "@/components/common/history-list";
import { FollowUpsCard } from "@/components/notes/cards";

export const metadata = { title: "Inquiry history" };

/** Every change on the deal and its prices, quotation, files and order: who, when, old → new, and why; searchable, by person. Then its follow-ups. */
export default async function DealHistory({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; who?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const [entries, d, followUps, staff] = await Promise.all([
    api.get<HistoryEntry[]>("/history", { type: "deal", id }),
    dealOf(id),
    api.get<FollowUpList>("/follow-ups", { inquiryId: id }).catch(() => null),
    getPeople().catch(() => []),
  ]);
  const people = [...new Map(entries.map((e) => [e.by?.id ?? "system", e.by?.name ?? "System"])).entries()].map(([value, label]) => ({ value, label }));
  const q = sp.q?.trim().toLowerCase() ?? "";
  const shown = entries.filter((e) => (!q || historyText(e).includes(q)) && (!sp.who || (e.by?.id ?? "system") === sp.who));
  return (
    <div>
      <FilterCard search="Search history…" value={sp.q} clearHref={sp.who ? `?who=${sp.who}` : "?"} selects={[{ name: "who", label: "Who", value: sp.who, options: people }]} />
      <Card>
        <HistoryTable entries={shown} showArea empty={q || sp.who ? "Nothing matches. Clear the search or choose everyone." : "Nothing has changed yet."} />
      </Card>
      {followUps && (
        <div className="mt-4">
          <FollowUpsCard on={{ key: "inquiryId", id }} label={`${d.refNo} · ${d.customer.name}`} rows={followUps.rows} people={staff} meId={me.id} />
        </div>
      )}
    </div>
  );
}
