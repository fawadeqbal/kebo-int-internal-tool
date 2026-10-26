import { priorityEnum, querySourceEnum, queryStatusEnum, type Priority, type QuerySource, type QueryStatus } from "@/lib/db/schema";
import { isUuid } from "@/lib/utils/ids";
import type { QueryFilters } from "./repository";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Read list filters from the URL (so any filtered view can be bookmarked and shared). */
export function parseQueryFilters(sp: Params): QueryFilters & { raw: Record<string, string | undefined> } {
  const status = one(sp.status);
  const assignee = one(sp.assignee);
  const priority = one(sp.priority);
  const sort = one(sp.sort);
  const customer = one(sp.customer);
  const source = one(sp.source);
  const filters: QueryFilters = {
    q: one(sp.q)?.slice(0, 100),
    status:
      status === "open" || status === "overdue" || (queryStatusEnum.enumValues as string[]).includes(status ?? "")
        ? (status as QueryStatus | "open" | "overdue")
        : undefined,
    assignee: assignee === "me" || assignee === "unassigned" || isUuid(assignee) ? assignee : undefined,
    priority: (priorityEnum.enumValues as string[]).includes(priority ?? "") ? (priority as Priority) : undefined,
    customerId: isUuid(customer) ? customer : undefined,
    source: (querySourceEnum.enumValues as string[]).includes(source ?? "") ? (source as QuerySource) : undefined,
    category: one(sp.category)?.slice(0, 120),
    from: isDate(one(sp.from)) ? one(sp.from) : undefined,
    to: isDate(one(sp.to)) ? one(sp.to) : undefined,
    sort: ["newest", "oldest", "required", "priority", "updated"].includes(sort ?? "") ? (sort as QueryFilters["sort"]) : undefined,
  };
  return {
    ...filters,
    raw: {
      q: filters.q,
      status: filters.status,
      assignee: filters.assignee,
      priority: filters.priority,
      customer: filters.customerId,
      source: filters.source,
      category: filters.category,
      from: filters.from,
      to: filters.to,
      sort: filters.sort,
    },
  };
}
