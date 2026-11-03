import Link from "next/link";
import type { ReactNode } from "react";
import { Pencil, Plus } from "lucide-react";
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
 * The record's Details card: "Details", "7 of 8 filled · click a value or
 * Edit", ✎ Edit in its header (opens the side panel `edit`), then the values,
 * label above value in up to three columns (label and value on one line on a
 * phone). A missing value says "+ Add" in place and a filled one shows a
 * pencil on hover — both open the same panel. Without `edit` (no permission)
 * it is read-only: no buttons, missing values show "—".
 */
export function DetailsCard({
  items,
  edit,
  title = "Details",
  description,
  flash,
  footer,
}: {
  items: DetailValue[];
  edit?: { panel: string; id?: string; label?: string } | null;
  title?: string;
  description?: ReactNode;
  /** Just saved: lit for 2 seconds. */
  flash?: boolean;
  footer?: ReactNode;
}) {
  const shown = items.filter((i) => !(i.optional && missing(i.value)));
  const counted = items.filter((i) => !i.optional);
  const filled = counted.filter((i) => !missing(i.value)).length;
  const desc =
    description ?? `${filled} of ${counted.length} filled${edit ? (filled < counted.length ? " · click + Add or Edit" : " · click a value or Edit") : ""}`;
  return (
    <Card className={cn(flash && "animate-flash")} aria-labelledby="details-title">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id="details-title" className="text-[15px] font-semibold text-text">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{desc}</p>
        </div>
        {edit && (
          <OpenPanelButton panel={edit.panel} id={edit.id} size="sm" className="h-8 px-2.5 text-[13px] [&_svg]:size-3.5" label={edit.label}>
            <Pencil aria-hidden /> Edit
          </OpenPanelButton>
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3.5 sm:grid-cols-2 sm:gap-y-4 xl:grid-cols-3">
        {shown.map((i) => {
          const empty = missing(i.value);
          return (
            <div
              key={i.label}
              className={cn("group/value flex min-w-0 items-baseline justify-between gap-3 sm:block", i.wide && "sm:col-span-2 xl:col-span-3")}
            >
              <dt className="shrink-0 text-xs text-text-2 sm:mb-0.5">{i.label}</dt>
              <dd className="min-w-0 text-right text-sm font-medium break-words text-text sm:text-left">
                {empty ? (
                  edit ? (
                    <OpenPanelButton panel={edit.panel} id={edit.id} variant="link" size="sm" className="h-auto p-0 font-semibold" label={`Add ${i.label.toLowerCase()}`}>
                      <Plus aria-hidden className="size-3.5" /> Add
                    </OpenPanelButton>
                  ) : (
                    <span className="text-muted">—</span>
                  )
                ) : (
                  <span className="inline">
                    {i.value}
                    {edit && !i.readOnly && (
                      <OpenPanelButton
                        panel={edit.panel}
                        id={edit.id}
                        variant="ghost"
                        size="icon-xs"
                        className="ml-1 size-5 align-[-4px] text-muted opacity-0 group-hover/value:opacity-100 focus-visible:opacity-100 max-sm:hidden"
                        label={`Change ${i.label.toLowerCase()}`}
                      >
                        <Pencil aria-hidden className="size-3" />
                      </OpenPanelButton>
                    )}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
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

/** Small figures in a card (Performance-like tiles): label, value, a line under it. */
export function FigureTiles({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "warn" }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 p-4 xl:grid-cols-4">
      {items.map((t) => (
        <div key={t.label} className="min-w-0 rounded-lg border border-line px-3 py-2.5">
          <p className="text-xs text-text-2">{t.label}</p>
          <p className={cn("mt-0.5 text-lg font-semibold tabular", t.tone === "bad" && "text-bad", t.tone === "warn" && "text-warn")}>{t.value}</p>
          {t.sub && <p className="text-xs text-muted">{t.sub}</p>}
        </div>
      ))}
    </div>
  );
}
