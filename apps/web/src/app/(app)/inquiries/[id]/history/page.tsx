import { Card, Pager, Stack, toPage, toPageSize } from "@kebo/ui";
import { api } from "@/lib/api";
import { historyPage, whoOptions } from "@/lib/history";
import { requireUser } from "@/lib/session";
import { getPeople } from "@/lib/loaders";
import { dealOf } from "@/lib/deal-data";
import type { FollowUpList } from "@/lib/types-notes";
import { FilterCard } from "@/components/common/filter-card";
import { HistoryTable } from "@/components/common/history-list";
import { FollowUpsCard } from "@/components/notes/cards";
import { inquiryTitle } from "@/lib/titles";
import { WithSide } from "../side";
import { dataOf, failedWhat, part } from "@/lib/part";
import { CouldNotLoad } from "@/components/common/could-not-load";

export const generateMetadata = inquiryTitle("History");

/** Every change on the deal and its prices, quotation, files and order: who, when, old → new, and why; searchable, by person. Then its follow-ups. */
export default async function DealHistory({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; who?: string; page?: string; size?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const page = toPage(sp.page);
  const [list, d, followUpsPart, staffPart] = await Promise.all([
    historyPage("deal", id, { page, pageSize: toPageSize(sp.size), q: sp.q?.trim() || undefined, who: sp.who }),
    dealOf(id),
    part("its follow-ups", () => api.get<FollowUpList>("/follow-ups", { inquiryId: id })),
    part("the people to choose from", () => getPeople()),
  ]);
  const followUps = dataOf(followUpsPart);
  const staff = dataOf(staffPart) ?? [];
  // The parts that could not be read, said once at the top (the rest works).
  const failed = failedWhat(followUpsPart, staffPart);
  const people = whoOptions(staff);
  const q = sp.q?.trim() ?? "";
  return (
    // The same panel as every tab of the inquiry, beside its history.
    <WithSide id={id}>
      {failed && <CouldNotLoad what={failed} />}
      <Stack>
      <FilterCard search="Search history…" value={sp.q} clearHref={sp.who ? `?who=${sp.who}` : "?"} selects={[{ name: "who", label: "Who", value: sp.who, options: people }]} />
      <Card>
        <HistoryTable entries={list.rows} showArea empty={q || sp.who ? "Nothing matches. Clear the search or choose everyone." : "Nothing has changed yet."} />
      </Card>
      <Pager base={`/inquiries/${id}/history`} params={{ q: sp.q, who: sp.who }} page={list.page} pageSize={list.pageSize} total={list.total} bare />
      {followUps && (
        <div>
          <FollowUpsCard on={{ key: "inquiryId", id }} label={`${d.refNo} · ${d.customer.name}`} rows={followUps.rows} people={staff} meId={me.id} />
        </div>
      )}
      </Stack>
    </WithSide>
  );
}
