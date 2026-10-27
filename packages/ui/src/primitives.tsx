import Link from "next/link";
import { ScrollFade } from "./scroll-fade";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Inbox, type LucideIcon } from "lucide-react";
import { cn } from "./cn";

/* ---------------------------------------------------------------- Button */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost" | "trust" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-xs";

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary-solid text-primary-fg shadow-card hover:bg-primary-solid-hover",
  secondary: "border border-line bg-surface text-text shadow-card hover:bg-surface-2",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
  danger: "bg-bad-solid text-white shadow-card hover:opacity-90",
  "danger-ghost": "text-bad hover:bg-bad-soft",
  trust: "bg-trust text-white shadow-card hover:opacity-90 dark:text-bg",
  link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
};
const buttonSizes: Record<ButtonSize, string> = {
  xs: "h-7 rounded-md px-2 text-xs [&_svg]:size-3.5",
  sm: "h-8 px-3",
  md: "h-9 px-3.5",
  lg: "h-10 px-4",
  icon: "size-9",
  "icon-sm": "size-8",
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
  "w-full rounded-lg border border-line bg-surface px-3 text-sm text-text shadow-card transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-bad aria-invalid:focus-visible:ring-bad/25";

export function Input({ className, leading, ...props }: ComponentProps<"input"> & { leading?: ReactNode }) {
  if (!leading) return <input className={cn(controlClass, "h-9", className)} {...props} />;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted [&_svg]:size-4">{leading}</span>
      <input className={cn(controlClass, "h-9 pl-9", className)} {...props} />
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
      <select className={cn(controlClass, compact ? "h-8" : "h-9", "appearance-none pr-8")} {...props}>
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
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string[] | string;
  optional?: boolean;
  /** Kept for readability at call sites; required fields carry no marker. */
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="flex items-baseline gap-1.5">
        {label}
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
  return <section className={cn("rounded-xl border border-line bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    // With a description and actions, a phone puts the actions under the text instead of squeezing it.
    <div className={cn("flex items-start justify-between gap-3 border-b border-line px-4 py-3", description && actions && "max-sm:flex-col max-sm:gap-2", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-line px-4 py-3", className)} {...props} />;
}

/* ---------------------------------------------------------------- Page structure */

/** Title row of every screen: back link, title, one-line description, actions. */
export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {backHref && (
        <Link href={backHref} className="mb-1 inline-flex min-h-7 items-center gap-1 text-xs font-medium text-muted hover:text-text">
          ← {backLabel ?? "Back"}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
          {description && <div className="mt-1 max-w-2xl text-sm text-muted">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-text">{title}</p>
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
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", t.box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", t.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
  return <thead className={cn("bg-surface-2/60", className)} {...props} />;
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  return <th scope="col" className={cn("h-9 border-b border-line px-3 text-left text-xs font-medium whitespace-nowrap text-muted first:pl-4 last:pr-4", className)} {...props} />;
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("h-12 border-b border-line px-3 align-middle text-text first:pl-4 last:pr-4", className)} {...props} />;
}
export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("transition-colors last:[&>td]:border-b-0", className)} {...props} />;
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
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft font-medium text-primary", className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 items-center rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

/** Underlined tabs as links (URL-driven, so they work without JavaScript). */
export function LinkTabs({ tabs, className, label }: { tabs: { href: string; label: ReactNode; count?: number; active: boolean; alert?: boolean }[]; className?: string; label: string }) {
  return (
    <ScrollFade
      as="nav"
      aria-label={label}
      className={cn("flex items-center gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-text",
            t.active && "border-primary text-text",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn("rounded px-1.5 text-xs tabular", t.alert ? "bg-bad-soft font-semibold text-bad" : "bg-surface-3 text-text-2")}>{t.count}</span>
          )}
        </Link>
      ))}
    </ScrollFade>
  );
}

/** The strip above a table: search on the left, filter chips, extras on the right. */
export function FilterBar({ children, end, className }: { children: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5", className)}>
      {children}
      {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
    </div>
  );
}

/** A filter chip that is a link: dashed when off, tinted when on. */
export function FilterChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        buttonClass("secondary", "sm"),
        "h-8 gap-1 border-dashed px-2.5 text-xs",
        active && "border-solid border-primary/40 bg-primary-soft text-primary hover:bg-primary-soft",
      )}
    >
      {children}
    </Link>
  );
}

/** Pill links for a small set of options (e.g. This month / Last month). */
export function Segmented({ options, className, label }: { options: { href: string; label: ReactNode; active: boolean }[]; className?: string; label: string }) {
  return (
    <ScrollFade
      as="nav"
      aria-label={label}
      className={cn("inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
    >
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          aria-current={o.active ? "page" : undefined}
          className={cn("inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted transition-colors hover:text-text", o.active && "bg-surface text-text shadow-card")}
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
      <input id="search" name="q" type="search" defaultValue={defaultValue} placeholder={placeholder} className={cn(controlClass, "h-8 pr-8 pl-9 [&::-webkit-search-cancel-button]:appearance-none")} />
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

