import Link from "next/link";
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { buttonClass, Card, cn } from "@kebo/ui";
import { OpenPanelButton } from "./panel";

/**
 * Record pages (design system: Record frame) — customers, factories, users:
 * the same frame as orders. Under the page header, the main column of cards
 * (Performance, Details with ✎ Edit, then the record's lists) and, beside it,
 * the right panel (Files · Changes). No tabs: every section is on the page.
 * On a phone it stacks — the sections become a row of chips (RecordNav) and
 * the right panel moves under the page.
 */
export function RecordFrame({ nav, main, side, sideLabel }: { nav?: ReactNode; main: ReactNode; side?: ReactNode; sideLabel: string }) {
  return (
    <>
      {nav}
      <div className={cn("grid items-start gap-5", side && "lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="flex min-w-0 flex-col gap-5">{main}</div>
        {side && (
          <aside aria-label={sideLabel} className="min-w-0">
            {side}
          </aside>
        )}
      </div>
    </>
  );
}

/** A section of a record page, where its chip (RecordNav) and old ?tab= links land. */
export function RecordSection({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} data-record-section="" className={cn("scroll-mt-32 md:scroll-mt-20", className)}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Details */

export interface DetailValue {
  label: string;
  /** null / "" / undefined: missing — "+ Add" in place when it can be edited. */
  value: ReactNode;
  /** Spans the row (an address, notes). */
  wide?: boolean;
  /** Not counted and not shown when missing (a field few records have). */
  optional?: boolean;
  /** Not changed in the panel (when someone signed in last): no pencil. */
  readOnly?: boolean;
}

const missing = (v: ReactNode) => v === null || v === undefined || v === "" || v === false;

/**
 * The record's Details card (board): "Details" with ✎ Edit in its header (opens the edit window), then the
 * values, label above value in up to three columns. A missing value shows "—". Without `edit` (no
 * permission) it is read-only.
 */
export function DetailsCard({
  items,
  edit,
  title = "Details",
  description,
  flash,
  footer,
  editHref,
}: {
  /** Edit on its own page (a link) instead of the edit window. */
  editHref?: string;
  items: DetailValue[];
  edit?: { panel: string; id?: string; label?: string } | null;
  title?: string;
  description?: ReactNode;
  /** Just saved: lit for 2 seconds. */
  flash?: boolean;
  footer?: ReactNode;
}) {
  const shown = items.filter((i) => !(i.optional && missing(i.value)));
  return (
    <Card className={cn(flash && "animate-flash")} aria-labelledby="details-title">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 id="details-title" className="text-base font-bold text-text">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {editHref && (
          <Link href={editHref} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline">
            <Pencil className="size-4" aria-hidden /> Edit
          </Link>
        )}
        {edit && (
          <OpenPanelButton panel={edit.panel} id={edit.id} variant="link" size="sm" className="h-auto text-[13px] font-semibold [&_svg]:size-4" label={edit.label}>
            <Pencil aria-hidden /> Edit
          </OpenPanelButton>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-3">
        {shown.map((i) => (
          <div key={i.label} className={cn("min-w-0", i.wide && "sm:col-span-2 xl:col-span-3")}>
            <dt className="text-xs text-muted">{i.label}</dt>
            <dd className="mt-[3px] text-sm break-words text-text">{missing(i.value) ? <span className="text-muted">—</span> : i.value}</dd>
          </div>
        ))}
      </dl>
      {footer}
    </Card>
  );
}

/* ---------------------------------------------------------------- Lists */

/**
 * One of the record's lists (its orders, inquiries, offers): "Orders · 5",
 * the card's action on the right ("All 5" or "+ New inquiry"), then compact
 * rows — a click opens the record, ⋯ at the end — or an empty state that
 * says what goes here and the one way to add it.
 */
export function RecordListCard({
  title,
  count,
  description,
  action,
  empty,
  children,
  footer,
}: {
  title: string;
  count?: number;
  description?: ReactNode;
  action?: ReactNode;
  empty?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <Card className="overflow-clip">
      <div className="flex min-h-14 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-text">
            {title}
            {count !== undefined && <span className="font-semibold"> · {count}</span>}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
      </div>
      {rows.length ? <ul className="divide-y divide-line">{children}</ul> : empty}
      {footer}
    </Card>
  );
}

/**
 * A row of a record's list: its name and one line under it, the status and
 * the key number, then ⋯. The whole row opens `href` (its name is the real
 * link, for the keyboard and screen readers).
 */
export function RecordRow({
  href,
  title,
  sub,
  status,
  figure,
  menu,
  muted,
}: {
  /** Where the row goes; without it the row is plain. */
  href?: string;
  title: ReactNode;
  sub?: ReactNode;
  status?: ReactNode;
  figure?: ReactNode;
  menu?: ReactNode;
  muted?: boolean;
}) {
  return (
    <li className={cn("group relative flex items-center gap-3 px-4 py-2.5 transition-colors", href && "hover:bg-primary-soft/60 focus-within:bg-primary-soft/40 has-[>span>a:focus-visible]:ring-2 has-[>span>a:focus-visible]:ring-ring has-[>span>a:focus-visible]:ring-inset")}>
      <span className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className={cn("block truncate text-sm font-semibold outline-none after:absolute after:inset-0 hover:text-primary focus-visible:underline", muted && "text-text-2")}>
            {title}
          </Link>
        ) : (
          <span className={cn("block truncate text-sm font-semibold", muted && "text-text-2")}>{title}</span>
        )}
        {sub && <span className="block truncate text-xs text-text-2">{sub}</span>}
      </span>
      {(status || figure !== undefined) && (
        <span className="flex shrink-0 items-center gap-3 max-sm:flex-col max-sm:items-end max-sm:gap-1">
          {status}
          {figure !== undefined && <span className="min-w-[4.5rem] text-right text-sm tabular max-sm:text-xs max-sm:text-text-2">{figure}</span>}
        </span>
      )}
      {menu && <span className="relative z-[1] shrink-0">{menu}</span>}
    </li>
  );
}

/** "All 12 →" in a list card's header: the whole list elsewhere. */
export function AllLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass("ghost", "sm", "h-8 px-2.5 text-[13px] text-text-2")}>
      {children}
    </Link>
  );
}

/** A record's empty list: what goes here, and the one way to add it. */
export function RecordEmpty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="m-4 rounded-lg border border-dashed border-line-strong px-4 py-5 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-text-2">{children}</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

