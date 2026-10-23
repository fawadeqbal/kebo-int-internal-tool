import Link from "next/link";
import type { QueryStatus } from "@/lib/db/schema";
import { QUERY_STATUS_LABEL } from "@/lib/labels";
import { formatDate, timeAgo } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

/* ------------------------------------------------------------------ Deal track */

const STEPS = ["Received", "Quoted", "Accepted", "Invoiced"] as const;

/**
 * Where the deal stands, as four connected steps. The step reached is named
 * underneath, so position is never conveyed by colour alone.
 */
export function DealTrack({ status, quoted, accepted, invoiced }: { status: QueryStatus; quoted: boolean; accepted: boolean; invoiced: boolean }) {
  const reached = invoiced ? 3 : accepted ? 2 : quoted ? 1 : 0;
  const lost = status === "not_completed";
  const label = lost ? "Closed without an order" : reached === 0 ? "Waiting for a quotation" : STEPS[reached];
  return (
    <div className="flex items-center gap-3" aria-label={`Progress: ${label}`}>
      <ol className="flex items-center" aria-hidden>
        {STEPS.map((step, i) => (
          <li key={step} className="flex items-center">
            {i > 0 && <span className={cn("h-0.5 w-5 sm:w-7", i <= reached && !lost ? "bg-brand-600" : "bg-line")} />}
            <span
              className={cn(
                "block rounded-full",
                i === reached ? "h-2.5 w-2.5 ring-[3px]" : "h-2 w-2",
                lost
                  ? i === reached
                    ? "bg-stone-400 ring-stone-200"
                    : "bg-line"
                  : i < reached
                    ? "bg-brand-600"
                    : i === reached
                      ? "bg-brand-600 ring-brand-100"
                      : "bg-line",
              )}
              title={step}
            />
          </li>
        ))}
      </ol>
      <span className={cn("text-xs", lost ? "text-muted" : reached === 0 ? "text-muted" : "font-medium text-brand-800")}>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ Row */

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

const STATUS_STYLE: Record<QueryStatus, string> = {
  pending: "bg-amber-50 text-amber-800",
  processing: "bg-sky-50 text-sky-800",
  completed: "bg-emerald-50 text-emerald-800",
  not_completed: "bg-stone-100 text-stone-600",
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * One inquiry in the list. The buyer leads (that's who staff think of first),
 * then what they asked for, then where the deal stands.
 */
export function InboxRow({ item, today, now }: { item: InboxItem; today: string; now: Date }) {
  const open = item.status === "pending" || item.status === "processing";
  const overdue = open && !!item.requiredBy && item.requiredBy < today;
  const company = item.companyName !== item.contactPerson ? item.companyName : null;
  const needsOwner = open && !item.assigneeName;

  return (
    <li className="relative">
      {(overdue || item.status === "pending") && (
        <span className={cn("absolute inset-y-0 left-0 w-1", overdue ? "bg-red-600" : "bg-amber-400")} aria-hidden />
      )}
      <Link
        href={`/queries/${item.id}`}
        className="group grid gap-x-6 gap-y-2.5 px-4 py-4 transition-colors hover:bg-brand-50/40 focus-visible:bg-brand-50/60 sm:px-5 md:grid-cols-[minmax(0,1fr)_auto]"
      >
        {/* Buyer and request */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[15px] font-semibold text-ink">
              {item.contactPerson}
              {company && <span className="font-normal text-muted">, {company}</span>}
            </p>
            <time dateTime={new Date(item.createdAt).toISOString()} className="shrink-0 text-xs text-muted md:hidden">
              {timeAgo(item.createdAt, now)}
            </time>
          </div>
          <p className="mt-1 line-clamp-2 text-[15px] leading-snug text-ink/90 group-hover:text-ink">{item.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={cn("rounded-md px-1.5 py-0.5 font-medium", STATUS_STYLE[item.status])}>{QUERY_STATUS_LABEL[item.status]}</span>
            {item.category && <span className="rounded-md bg-canvas px-1.5 py-0.5 text-muted">{item.category}</span>}
            {item.source === "website" && <span className="rounded-md bg-violet-50 px-1.5 py-0.5 font-medium text-violet-800">Website</span>}
            {overdue && <span className="rounded-md bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">Overdue, due {formatDate(item.requiredBy)}</span>}
          </div>
        </div>

        {/* Progress, owner and time */}
        <div className="flex items-center justify-between gap-4 md:flex-col md:items-end md:justify-start md:gap-2.5">
          <DealTrack status={item.status} quoted={item.quoted} accepted={item.accepted} invoiced={item.invoiced} />
          <div className="flex items-center gap-2 text-xs">
            {item.assigneeName ? (
              <>
                <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-800" aria-hidden>
                  {initials(item.assigneeName)}
                </span>
                <span className="hidden text-muted sm:inline">{item.assigneeName}</span>
              </>
            ) : (
              <span className={needsOwner ? "font-medium text-amber-700" : "text-muted"}>{needsOwner ? "Needs an owner" : "Nobody"}</span>
            )}
            <time dateTime={new Date(item.createdAt).toISOString()} className="hidden text-muted md:inline">
              {timeAgo(item.createdAt, now)}
            </time>
          </div>
        </div>
        <span className="sr-only">Reference {item.refNo}</span>
      </Link>
    </li>
  );
}
