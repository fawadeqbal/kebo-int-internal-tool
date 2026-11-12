import { Card } from "@kebo/ui";
import { api } from "@/lib/api";
import type { HistoryEntry } from "@/lib/types";
import { FilterCard } from "@/components/common/filter-card";
import { HistoryTable, historyText } from "@/components/common/history-list";

export const metadata = { title: "Inquiry history" };

/** Every change on the deal and its prices, quotation, files and order: who, when, old → new, and why; searchable, by person. */
export default async function DealHistory({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; who?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const entries = await api.get<HistoryEntry[]>("/history", { type: "deal", id });
  const people = [...new Map(entries.map((e) => [e.by?.id ?? "system", e.by?.name ?? "System"])).entries()].map(([value, label]) => ({ value, label }));
  const q = sp.q?.trim().toLowerCase() ?? "";
  const shown = entries.filter((e) => (!q || historyText(e).includes(q)) && (!sp.who || (e.by?.id ?? "system") === sp.who));
  return (
    <div>
      <FilterCard search="Search history…" value={sp.q} clearHref={sp.who ? `?who=${sp.who}` : "?"} selects={[{ name: "who", label: "Who", value: sp.who, options: people }]} />
      <Card>
        <HistoryTable entries={shown} showArea empty={q || sp.who ? "Nothing matches. Clear the search or choose everyone." : "Nothing has changed yet."} />
      </Card>
    </div>
  );
}
