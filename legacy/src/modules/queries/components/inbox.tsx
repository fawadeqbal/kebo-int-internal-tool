import Link from "next/link";
import type { QueryStatus } from "@/lib/db/schema";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatDate, timeAgo } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { Avatar, THead, Td, Th } from "@/components/ui";
import { Badge, QueryStatusBadge } from "@/components/ui/badge";

/* ------------------------------------------------------------------ Deal track */

const STEPS = ["Received", "Quoted", "Accepted", "Invoiced"] as const;

/**
 * Where the deal stands, as four connected steps. The step reached is named
 * next to it, so position is never conveyed by colour alone.
 */
export function DealTrack({ status, quoted, accepted, invoiced, compact }: { status: QueryStatus; quoted: boolean; accepted: boolean; invoiced: boolean; compact?: boolean }) {
  const reached = invoiced ? 3 : accepted ? 2 : quoted ? 1 : 0;
  const lost = status === "not_completed";
  const label = lost ? "Closed, no order" : reached === 0 ? "Not quoted yet" : STEPS[reached];
  return (
    <div className="flex items-center gap-2.5" aria-label={`Progress: ${label}`}>
      <ol className="flex items-center" aria-hidden>
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center">
            {i > 0 && <span className={cn("h-0.5", compact ? "w-3" : "w-4 sm:w-5", i <= reached && !lost ? "bg-primary" : "bg-line-strong")} />}
            <span
              className={cn(
                "block rounded-full",
                i === reached ? "size-2.5 ring-[3px]" : "size-2",
                lost
                  ? i === reached
                    ? "bg-muted ring-surface-3"
                    : "bg-line-strong"
                  : i <= reached
                    ? cn("bg-primary", i === reached && "ring-primary-soft")
                    : "bg-line-strong",
              )}
              title={step}
            />
          </li>
        ))}
      </ol>
      <span className={cn("text-xs whitespace-nowrap", lost || reached === 0 ? "text-muted" : "font-medium text-text-2")}>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ Data */

export interface InboxItem {
  id: string;
  refNo: string;
  title: string;
  category: string | null;
  status: QueryStatus;
  source: string;
  requiredBy: string | null;
  createdAt: Date;
  companyName: string;
  contactPerson: string;
  assigneeName: string | null;
  quoted: boolean;
  accepted: boolean;
  invoiced: boolean;
}

function facts(item: InboxItem, today: string) {
  const open = item.status === "pending" || item.status === "processing";
  return {
    overdue: open && !!item.requiredBy && item.requiredBy < today,
    company: item.companyName !== item.contactPerson ? item.companyName : null,
    needsOwner: open && !item.assigneeName,
  };
}

function Owner({ name, needsOwner }: { name: string | null; needsOwner: boolean }) {
  if (name)
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={name} size={24} />
        <span className="truncate text-sm text-text-2">{name}</span>
      </span>
    );
  return needsOwner ? <Badge tone="warn">Not assigned</Badge> : <span className="text-sm text-muted">—</span>;
}

/* ------------------------------------------------------------------ Desktop: table */

/** The inquiry list as a table (tablets and up). The whole row opens the inquiry. */
export function InboxTable({ items, today, now }: { items: InboxItem[]; today: string; now: Date }) {
  return (
    <div className="hidden w-full overflow-x-auto md:block">
      <table className="w-full border-collapse text-sm">
        <THead>
          <tr>
            <Th>Inquiry</Th>
            <Th>Customer</Th>
            <Th>Status</Th>
            <Th className="hidden xl:table-cell">Progress</Th>
            <Th>Handled by</Th>
            <Th className="text-right">Received</Th>
          </tr>
        </THead>
        <tbody>
          {items.map((item) => {
            const { overdue, company, needsOwner } = facts(item, today);
            return (
              <tr key={item.id} className="group relative transition-colors hover:bg-surface-2/70 focus-within:bg-surface-2 last:[&>td]:border-b-0">
                <Td className="max-w-[22rem] py-2.5">
                  <Link href={`/queries/${item.id}`} className="block min-w-0 outline-none after:absolute after:inset-0 after:content-['']">
                    <span className="block truncate font-medium text-text group-hover:text-primary">{item.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <span className="font-mono text-[11px]">{item.refNo}</span>
                      {item.category && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{item.category}</span>
                        </>
                      )}
                      {item.source === "website" && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="font-medium text-primary">Website</span>
                        </>
                      )}
                    </span>
                  </Link>
                </Td>
                <Td className="max-w-[13rem] py-2.5">
                  <span className="block truncate text-text">{item.contactPerson}</span>
                  <span className="block truncate text-xs text-muted">{company ?? SOURCE_LABEL[item.source as keyof typeof SOURCE_LABEL] ?? item.source}</span>
                </Td>
                <Td>
                  <QueryStatusBadge status={item.status} />
                </Td>
                <Td className="hidden xl:table-cell">
                  <DealTrack status={item.status} quoted={item.quoted} accepted={item.accepted} invoiced={item.invoiced} compact />
                </Td>
                <Td>
                  <Owner name={item.assigneeName} needsOwner={needsOwner} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <time dateTime={new Date(item.createdAt).toISOString()} className="text-text-2" title={formatDate(item.createdAt)}>
                    {timeAgo(item.createdAt, now)}
                  </time>
                  {item.requiredBy && <span className={cn("block text-xs", overdue ? "font-medium text-bad" : "text-muted")}>{overdue ? "Overdue" : "Needed"} {formatDate(item.requiredBy)}</span>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ Phone: list */

/**
 * One inquiry on a phone. The customer leads (that's who staff think of first),
 * then what they asked for, then where the deal stands.
 */
export function InboxRow({ item, today, now }: { item: InboxItem; today: string; now: Date }) {
  const { overdue, company, needsOwner } = facts(item, today);
  return (
    <li>
      <Link href={`/queries/${item.id}`} className="block px-4 py-3.5 transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium text-text">
            {item.contactPerson}
            {company && <span className="font-normal text-muted"> · {company}</span>}
          </p>
          <time dateTime={new Date(item.createdAt).toISOString()} className="shrink-0 text-xs text-muted">
            {timeAgo(item.createdAt, now)}
          </time>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-text-2">{item.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <QueryStatusBadge status={item.status} />
          {overdue && <Badge tone="bad">Overdue · {formatDate(item.requiredBy)}</Badge>}
          {item.source === "website" && <Badge tone="primary">Website</Badge>}
          {item.category && <Badge tone="outline">{item.category}</Badge>}
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <DealTrack status={item.status} quoted={item.quoted} accepted={item.accepted} invoiced={item.invoiced} compact />
          <Owner name={item.assigneeName} needsOwner={needsOwner} />
        </div>
        <span className="sr-only">Reference {item.refNo}</span>
      </Link>
    </li>
  );
}

export function InboxList({ items, today, now }: { items: InboxItem[]; today: string; now: Date }) {
  return (
    <ul className="divide-y divide-line md:hidden">
      {items.map((r) => (
        <InboxRow key={r.id} item={r} today={today} now={now} />
      ))}
    </ul>
  );
}
