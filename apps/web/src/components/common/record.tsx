import Link from "next/link";
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";
import { boxTitleClass, buttonClass, Card, cn, linkClass, Dash, RULES } from "@kebo/ui";
import { OpenPanelButton } from "./panel";
import { FACT_LABEL, FACT_VALUE, FACTS_GRID } from "./record-box";
import { TabList } from "@/components/lists/tab-list";

/** A section of a record page, where its links (#section) and old ?tab= links land. */
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
 * values, label at the left of each value (the record box's rows), two pairs a row on a wide box. A missing value shows "—". Without `edit` (no
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
      <div className={cn(RULES.box.inset, "flex items-center justify-between gap-3 border-b border-line py-3.5")}>
        <div className="min-w-0">
          <h2 id="details-title" className={boxTitleClass}>
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {editHref && (
          <Link href={editHref} className={cn(linkClass, "tap inline-flex items-center gap-1.5 text-md")}>
            <Pencil className="size-4" aria-hidden /> Edit
          </Link>
        )}
        {edit && (
          <OpenPanelButton
            panel={edit.panel}
            id={edit.id}
            variant="link"
            size="sm"
            className="tap h-auto text-md font-semibold [&_svg]:size-4"
            label={edit.label}
          >
            <Pencil aria-hidden /> Edit
          </OpenPanelButton>
        )}
      </div>
      {/* The record box's rows (BoxFacts): label at the left, the value beside it; two pairs a row on a wide box. */}
      <dl className={cn(RULES.box.body, FACTS_GRID, "xl:grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)_minmax(6.5rem,auto)_minmax(0,1fr)] xl:gap-x-6")}>
        {shown.map((i) => (
          // A wide value (an address, notes) starts its own row, so the pairs after it stay label · value.
          <div key={i.label} className={cn("contents", i.wide && "xl:[&>dt]:col-start-1 xl:[&>dd]:col-span-3")}>
            <dt className={FACT_LABEL}>{i.label}</dt>
            <dd className={FACT_VALUE}>{missing(i.value) ? <Dash /> : i.value}</dd>
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
  // The one list inside a record (TabList): its name and count, a line under it, the card's action on the right.
  return (
    <TabList title={count !== undefined ? `${title} · ${count}` : title} summary={description} buttons={action}>
      {rows.length ? <ul className="divide-y divide-line">{children}</ul> : empty}
      {footer}
    </TabList>
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
    <li
      className={cn(
        "group relative flex items-center gap-3 px-4 py-2.5 transition-colors",
        href &&
          "hover:bg-primary-soft/60 focus-within:bg-primary-soft/40 has-[>span>a:focus-visible]:ring-2 has-[>span>a:focus-visible]:ring-ring has-[>span>a:focus-visible]:ring-inset",
      )}
    >
      <span className="min-w-0 flex-1">
        {href ? (
          <Link
            href={href}
            className={cn(
              "block truncate text-sm font-semibold outline-none after:absolute after:inset-0 hover:text-primary focus-visible:underline",
              muted && "text-text-2",
            )}
          >
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
          {figure !== undefined && (
            <span className="min-w-[4.5rem] text-right text-sm tabular max-sm:text-xs max-sm:text-text-2">{figure}</span>
          )}
        </span>
      )}
      {menu && <span className="relative z-[1] shrink-0">{menu}</span>}
    </li>
  );
}

/** "All 12 →" in a list card's header: the whole list elsewhere. */
export function AllLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass("ghost", "sm", "text-text-2")}>
      {children}
    </Link>
  );
}

