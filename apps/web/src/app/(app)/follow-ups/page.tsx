import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, Card, EmptyState, Input, LinkTabs, ListToolbar, PageHeader, Pager, toPage } from "@kebo/ui";
import { can } from "@kebo/shared";
import { isISODate } from "@kebo/utils";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import type { Person } from "@/lib/types";
import type { FollowUpList } from "@/lib/types-notes";
import { PanelButton } from "@/components/orders/step-view";
import { FollowUpRow } from "@/components/notes/cards";
import { FollowUpForm } from "@/components/notes/note-forms";
import { todayHere } from "@/components/notes/kinds";
import { addFollowUpAction } from "./actions";
import { crumbsFor } from "@/lib/nav";
import { getPeople } from "@/lib/loaders";

export const metadata = { title: "Follow-ups" };

const PAGE_SIZE = 50;

/**
 * Follow-ups: planned calls, visits and meetings. Mine (for me) or, with followups.viewAll, everyone's;
 * open (by when they are due, the late ones marked) or done (the latest first); one day only with the
 * date filter. "+ Follow-up" adds a general one (on a record: from its page).
 */
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; status?: string; on?: string; page?: string }>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const status = sp.status === "done" ? "done" : "open";
  const on = sp.on && isISODate(sp.on) ? sp.on : undefined;
  const page = toPage(sp.page);
  const viewAll = can(me, "followups.viewAll");
  const everyone = viewAll && sp.view === "everyone";
  const [list, people] = await Promise.all([
    api.get<FollowUpList>("/follow-ups", {
      mine: viewAll && !everyone ? "true" : undefined,
      open: status === "open" ? "true" : "false",
      on,
      page,
      pageSize: PAGE_SIZE,
    }),
    getPeople().catch(() => [] as Person[]),
  ]);
  const keep = { view: everyone ? "everyone" : undefined, status: status === "done" ? "done" : undefined, on };
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ ...keep, ...patch }).filter((e): e is [string, string] => !!e[1]));
    return `/follow-ups${q.size ? `?${q}` : ""}`;
  };
  const whose = everyone ? "Everyone's" : viewAll ? "Mine" : "For you or made by you";

  return (
    <div className="max-w-4xl">
      <PageHeader
        crumbs={crumbsFor("/follow-ups")}
        title="Follow-ups"
        summary={
          <>
            {whose} · {list.counts.open} open
            {list.counts.late > 0 && <span className="font-medium text-bad"> · {list.counts.late} late</span>}
            {on && <> · due {date(on)}</>}
          </>
        }
        primary={
          <PanelButton
            variant="primary"
            icon={<Plus aria-hidden />}
            label="Follow-up"
            title="New follow-up"
            description="Shows on Home with a reminder. To put it on an order, a customer or a factory, add it from that page."
            body={<FollowUpForm action={addFollowUpAction.bind(null, null)} people={people} meId={me.id} today={todayHere()} />}
          />
        }
      />
      {viewAll && (
        <LinkTabs
          label="Whose"
          className="mb-4"
          tabs={[
            { href: href({ view: undefined, page: undefined }), label: "Mine", active: !everyone },
            { href: href({ view: "everyone", page: undefined }), label: "Everyone", active: everyone },
          ]}
        />
      )}
      <ListToolbar
        label="Which ones"
        chips={[
          { key: "open", label: "Open", count: list.counts.open, href: href({ status: undefined, page: undefined }), active: status === "open" },
          { key: "done", label: "Done", count: list.counts.done, href: href({ status: "done", page: undefined }), active: status === "done" },
        ]}
        filters={
          <form aria-label="Due on a day" className="flex items-center gap-1.5">
            {keep.view && <input type="hidden" name="view" value={keep.view} />}
            {keep.status && <input type="hidden" name="status" value={keep.status} />}
            <label htmlFor="follow-ups-on" className="sr-only">
              Due on
            </label>
            <Input id="follow-ups-on" name="on" type="date" defaultValue={on} className="h-8 w-40 rounded-full text-xs" />
            <Button type="submit" size="sm" variant="secondary" className="h-8 rounded-full">
              Show
            </Button>
            {on && (
              <Link href={href({ on: undefined, page: undefined })} className="text-xs font-medium text-primary hover:underline">
                Any day
              </Link>
            )}
          </form>
        }
      />
      <Card className="overflow-clip p-0">
        {list.rows.length === 0 ? (
          <EmptyState
            framed
            title={status === "open" ? "Nothing planned" : "Nothing done yet"}
            description={
              status === "open"
                ? "Add a follow-up on an order, a customer, a factory or an inquiry (or here, for anything else). It shows on Home on its day, with a reminder."
                : "Follow-ups ticked done show here, the latest first."
            }
          />
        ) : (
          <ul aria-label="Follow-ups" className="divide-y divide-line">
            {list.rows.map((f) => (
              <FollowUpRow key={f.id} f={f} showRecord removable />
            ))}
          </ul>
        )}
        <Pager base="/follow-ups" params={keep} page={page} pageSize={PAGE_SIZE} total={list.total} />
      </Card>
    </div>
  );
}
