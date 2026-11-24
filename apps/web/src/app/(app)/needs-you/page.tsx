import { Card, EmptyLine, PageHeader, Pager, Stack, toPage, toPageSize } from "@kebo/ui";
import { ReminderList } from "@/components/home/board";
import { api } from "@/lib/api";
import { countOf } from "@/lib/format";
import { requireUser } from "@/lib/session";
import type { Reminders } from "@/lib/types-insights";

export const metadata = { title: "Needs you today" };

/**
 * Everything that needs the signed-in person, the most urgent first: Home's "Needs you today" in full (review 24
 * Nov, S-23: its "212 more" opened Alerts, another list).
 */
export default async function NeedsYouPage({ searchParams }: { searchParams: Promise<{ page?: string; size?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const r = await api.get<Reminders>("/reminders", { all: "1" });
  const page = toPage(sp.page);
  const size = toPageSize(sp.size);
  const shown = r.items.slice((page - 1) * size, page * size);
  return (
    <Stack>
      <PageHeader crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Needs you today" }]} title="Needs you today" summary={countOf(r.counts.total, "thing")} />
      <Card data-part="table" className="overflow-hidden">{shown.length ? <ReminderList items={shown} /> : <EmptyLine inset>Nothing needs you right now.</EmptyLine>}</Card>
      <Pager base="/needs-you" params={{}} page={page} pageSize={size} total={r.items.length} bare />
    </Stack>
  );
}
