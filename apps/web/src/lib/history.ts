import { api } from "@/lib/api";
import type { HistoryEntry, Paged } from "@/lib/types";

/** One page of a record's history, searched and narrowed by the server (the History tabs; Pager under it). */
export function historyPage(
  type: "deal" | "order",
  id: string,
  o: { page: number; pageSize: number; q?: string; who?: string; step?: string },
) {
  return api.get<Paged<HistoryEntry & { step: string | null }>>("/history", {
    type,
    id,
    page: String(o.page),
    pageSize: String(o.pageSize),
    ...(o.q ? { q: o.q } : {}),
    ...(o.who ? { who: o.who } : {}),
    ...(o.step ? { step: o.step } : {}),
  });
}

/** Who can have changed a record, for the Who filter: the team, and the app itself. */
export const whoOptions = (people: { id: string; name: string }[]) => [...people.map((p) => ({ value: p.id, label: p.name })), { value: "system", label: "System" }];
