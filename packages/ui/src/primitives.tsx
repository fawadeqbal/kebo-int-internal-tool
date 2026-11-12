import Link from "next/link";
import { ScrollFade } from "./scroll-fade";
import type { ComponentProps, ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Globe,
  House,
  Info,
  Inbox,
  LayoutDashboard,
  Package,
  Settings,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "./cn";

/* ---------------------------------------------------------------- Button */
export type ButtonVariant = "primary" | "brand" | "secondary" | "ghost" | "danger" | "danger-ghost" | "trust" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-xs";

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] text-sm font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const buttonVariants: Record<ButtonVariant, string> = {
  /* The page's one main action: orange. */
  primary: "bg-action-solid text-white shadow-card hover:bg-action-solid-hover",
  /* Green: the brand, for a second positive action beside the orange one (Save draft). */
  brand: "bg-primary-solid text-primary-fg shadow-card hover:bg-primary-solid-hover",
  secondary: "border border-line-strong bg-surface text-text shadow-card hover:bg-surface-2",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
  danger: "bg-bad-solid text-white shadow-card hover:opacity-90",
  "danger-ghost": "text-bad hover:bg-bad-soft",
  trust: "bg-trust text-white shadow-card hover:opacity-90 dark:text-bg",
  link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
};
const buttonSizes: Record<ButtonSize, string> = {
  xs: "h-7 rounded-lg px-2 text-xs [&_svg]:size-3.5",
  sm: "h-8 px-3",
  md: "h-10 px-4",
  lg: "h-11 px-5",
  icon: "size-10",
  "icon-sm": "size-9",
  "icon-xs": "size-7 rounded-md [&_svg]:size-3.5",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(buttonBase, buttonVariants[variant], variant === "link" ? "" : buttonSizes[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

/* ---------------------------------------------------------------- Form controls */
export const controlClass =
  "w-full rounded-[10px] border border-line-strong bg-surface px-3 text-sm text-text shadow-card transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-primary-solid focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-bad aria-invalid:focus-visible:ring-bad/25";

export function Input({ className, leading, ...props }: ComponentProps<"input"> & { leading?: ReactNode }) {
  if (!leading) return <input className={cn(controlClass, "h-10", className)} {...props} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted [&_svg]:size-4">{leading}</span>
      <input className={cn(controlClass, "h-10 pl-9", className)} {...props} />
    </div>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

/** Native select, styled: accessible, fast, works with forms and keyboard out of the box. */
export function Select({ className, children, compact, ...props }: ComponentProps<"select"> & { compact?: boolean }) {
  // Width classes go on the wrapper so the chevron stays at the control's edge.
  return (
    <div className={cn("relative", className)}>
      <select className={cn(controlClass, compact ? "h-8" : "h-10", "appearance-none pr-8")} {...props}>
        {children}
      </select>
      <svg aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" viewBox="0 0 16 16" fill="none">
        <path d="M4.5 6.5 8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input type="checkbox" className={cn("size-4 shrink-0 rounded border-line-strong accent-[var(--primary-solid)]", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-text", className)} {...props} />;
}

/**
 * Label + control + hint/error, wired for screen readers. Fields that can be
 * left empty say "optional"; everything else is expected.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  required,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string[] | string;
  optional?: boolean;
  /** A red * after the label (the field has to be filled in). */
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="flex items-baseline gap-1.5">
        {label}
        {required && !optional && (
          <span className="-ml-1 text-bad" aria-hidden>
            *
          </span>
        )}
        {optional && <span className="text-xs font-normal text-muted">optional</span>}
      </Label>
      {children}
      {message ? (
        <p id={`${htmlFor}-error`} className="text-xs text-bad">
          {message}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Card */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-2xl border border-line bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    // With a description and actions, a phone puts the actions under the text instead of squeezing it.
    <div className={cn("flex items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5", description && actions && "max-sm:flex-col max-sm:gap-2", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold text-text">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4 sm:p-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-line px-4 py-3 sm:px-5", className)} {...props} />;
}

/* ---------------------------------------------------------------- Page structure */

/**
 * Title row of every screen (design system: page header). Left: ← back link,
 * the title (22px) and its status badge, then one summary line (who · what ·
 * how much · how paid · who handles it). Right: the paper buttons (View /
 * Print, Download PDF), the page's ONE primary button — the next step — and
 * ⋯ more. There is a single `primary` slot on purpose: a page has at most one.
 * On a phone the paper buttons hide and the page passes them to ⋯ instead
 * (MoreMenu's `phoneItems`), so the row is the primary and ⋯.
 *
 * `actions` and `description` are the older form (a free row of buttons, a
 * line of text), kept for the pages not yet moved to the frame.
 */
/** The icon of each module (the menu's), shown in the title's tile when the page names no icon of its own. */
export const MODULE_ICONS: Record<string, LucideIcon> = {
  Dashboard: House,
  Overview: LayoutDashboard,
  "Public landing page": Globe,
  "Partners & CRM": Users,
  "Operations & trading": Package,
  "Revenue & profitability": TrendingUp,
  "Treasury & payments": Wallet,
  "Finance & general ledger": BookOpen,
  "System & admin": Settings,
};

export function PageHeader({
  title,
  icon,
  badge,
  summary,
  papers,
  views,
  primary,
  more,
  description,
  actions,
  backHref,
  backLabel,
  crumbs,
  phoneStack,
  children,
}: {
  title: ReactNode;
  /** The icon in the green tile before the title (default: the module's, from the crumbs; none without crumbs). */
  icon?: LucideIcon | null;
  /** Where the page is in the menu, above the title: "Dashboard / Finance / Cash book" (the last is this page). */
  crumbs?: { label: string; href?: string }[];
  /** On a phone, the buttons go under the title (record pages, whose names are long). */
  phoneStack?: boolean;
  /** The record's status (StatusBadge). */
  badge?: ReactNode;
  /** One line: who · what · how much · how paid · who handles it. */
  summary?: ReactNode;
  /** View / Print and Download PDF, where the page is a paper; hidden on a phone (put them in ⋯). */
  papers?: ReactNode;
  /** A switch between the page's views (Segmented: List · Board), before the primary. */
  views?: ReactNode;
  /** The one primary button: the next step. Leave it out when nothing is next. */
  primary?: ReactNode;
  /** The ⋯ menu (MoreMenu): everything else; delete last, in red. */
  more?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  const framed = badge !== undefined || summary !== undefined || primary !== undefined || papers !== undefined || more !== undefined || views !== undefined;
  const right = actions || papers || views || primary || more;
  const Icon = icon === null ? null : (icon ?? (crumbs?.[0] ? MODULE_ICONS[crumbs[0].label] : undefined));
  const trail = crumbs && crumbs.length > 0 ? (crumbs[0]!.label === "Dashboard" ? crumbs : [{ label: "Dashboard", href: "/dashboard" }, ...crumbs]) : null;
  return (
    <header className="mb-5">
      {trail && <Breadcrumb items={trail} />}
      {backHref && (
        <Link href={backHref} className="mb-1 inline-flex min-h-7 items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover">
          ← {backLabel ?? "Back"}
        </Link>
      )}
      <div className={cn("flex items-start justify-between gap-3", framed ? "sm:flex-wrap" : "flex-wrap", phoneStack && "max-sm:flex-col")}>
        <div className={cn("flex min-w-0 items-start gap-3", framed ? "flex-1 sm:flex-[1_1_18rem]" : "flex-[1_1_18rem]")}>
          {Icon && (
            <span data-slot="page-icon" className="mt-0.5 hidden size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary sm:grid" aria-hidden>
              <Icon className="size-[22px]" strokeWidth={2} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className={cn("font-bold tracking-tight text-text", framed ? "text-[22px] leading-7 sm:text-2xl" : "text-2xl leading-8 sm:text-[28px] sm:leading-9")}>{title}</h1>
              {badge}
            </div>
            {summary && <div className="mt-1 text-sm text-text-2">{summary}</div>}
            {description && <div className="mt-1 max-w-2xl text-sm text-muted">{description}</div>}
          </div>
        </div>
        {/* Papers first, then the one primary, then ⋯: always top right. */}
        {right && (
          <div className={cn("flex items-center gap-2", framed ? "shrink-0 sm:flex-wrap sm:justify-end" : "flex-wrap sm:justify-end")}>
            {actions}
            {papers && (
              <div data-slot="papers" className="flex items-center gap-2 max-sm:hidden">
                {papers}
              </div>
            )}
            {views}
            {primary && <div data-slot="primary" className="contents">{primary}</div>}
            {more}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

/** "Dashboard / Finance / Cash book" above a page's title: where it is in the menu. The last part is this page. */
export function Breadcrumb({ items, className }: { items: { label: string; href?: string }[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-1.5 text-[13px] text-muted", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-line-strong">
                  /
                </span>
              )}
              {c.href && !last ? (
                <Link href={c.href} className="font-medium text-primary hover:text-primary-hover hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className={cn(last ? "text-text-2" : "font-medium text-primary")} aria-current={last ? "page" : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Empty is a starting point: what goes here and the ONE way to add it (a single
 * `action`). `framed`: the dashed box of the design system, without the icon,
 * for an empty list inside a card.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  framed,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  framed?: boolean;
  className?: string;
}) {
  if (framed)
    return (
      <div className={cn("m-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary-line bg-primary-soft/40 px-6 py-8 text-center", className)}>
        <p className="text-sm font-semibold text-text">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-text-2">{description}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    );
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-text">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const ALERT_TONES = {
  info: { box: "border-info/25 bg-info-soft text-text", icon: Info, iconClass: "text-info" },
  error: { box: "border-bad/25 bg-bad-soft text-text", icon: AlertTriangle, iconClass: "text-bad" },
  success: { box: "border-ok/25 bg-ok-soft text-text", icon: CheckCircle2, iconClass: "text-ok" },
  warning: { box: "border-warn/25 bg-warn-soft text-text", icon: AlertTriangle, iconClass: "text-warn" },
};

export function Alert({ tone = "info", children, className }: { tone?: keyof typeof ALERT_TONES; children: ReactNode; className?: string }) {
  const t = ALERT_TONES[tone];
  const Icon = t.icon;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm", t.box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", t.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A problem or a note on the page, shown in the card it concerns (not at the
 * top of the page): the Alert in the design system's meanings.
 */
export function Banner({ meaning = "info", children, className }: { meaning?: "info" | "ok" | "warn" | "bad"; children: ReactNode; className?: string }) {
  const tone = meaning === "ok" ? "success" : meaning === "warn" ? "warning" : meaning === "bad" ? "error" : "info";
  return (
    <Alert tone={tone} className={className}>
      {children}
    </Alert>
  );
}

/* ---------------------------------------------------------------- Table */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    // Focusable so a keyboard can scroll a wide table sideways; the edge with more fades on a phone.
    <ScrollFade className="w-full overflow-x-auto focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none" tabIndex={0}>
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </ScrollFade>
  );
}
export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-surface-2/70", className)} {...props} />;
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  // relative: a hidden (sr-only) name inside is placed in its cell, so a table that scrolls
  // sideways keeps it in its box instead of widening the page.
  return <th scope="col" className={cn("relative h-10 border-b border-line px-3 text-left text-xs font-semibold whitespace-nowrap text-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", className)} {...props} />;
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("h-13 border-b border-line px-3 align-middle text-text first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5", className)} {...props} />;
}
export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("transition-colors last:[&>td]:border-b-0", className)} {...props} />;
}

/**
 * A list row that opens its record (inside the app's DataTable): a click
 * anywhere on it goes to `href` (Ctrl/⌘-click: a new tab), the row lights on
 * hover, and its first cell should hold a real link to the same place for the
 * keyboard (Enter) and screen readers. `flash`: just saved, lit for 2 seconds.
 */
export function DataRow({ href, flash, className, ...props }: ComponentProps<"tr"> & { href: string; flash?: boolean }) {
  return (
    <tr
      data-href={href}
      data-flash={flash ? "" : undefined}
      className={cn("group cursor-pointer transition-colors last:[&>td]:border-b-0 hover:bg-primary-soft/60", flash && "animate-flash", className)}
      {...props}
    />
  );
}

/**
 * A list on a phone (design system: tables become rows), shown below 640px in
 * place of the DataTable: one PhoneRow per record.
 */
export function PhoneList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ul aria-label={label} className={cn("divide-y divide-line sm:hidden", className)}>
      {children}
    </ul>
  );
}

/**
 * One record on a phone: its name, one line under it, and on the right its
 * status (StatusBadge) over the key number. The whole row opens the record.
 */
export function PhoneRow({
  href,
  title,
  line,
  status,
  figure,
  flash,
  muted,
  prefetch,
  extra,
}: {
  /** Where the row goes; without it the row is plain (a record with no page). */
  href?: string;
  /** false: never fetched ahead (a link that does something when opened). */
  prefetch?: boolean;
  title: ReactNode;
  line?: ReactNode;
  status?: ReactNode;
  figure?: ReactNode;
  flash?: boolean;
  muted?: boolean;
  /** Under the row, outside its link (e.g. a "Show changes" disclosure). */
  extra?: ReactNode;
}) {
  const hasFigure = figure !== undefined && figure !== null && figure !== "";
  const inner = (
    <>
      <span className="min-w-0">
        <span className={cn("block truncate text-sm font-semibold", muted && "text-text-2")}>{title}</span>
        {line && <span className="block truncate text-xs text-text-2">{line}</span>}
      </span>
      {(status || hasFigure) && (
        <span className="flex shrink-0 flex-col items-end gap-1 text-right text-xs text-text-2 tabular">
          {status}
          {hasFigure && <span className="block">{figure}</span>}
        </span>
      )}
    </>
  );
  const cls = "flex items-start justify-between gap-3 px-4 py-3";
  return (
    <li className={flash ? "animate-flash" : undefined}>
      {href ? (
        <Link href={href} prefetch={prefetch} className={cn(cls, "active:bg-surface-2")}>
          {inner}
        </Link>
      ) : (
        <div className={cls}>{inner}</div>
      )}
      {extra && <div className="-mt-1.5 px-4 pb-3">{extra}</div>}
    </li>
  );
}

/* ---------------------------------------------------------------- Detail list */

/** Label/value grid for detail panels. */
export function DetailList({ items, columns = 2, className }: { items: { label: ReactNode; value: ReactNode; hidden?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", columns === 1 ? "grid-cols-1" : columns === 3 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-1 sm:grid-cols-2", className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i, idx) => (
          <div key={idx} className="min-w-0">
            <dt className="text-xs text-muted">{i.label}</dt>
            <dd className="mt-0.5 text-sm break-words text-text">{i.value ?? "—"}</dd>
          </div>
        ))}
    </dl>
  );
}

/* ---------------------------------------------------------------- Small bits */

export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-medium text-primary before:content-[attr(data-initials)]", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      // Drawn by CSS, not as text: inside a named button ("Account") the letters would be words
      // in its name that are not part of the name.
      data-initials={initials || "?"}
      aria-hidden
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 items-center rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

/** Sub-tabs as chips (the page's sections), as links: URL-driven, so they work without JavaScript. The current one is soft green. */
export function LinkTabs({ tabs, className, label }: { tabs: { href: string; label: ReactNode; count?: number; active: boolean; alert?: boolean }[]; className?: string; label: string }) {
  return (
    <ScrollFade
      as="nav"
      aria-label={label}
      className={cn("-mx-4 flex items-center gap-2 overflow-x-auto overflow-y-hidden px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0.5 [&::-webkit-scrollbar]:hidden", className)}
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4",
            t.active ? "border-primary-line bg-primary-soft font-semibold text-primary" : "border-line bg-surface text-text-2 hover:border-line-strong hover:text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn("rounded-md px-1.5 text-xs tabular", t.alert ? "bg-bad-soft font-semibold text-bad" : t.active ? "bg-surface text-primary" : "bg-surface-2 text-text-2")}>{t.count}</span>
          )}
        </Link>
      ))}
    </ScrollFade>
  );
}

/** The strip above a table: search on the left, filter chips, extras on the right. */
export function FilterBar({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 border-b border-line px-4 py-3", className)}>
      {children}
      {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
    </div>
  );
}

/**
 * A filter chip that is a link: dashed when off, tinted when on. `pill`: the
 * list toolbar's round chip with its count ("Overdue 2"), ringed when on.
 */
export function FilterChip({ href, active, count, pill, children }: { href: string; active: boolean; count?: number; pill?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        pill
          ? "inline-flex h-9 shrink-0 items-center gap-1 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-medium whitespace-nowrap text-text transition-colors hover:bg-surface-2"
          : buttonClass("secondary", "sm"),
        !pill && "h-8 gap-1 border-dashed px-2.5 text-xs",
        active &&
          (pill
            ? "border-primary-line bg-primary-soft font-semibold text-primary hover:bg-primary-soft"
            : "border-solid border-primary/40 bg-primary-soft text-primary hover:bg-primary-soft"),
      )}
    >
      {children}
      {count !== undefined && <span className={cn("tabular", active ? "font-semibold" : "text-text-2")}>{count}</span>}
    </Link>
  );
}

export interface ListChip {
  key: string;
  label: ReactNode;
  count?: number;
  href: string;
  active: boolean;
}

/**
 * The row above every list (design system: List frame): search, the filter
 * chips with their counts, and on the right the list's Excel — in one row; on
 * a phone the search takes the width and the chips scroll sideways. The search
 * is a GET form that keeps the other filters (`keep`), so the URL holds them all.
 */
export function ListToolbar({
  search,
  keep = {},
  chips = [],
  filters,
  end,
  label = "Filters",
  className,
}: {
  search?: { placeholder: string; value?: string; clearHref?: string; label?: string; name?: string };
  /** The list's other filters, carried by the search form (page is dropped: a new search starts at page 1). */
  keep?: Record<string, string | undefined>;
  chips?: ListChip[];
  /** After the chips: a filter you add ("+ Country", a select), drawn as a chip. */
  filters?: ReactNode;
  /** The list's Excel (export what the filters show). */
  end?: ReactNode;
  label?: string;
  className?: string;
}) {
  const name = search?.name ?? "q";
  return (
    <div data-slot="list-toolbar" className={cn("mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-3 shadow-card", className)}>
      {search && (
        <form role="search" aria-label={search.label ?? "Search this list"} className="w-full sm:w-auto">
          {Object.entries(keep).map(([k, v]) => (v && k !== name && k !== "page" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
          <SearchField defaultValue={search.value} placeholder={search.placeholder} clearHref={search.clearHref} label={search.label} className="h-10 sm:w-80 [&_input]:h-10" />
          <button className="sr-only">Search</button>
        </form>
      )}
      {(chips.length > 0 || filters || end) && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {(chips.length > 0 || filters) && (
            <ScrollFade
              as="nav"
              aria-label={label}
              className="-mx-3 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-3 py-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0.5 [&::-webkit-scrollbar]:hidden"
            >
              {chips.map((c) => (
                <FilterChip key={c.key} href={c.href} active={c.active} count={c.count} pill>
                  {c.label}
                </FilterChip>
              ))}
              {filters && (
                <div className="flex shrink-0 items-center gap-1.5 [&_select]:h-9 [&_select]:rounded-[10px] [&_select]:border-line-strong [&_select]:text-[13px] [&_select]:font-medium [&_select]:shadow-none">
                  {filters}
                </div>
              )}
            </ScrollFade>
          )}
          {end && <div className="ml-auto flex shrink-0 items-center gap-2">{end}</div>}
        </div>
      )}
    </div>
  );
}

/** Pill links for a small set of options (e.g. This month / Last month). */
export function Segmented({ options, className, label }: { options: { href: string; label: ReactNode; active: boolean }[]; className?: string; label: string }) {
  return (
    <ScrollFade
      as="nav"
      aria-label={label}
      className={cn("inline-flex max-w-full overflow-x-auto rounded-[10px] border border-line bg-surface-2 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          aria-current={o.active ? "page" : undefined}
          className={cn("inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium whitespace-nowrap text-muted transition-colors hover:text-text", o.active && "bg-surface font-semibold text-primary shadow-card")}
        >
          {o.label}
        </Link>
      ))}
    </ScrollFade>
  );
}

/** Search box for a FilterBar (GET form field; Enter submits). */
export function SearchField({ defaultValue, placeholder, clearHref, label = "Search", className }: { defaultValue?: string; placeholder: string; clearHref?: string; label?: string; className?: string }) {
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <label htmlFor="search" className="sr-only">
        {label}
      </label>
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input id="search" name="q" type="search" defaultValue={defaultValue} placeholder={placeholder} className={cn(controlClass, "h-9 pr-8 pl-9 [&::-webkit-search-cancel-button]:appearance-none")} />
      {defaultValue && clearHref && (
        <Link href={clearHref} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-text" aria-label="Clear search">
          <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </Link>
      )}
    </div>
  );
}

