import Form from "next/form";
import Link from "next/link";
import { BackArrow, ListLink } from "./back";
import { Pending } from "./pending";
import { ScrollFade } from "./scroll-fade";
import type { ComponentProps, ReactNode } from "react";
import { Filter, House, Info, Package, Settings, ShieldCheck, ShoppingCart, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "./cn";

/* ---------------------------------------------------------------- Button */
export type ButtonVariant = "primary" | "strong" | "soft" | "brand" | "secondary" | "ghost" | "danger" | "danger-ghost" | "danger-line" | "trust" | "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-xs";

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] text-sm font-semibold whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const buttonVariants: Record<ButtonVariant, string> = {
  /* The page's one main action: orange. */
  primary: "bg-action-solid text-white shadow-card hover:bg-action-solid-hover",
  /* The one button that finishes the job (design rules 18 Nov): orange, bold, a light glow. One per screen. */
  strong: "bg-action-solid font-bold text-white shadow-[0_6px_16px_rgba(194,81,10,0.28)] hover:bg-action-solid-hover",
  /* A step forward that is not the finish (Next): light orange, so the strong button stays the one that stands out. */
  soft: "border border-action/20 bg-action-soft text-action hover:border-action/45",
  /* Green: the brand, for a second positive action beside the orange one (Save draft). */
  brand: "bg-primary-solid text-primary-fg shadow-card hover:bg-primary-solid-hover",
  secondary: "border border-line-strong bg-surface text-text shadow-card hover:bg-surface-2",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
  danger: "bg-bad-solid text-white shadow-card hover:opacity-90",
  "danger-ghost": "text-bad hover:bg-bad-soft",
  /* Discard, Delete beside a strong button: red words in a white box. */
  "danger-line": "border border-bad/30 bg-surface text-bad hover:bg-bad-soft",
  trust: "bg-trust text-white shadow-card hover:opacity-90 dark:text-bg",
  link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
};
/**
 * Compact everywhere (asked 17 Nov: buttons took too much room on a phone): on a phone a size steps down one
 * notch, and on a touch screen nothing is under 32 px each way, above WCAG 2.2's 24 px (2.5.8).
 */
const buttonSizes: Record<ButtonSize, string> = {
  xs: "h-7 rounded-lg px-2 text-xs [&_svg]:size-3.5 pointer-coarse:h-8 pointer-coarse:min-w-8 pointer-coarse:px-2.5",
  sm: "h-9 px-3 text-[13px] max-sm:h-8 max-sm:px-2.5",
  md: "h-10 px-3.5 max-sm:h-9 max-sm:px-3 max-sm:text-[13px]",
  lg: "h-11 px-5",
  icon: "size-10 max-sm:size-9",
  "icon-sm": "size-9 max-sm:size-8",
  "icon-xs": "size-7 rounded-md [&_svg]:size-3.5 pointer-coarse:size-8",
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
  // A file (Excel export, PDF, a print or a download) is made only when clicked: never fetched ahead (a prefetch
  // of an export built the whole file on every visit to the list).
  const file = typeof props.href === "string" && /^\/(sheets|files|pdf|print|api)\//.test(props.href);
  return <Link className={buttonClass(variant, size, className)} {...(file && props.prefetch === undefined ? { prefetch: false } : {})} {...props} />;
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
/* ---------------------------------------------------------------- HowMade */

/** An id from the figure's name and rule: the same on the server and in the browser, different for each figure. */
function howId(title: string, rule: string) {
  let h = 5381;
  for (const ch of `${title}|${rule}`) h = (Math.imul(h, 33) ^ ch.charCodeAt(0)) >>> 0;
  return `how-${h.toString(36)}`;
}

/**
 * A figure's ⓘ: what it counts, from where and at which rate, in plain words, so a number can be trusted and
 * checked. Opens a short note over the page with the browser's own popover (a click outside, Esc or Close shuts
 * it; no script). `rule`: the caller's words, a new paragraph on each new line.
 */
export function HowMade({ title, rule, className }: { title: string; rule: string; className?: string }) {
  const id = howId(title, rule);
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={`How ${title} is worked out`}
        className={cn("tap no-print inline-grid size-6 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text", className)}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      {/* Centred over the page (m-auto: Tailwind's reset takes away the browser's own margin for popovers). */}
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        className="m-auto w-[min(calc(100vw-2rem),27rem)] rounded-2xl border border-line bg-surface p-4 text-left text-sm leading-relaxed font-normal text-text-2 shadow-pop backdrop:bg-black/25 sm:p-5"
      >
        <p id={`${id}-title`} className="text-base font-bold text-text">
          {title}
        </p>
        <p className="mt-0.5 text-xs text-muted">How it is worked out</p>
        <div className="mt-3 flex flex-col gap-2">
          {rule.split("\n").map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" popoverTarget={id} popoverTargetAction="hide" className={buttonClass("secondary", "sm")}>
            Close
          </button>
        </div>
      </div>
    </>
  );
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-2xl border border-line bg-surface", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  how,
  howTitle,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** How the card's figures are worked out, behind an ⓘ beside the title (HowMade). */
  how?: string;
  /** The ⓘ note's heading when the title is not plain text. */
  howTitle?: string;
}) {
  const heading = <h2 className="text-base font-bold text-text">{title}</h2>;
  return (
    // With a description and actions, a phone puts the actions under the text instead of squeezing it; actions
    // that do not fit beside the title (a narrow screen) go under it rather than past the edge.
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5", description && actions && "max-sm:flex-col max-sm:items-start max-sm:gap-2", className)}>
      <div className="min-w-0">
        {how ? (
          <div className="flex items-center gap-1">
            {heading}
            <HowMade title={howTitle ?? (typeof title === "string" ? title : "These figures")} rule={how} />
          </div>
        ) : (
          heading
        )}
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      {/* Never wider than the card: on a small screen the buttons wrap among themselves. */}
      {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
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
/** The icon of each group of the menu, shown in the title's tile when the page names no icon of its own. */
export const MODULE_ICONS: Record<string, LucideIcon> = {
  Home: House,
  Sales: Package,
  Purchasing: ShoppingCart,
  Money: Wallet,
  Reports: TrendingUp,
  Settings: Settings,
  "Company settings": Settings,
  "Admin settings": ShieldCheck,
};

/**
 * A record's one strong button on a phone (canvas row "Every page's top on a phone", option A): pinned at the
 * bottom, at the thumb, full width and 48 tall (design rule 10), in the place of the app's bottom bar, which steps
 * aside while it is there (globals.css). With nothing in it (no next step) it is not there and the bar stays.
 */
const DOCK =
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:flex max-md:gap-2 max-md:border-t max-md:border-line max-md:bg-surface max-md:px-3 max-md:pt-2 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-md:shadow-[0_-4px_12px_rgb(0_0_0/0.06)] max-md:[&:not(:has(a,button))]:hidden max-md:[&>*]:min-w-0 max-md:[&>*]:flex-1 max-md:[&_:is(a,button)]:h-12 max-md:[&_:is(a,button)]:w-full max-md:[&_:is(a,button)]:justify-center max-md:[&_:is(a,button)]:text-[15px]";

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
  back,
  crumbs,
  phoneStack,
  record,
  children,
}: {
  /** The page's name: a record's is a name from its data, never its number (RECORD_TITLE in @kebo/shared). */
  title: ReactNode;
  /**
   * Where ← beside the title goes (a deeper page: a record, a page under one). By default the last link in the
   * path ("Inquiries" for an inquiry); false: none. A list and Home have none: they are the top.
   */
  back?: { href: string; label: string; root?: string } | false;
  /** The icon in the green tile before the title (default: the module's, from the crumbs; none without crumbs). */
  icon?: LucideIcon | null;
  /** Where the page is in the menu, above the title: "Money / Cash & bank" (the last is this page). */
  crumbs?: { label: string; href?: string }[];
  /** On a phone, the buttons go under the title (record pages, whose names are long). */
  phoneStack?: boolean;
  /**
   * What the record is and its number ("Inquiry", "RFQ-2026-0010"): the small line under its name in the phone's
   * top bar (canvas row "Every page's top on a phone"). Without it the bar says where ← goes.
   */
  record?: { kind: string; number?: string | null };
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
  // The path is the menu's two levels (and the record, on a record's page): "Sales / Inquiries / RFQ-2026-0001".
  const trail = crumbs && crumbs.length > 0 ? crumbs : null;
  // A deeper page goes up to the last link in its path (or where it says), with ← beside its title.
  const parent = trail?.slice(0, -1).reverse().find((c) => c.href);
  const up = back === false ? null : (back ?? (backHref ? { href: backHref, label: backLabel ?? "Back" } : parent?.href ? { href: parent.href, label: parent.label } : null));
  // The page's name in words (its title; a title that is not plain words falls back to the path's last part), as
  // the phone's top bar says it and Back says it from the pages opened from here ("Back to Kabul Medical Supplies").
  // (A list keeps its menu name for Back: "Back to Orders".)
  const named = typeof title === "string" ? title : undefined;
  const name = up ? (named ?? trail?.at(-1)?.label) : (trail?.at(-1)?.label ?? named);
  // Phone: the top bar says the name, so the big title is only read out (still the page's heading).
  const titleInBar = !!named && (!!up || !!trail);
  const under = record ? [record.kind, record.number].filter(Boolean).join(" · ") : up?.label;
  return (
    <>
      {up && (
        // Phone: the top bar becomes the way back, with the record's name and what it is under; ⋯ beside it.
        <>
          <div aria-hidden className="h-14 md:hidden" />
          <div data-record-bar="" className="no-print fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-1 border-b border-line bg-surface pr-1.5 pl-1 md:hidden">
            <BackArrow up={up.href} label={up.label} root={up.root} bar />
            <div className="min-w-0 flex-1 pl-0.5">
              <p className="truncate text-[16.5px] leading-5 font-bold text-text">{name ?? title}</p>
              <p className="truncate text-[12px] leading-4 font-medium text-muted">{under}</p>
            </div>
            {/* ⋯ as a plain icon here, the size of ← (it is a bordered button in the header). */}
            {more && <div className="shrink-0 [&>button]:size-11 [&>button]:rounded-full [&>button]:border-transparent [&>button]:bg-transparent [&>button]:shadow-none">{more}</div>}
          </div>
        </>
      )}
      {!up && titleInBar && (
        // A top page (a list, a settings page) on a phone: its name in the app's top bar, where the app's name was
        // (globals.css hides that while this is on the page), and its ⋯ at the bar's end; the menu, search and
        // alerts stay around them.
        <div data-page-title="" className="no-print pointer-events-none fixed top-0 right-36 left-14 z-30 flex h-14 items-center gap-1 md:hidden">
          <span aria-hidden className="min-w-0 flex-1 truncate text-[17px] leading-5 font-bold text-text">
            {named}
          </span>
          {more && <div className="pointer-events-auto shrink-0 [&>button]:size-10 [&>button]:rounded-full [&>button]:border-transparent [&>button]:bg-transparent [&>button]:shadow-none">{more}</div>}
        </div>
      )}
      <header className="mb-4" data-page-label={name}>
        {trail && <Breadcrumb items={trail} className={up || titleInBar ? "max-md:hidden" : undefined} />}
        {/* phoneStack: one column on a phone, each row the screen's width. (Not a wrapping column: some phone
            browsers then size the title to its text, so a long line runs past the screen and the page zooms out.) */}
        <div className={cn("flex items-start justify-between gap-3", framed ? "sm:flex-wrap" : "flex-wrap", phoneStack && "max-sm:flex-col max-sm:flex-nowrap max-sm:items-stretch")}>
          <div className={cn("flex min-w-0 items-start gap-3", framed ? "flex-1 sm:flex-[1_1_18rem]" : "flex-[1_1_18rem]", phoneStack && "max-sm:w-full max-sm:flex-none")}>
            {up ? (
              <BackArrow up={up.href} label={up.label} root={up.root} className="max-md:hidden" />
            ) : (
              Icon && (
                <span data-slot="page-icon" className="mt-0.5 hidden size-11 shrink-0 place-items-center rounded-xl bg-primary-solid text-white sm:grid" aria-hidden>
                  <Icon className="size-[22px]" strokeWidth={2} />
                </span>
              )
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className={cn("font-bold text-text", framed ? "text-[22px] leading-7 sm:text-[26px] sm:leading-8" : "text-2xl leading-8 sm:text-[26px] sm:leading-8", titleInBar && "max-md:sr-only")}>
                  {title}
                </h1>
                {badge}
              </div>
              {/* A top page's plain sentence under its name is a help line: not on a phone (design rule 15). */}
              {summary && <div className={cn("mt-0.5 text-[13px] text-muted", !up && titleInBar && typeof summary === "string" && "max-md:hidden")}>{summary}</div>}
              {description && <div className={cn("mt-0.5 max-w-2xl text-[13px] text-muted", titleInBar && "max-md:hidden")}>{description}</div>}
            </div>
          </div>
          {/* Papers first, then the one primary, then ⋯: always top right. */}
          {right && (
            // On a record's page on a phone the buttons leave this row (papers and ⋯ to the bar, the one strong
            // button to the bottom), so the row itself makes no room.
            <div className={cn("flex items-center gap-2", framed ? "shrink-0 sm:flex-wrap sm:justify-end" : "flex-wrap sm:justify-end", up && !actions && !views && "max-md:contents")}>
              {actions}
              {papers && (
                <div data-slot="papers" className="flex items-center gap-2 max-sm:hidden">
                  {papers}
                </div>
              )}
              {views}
              {primary && (
                <div data-slot="primary" data-record-dock={up ? "" : undefined} className={cn("contents", up && DOCK)}>
                  {primary}
                </div>
              )}
              {more && (up || titleInBar) ? <div className="contents max-md:hidden">{more}</div> : more}
            </div>
          )}
        </div>
        {children}
      </header>
    </>
  );
}

/** "Money / Cash & bank" above a page's title: where it is in the menu. The last part is this page. */
export function Breadcrumb({ items, className }: { items: { label: string; href?: string }[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("mb-2 text-xs font-medium text-muted", className)}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-muted">
                  /
                </span>
              )}
              {c.href && !last ? (
                // A list opens as it was left: its search, filters and page.
                <ListLink href={c.href} className="tap text-primary hover:text-primary-hover hover:underline">
                  {c.label}
                </ListLink>
              ) : (
                <span className={cn(last ? "text-muted" : "text-primary")} aria-current={last ? "page" : undefined}>
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
  icon: Icon = Package,
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
  // Board "Empty list": the same look in a card or on its own (`framed` is kept for the callers).
  void framed;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2.5 px-6 py-12 text-center", className)}>
      <div className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="text-base font-bold text-text">{title}</p>
      {description && <p className="max-w-[420px] text-sm text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

const ALERT_TONES = {
  info: "bg-info-soft text-info",
  error: "bg-bad-soft text-bad",
  success: "bg-ok-soft text-ok",
  warning: "bg-warn-soft text-warn",
  neutral: "bg-surface-2 text-text-2 [&_strong]:text-text",
};

export function Alert({ tone = "info", children, className }: { tone?: keyof typeof ALERT_TONES; children: ReactNode; className?: string }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-xl px-3.5 py-3 text-[13px] [&_strong]:font-bold", ALERT_TONES[tone], className)}>
      {children}
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
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </ScrollFade>
  );
}
export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-faint", className)} {...props} />;
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  // relative: a hidden (sr-only) name inside is placed in its cell, so a table that scrolls
  // sideways keeps it in its box instead of widening the page.
  return <th scope="col" className={cn("relative h-[42px] border-b border-line px-3.5 text-left text-[13px] font-semibold whitespace-nowrap text-muted", className)} {...props} />;
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("h-[52px] border-b border-line px-3.5 py-3 align-middle text-text", className)} {...props} />;
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

/** A record's number (SO-2026-0035, RFQ-2026-0058) as the grey monospace chip of the tables; a link when given `href`. */
export function RefCode({ children, href, className }: { children: ReactNode; href?: string; className?: string }) {
  const cls = cn("inline-block rounded-md bg-surface-2 px-[7px] py-0.5 font-mono text-xs font-semibold whitespace-nowrap text-text-2", href && "hover:text-primary", className);
  return href ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 items-center rounded border border-line bg-surface-2 px-1.5 font-mono text-[11px] text-muted">{children}</kbd>;
}

/** Sub-tabs as chips (the page's sections), as links: URL-driven, so they work without JavaScript. The current one is soft green. */
export function LinkTabs({
  tabs,
  className,
  label,
  replace,
  look = "chips",
}: {
  tabs: { href: string; label: ReactNode; count?: number; active: boolean; alert?: boolean }[];
  className?: string;
  label: string;
  /** Switch in place (no new history step): tabs inside a window. */
  replace?: boolean;
  /**
   * "tabs" (design "list pages" 18 Nov: a list's stages): on a laptop underlined tabs like a record's, with their
   * counts; on a phone round chips that slide sideways. "chips": chips everywhere.
   */
  look?: "chips" | "tabs";
}) {
  const tabsLook = look === "tabs";
  return (
    <ScrollFade
      as="nav"
      aria-label={label}
      className={cn(
        "-mx-4 flex items-center gap-2 overflow-x-auto overflow-y-hidden px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0.5 [&::-webkit-scrollbar]:hidden",
        tabsLook && "sm:items-stretch sm:gap-x-[22px] sm:border-b sm:border-line sm:px-0 sm:py-0",
        className,
      )}
    >
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          replace={replace}
          scroll={replace ? false : undefined}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-medium whitespace-nowrap transition-colors [&_svg]:size-4",
            t.active ? "border-primary-line bg-primary-soft font-semibold text-primary" : "border-line bg-surface text-text-2 hover:border-line-strong hover:text-text",
            tabsLook && "max-sm:rounded-full max-sm:text-[13.5px] max-sm:font-semibold",
            tabsLook &&
              (t.active
                ? "sm:-mb-px sm:h-[42px] sm:rounded-none sm:border-0 sm:border-b-2 sm:border-primary-solid sm:bg-transparent sm:px-0 sm:text-[13.5px] sm:font-bold sm:text-text"
                : "sm:-mb-px sm:h-[42px] sm:rounded-none sm:border-0 sm:border-b-2 sm:border-transparent sm:bg-transparent sm:px-0 sm:text-[13.5px] sm:font-medium sm:text-text-2 sm:hover:text-text"),
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn("tabular", tabsLook && "text-xs font-semibold", t.alert && "rounded-md bg-bad-soft px-1.5 font-semibold text-bad")}>{t.count}</span>
          )}
          <Pending />
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
          ? "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3 text-[13px] font-medium whitespace-nowrap text-text transition-colors hover:bg-surface-2"
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
 * The filters above a list (design system: List frame), drawn the same as every list's: the chips (tabs with
 * their counts) on their own row, then the white filter strip with the search taking the width, the list's
 * other filters and Filter, and on the right the list's Excel. The search is a GET form that keeps the other
 * filters (`keep`), so the URL holds them all. Inside a card (`inCard`) the chips sit in a row with a rule under it.
 */
export function ListToolbar({
  search,
  keep = {},
  chips = [],
  filters,
  end,
  label = "Filters",
  className,
  inCard,
}: {
  search?: { placeholder: string; value?: string; clearHref?: string; label?: string; name?: string };
  /** The list's other filters, carried by the search form (page is dropped: a new search starts at page 1). */
  keep?: Record<string, string | undefined>;
  chips?: ListChip[];
  /** After the search: the list's other filters (selects). */
  filters?: ReactNode;
  /** The list's Excel (export what the filters show). */
  end?: ReactNode;
  label?: string;
  className?: string;
  /** Inside a card: the chips and the end in one row with a rule under it, no strip. */
  inCard?: boolean;
}) {
  const name = search?.name ?? "q";
  const tabs = chips.map((c) => ({ href: c.href, label: c.label, count: c.count, active: c.active }));
  if (inCard) {
    return (
      <div data-slot="list-toolbar" className={cn("flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5", className)}>
        {tabs.length > 0 && <LinkTabs label={label} tabs={tabs} className="min-w-0 flex-1" />}
        {end && <div className="ml-auto flex shrink-0 items-center gap-2">{end}</div>}
      </div>
    );
  }
  return (
    <div data-slot="list-toolbar" className={className}>
      {tabs.length > 0 && <LinkTabs label={label} tabs={tabs} className="mb-4" />}
      {(search || filters || end) && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[14px] border border-line bg-surface p-3">
          {search && (
            <Form action="" scroll={false} role="search" aria-label={search.label ?? "Search this list"} className="flex min-w-0 flex-[1_1_260px] items-center gap-2.5">
              {Object.entries(keep).map(([k, v]) => (v && k !== name && k !== "page" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
              <SearchField defaultValue={search.value} placeholder={search.placeholder} clearHref={search.clearHref} label={search.label} className="min-w-0 flex-1" />
              <button type="submit" className={buttonClass("secondary", "md", "shrink-0")}>
                <Filter aria-hidden />
                Filter
              </button>
            </Form>
          )}
          {filters && <div className="flex flex-wrap items-center gap-2.5">{filters}</div>}
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
      <input id="search" name="q" type="search" defaultValue={defaultValue} placeholder={placeholder} className={cn(controlClass, "h-10 pr-8 pl-9 [&::-webkit-search-cancel-button]:appearance-none")} />
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

