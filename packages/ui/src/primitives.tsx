
import Link from "next/link";
import { BackArrow, ListLink } from "./back";
import { Pending } from "./pending";
import { ScrollFade } from "./scroll-fade";
import type { ComponentProps, ReactNode } from "react";
import { House, Info, Package, Settings, ShieldCheck, ShoppingCart, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "./cn";

/* ---------------------------------------------------------------- Button */
/**
 * The one button (canvas "RFQ Desk — the pieces", board "The one button: seven kinds, three sizes, every state").
 * Kinds, each one job:
 *   strong    the page's one next step (orange, bold, a glow) — one per screen; on a phone pinned at the bottom
 *   primary   Main: the one way to finish a window — Save, Send, Record (green)
 *   soft      a step forward that is not the finish: Next in a steps window
 *   secondary Plain: every other act — + Add, Send request, View, Cancel
 *   ghost     Quiet: a box's own ✎ Edit and the clock, a row's tools
 *   danger-line Danger: Remove, Cancel the order — always asks first; danger (solid red) only on that confirm
 *   link      words in a sentence or a table cell
 * "brand" and "danger-ghost" are kept as names of primary and danger-line.
 */
export type ButtonVariant = "primary" | "strong" | "soft" | "brand" | "secondary" | "ghost" | "danger" | "danger-ghost" | "danger-line" | "link";
/**
 * Three sizes, never smaller on a phone: sm 32 (phone 40) in boxes and rows · md 40 (44) in windows and forms ·
 * lg 44 (48) for the strong one. "xs" and "icon-xs" are kept as names of sm and icon-sm. No page sets a height.
 */
export type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-xs";

const buttonBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] text-sm font-semibold whitespace-nowrap transition-colors select-none focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";
const main = "bg-primary-solid text-primary-fg shadow-card hover:bg-primary-solid-hover";
const dangerLine = "border border-bad/30 bg-surface text-bad hover:bg-bad-soft";
const buttonVariants: Record<ButtonVariant, string> = {
  strong: "bg-action-solid font-bold text-white shadow-[0_6px_16px_color-mix(in_srgb,var(--action-solid)_28%,transparent)] hover:bg-action-solid-hover",
  primary: main,
  brand: main,
  soft: "border border-action/20 bg-action-soft text-action hover:border-action/45",
  secondary: "border border-line-strong bg-surface text-text shadow-card hover:bg-surface-2",
  ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
  "danger-line": dangerLine,
  "danger-ghost": dangerLine,
  danger: "bg-bad-solid text-white shadow-card hover:opacity-90",
  link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
};
/** sm: 32px high on a laptop, 40 on a phone, with room either side of its words (never tighter than this). */
const small = "h-8 px-2.5 text-md [&_svg]:size-3.5 max-sm:h-10 max-sm:px-3.5";
const iconSmall = "size-8 [&_svg]:size-3.5 max-sm:size-10";
const buttonSizes: Record<ButtonSize, string> = {
  xs: small,
  sm: small,
  md: "h-10 px-3.5 max-sm:h-11 max-sm:px-4",
  lg: "h-11 px-5 text-lead max-sm:h-12",
  icon: "size-10 max-sm:size-11",
  "icon-sm": iconSmall,
  "icon-xs": iconSmall,
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
/**
 * The one field (canvas board "The one field"): a label on top, the box, then one line (the hint, or the error in its
 * place). One height: md 40 on a laptop, 44 on a phone, with 16 px text there so the phone does not zoom; a table
 * cell has the small box, sm 32 (40 on a phone). No page sets a field's height of its own.
 */
export type ControlSize = "md" | "sm";
export const controlSizes: Record<ControlSize, string> = { md: "h-10 max-sm:h-11", sm: "h-8 px-2.5 max-sm:h-10" };
export const controlClass =
  "w-full rounded-[10px] border border-line-strong bg-surface px-3 text-sm text-text shadow-card max-sm:text-base transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-primary-solid focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-bad aria-invalid:focus-visible:ring-bad/25";
/** The search box's frame (a label around an icon and the input): the field's border, corner and focus ring. */
export const searchFrameClass =
  "rounded-[10px] border border-line-strong bg-surface shadow-card transition-colors focus-within:border-primary-solid focus-within:ring-3 focus-within:ring-ring";

export function Input({
  className,
  leading,
  unit,
  size = "md",
  ...props
}: Omit<ComponentProps<"input">, "size"> & {
  leading?: ReactNode;
  /** The unit, inside the box on the right: %, days, pcs, GB (board "The one field", rule 3). */
  unit?: ReactNode;
  size?: ControlSize;
}) {
  if (!leading && !unit) return <input className={cn(controlClass, controlSizes[size], className)} {...props} />;
  return (
    <div className={cn("relative", unit && className?.match(/(?:^|\s)(w-\S+)/)?.[1])}>
      {leading && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted [&_svg]:size-4">{leading}</span>}
      {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">{unit}</span>}
      <input className={cn(controlClass, controlSizes[size], leading && "pl-9", unit && "pr-10", className, unit && "w-full")} {...props} />
    </div>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "min-h-20 py-2 leading-relaxed", className)} {...props} />;
}

/** Native select, styled: accessible, fast, works with forms and keyboard out of the box. */
export function Select({
  className,
  children,
  compact,
  size,
  ...props
}: Omit<ComponentProps<"select">, "size"> & { /** The same as size="sm". */ compact?: boolean; size?: ControlSize }) {
  // Width classes go on the wrapper so the chevron stays at the control's edge.
  return (
    <div className={cn("relative", className)}>
      <select className={cn(controlClass, controlSizes[size ?? (compact ? "sm" : "md")], "appearance-none pr-8")} {...props}>
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

/**
 * The one box head (canvas group 7): a 48px row under a line — the title (15px bold), what stands beside it, and its
 * buttons at the right. CardHeader and the record's boxes (RecordBox) both draw it from these.
 */
export const boxHeadClass = "flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line py-2 pr-2.5 pl-5 max-sm:pl-4";
export const boxTitleClass = "min-w-0 text-lead font-bold text-text";

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
  titleId,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** How the card's figures are worked out, behind an ⓘ beside the title (HowMade). */
  how?: string;
  /** The ⓘ note's heading when the title is not plain text. */
  howTitle?: string;
  /** The title's id, for a box labelled by it (aria-labelledby). */
  titleId?: string;
}) {
  const heading = (
    <h2 id={titleId} className={boxTitleClass}>
      {title}
    </h2>
  );
  return (
    // With a description and actions, a phone puts the actions under the text instead of squeezing it; actions
    // that do not fit beside the title (a narrow screen) go under it rather than past the edge.
    <div className={cn(boxHeadClass, "justify-between gap-x-3", description && actions && "max-sm:flex-col max-sm:items-start max-sm:gap-2", className)}>
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
 * `actions` is the older form (a free row of buttons), kept for the pages not yet moved to the frame. There is no
 * help line under a title (rule 15): what a page is for shows in what it holds.
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
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:flex max-md:gap-2 max-md:border-t max-md:border-line max-md:bg-surface max-md:px-3 max-md:pt-2 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-md:shadow-[0_-4px_12px_rgb(0_0_0/0.06)] max-md:[&:not(:has(a,button))]:hidden max-md:[&>*]:min-w-0 max-md:[&>*]:flex-1 max-md:[&_:is(a,button)]:h-12 max-md:[&_:is(a,button)]:w-full max-md:[&_:is(a,button)]:justify-center max-md:[&_:is(a,button)]:text-lead";

export function PageHeader({
  title,
  icon,
  badge,
  summary,
  papers,
  views,
  primary,
  more,
  actions,
  kind,
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
  actions?: ReactNode;
  /** A list page (canvas board "One list page for all 25 lists"): no icon tile, its name from the menu. */
  kind?: "list";
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  const framed = badge !== undefined || summary !== undefined || primary !== undefined || papers !== undefined || more !== undefined || views !== undefined;
  const right = actions || papers || views || primary || more;
  const Icon = icon === null || kind === "list" ? null : (icon ?? (crumbs?.[0] ? MODULE_ICONS[crumbs[0].label] : undefined));
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
              <p className="truncate text-base leading-5 font-bold text-text">{name ?? title}</p>
              <p className="truncate text-xs leading-4 font-medium text-muted">{under}</p>
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
          <span aria-hidden className="min-w-0 flex-1 truncate text-lg leading-5 font-bold text-text">
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
                <h1 className={cn("font-bold text-text", framed ? "text-xl leading-7 sm:text-2xl sm:leading-8" : "text-2xl leading-8 sm:text-2xl sm:leading-8", titleInBar && "max-md:sr-only")}>
                  {title}
                </h1>
                {badge}
              </div>
              {/* A top page's plain sentence under its name is a help line: not on a phone (design rule 15). */}
              {summary && <div data-page-summary="" className={cn("mt-0.5 text-md text-muted", !up && titleInBar && typeof summary === "string" && "max-md:hidden")}>{summary}</div>}
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

/**
 * The one empty line (canvas group 7): what is not there yet, in quiet words, inside the box it concerns — "No
 * payments yet." A whole empty list with its one way to add is EmptyState. `inset`: with the box's own padding.
 */
export function EmptyLine({ inset, className, ...props }: ComponentProps<"p"> & { inset?: boolean }) {
  return <p className={cn("text-sm text-muted", inset && "p-4 sm:px-5", className)} {...props} />;
}

/* ---------------------------------------------------------------- Table */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    // Focusable so a keyboard can scroll a wide table sideways; the edge with more fades on a phone.
    <ScrollFade className="w-full overflow-x-auto focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none" tabIndex={0}>
      <table className={cn("w-full border-collapse text-md", className)} {...props} />
    </ScrollFade>
  );
}
export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-faint", className)} {...props} />;
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  // relative: a hidden (sr-only) name inside is placed in its cell, so a table that scrolls
  // sideways keeps it in its box instead of widening the page.
  return <th scope="col" className={cn("relative h-[42px] border-b border-line px-3.5 text-left text-md font-semibold whitespace-nowrap text-muted", className)} {...props} />;
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
  return <kbd className="inline-flex h-5 items-center rounded border border-line bg-surface-2 px-1.5 font-mono text-2xs text-muted">{children}</kbd>;
}

/**
 * The one tab row (board "The one filter row and the one tab row"): underlined tabs, 42 tall, the open one bold
 * with a green line, a short fact beside a name ("3", "R1 draft"). Each tab is its own address; by default a tab
 * replaces the one before in the browser's history. phone "tabs" (a record's tabs): the row scrolls sideways;
 * phone "chips" (a list's stages, rule 15): round chips on a phone, underlined from 640 px.
 */
export interface TabRowItem {
  href: string;
  label: ReactNode;
  /** The short fact beside the name: a count, "R1 draft", "sailed". */
  tag?: ReactNode;
  /** The fact is bad news (late): drawn in red. */
  alert?: boolean;
  active: boolean;
}

export function TabRow({
  label,
  items,
  end,
  className = "mt-4",
  replace = true,
  phone = "tabs",
}: {
  label: string;
  items: TabRowItem[];
  end?: ReactNode;
  className?: string;
  replace?: boolean;
  phone?: "tabs" | "chips";
}) {
  const chips = phone === "chips";
  return (
    <ScrollFade
      as="nav"
      aria-label={label}
      className={cn(
        "no-print flex overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        chips ? "-mx-4 items-center gap-2 px-4 py-0.5 sm:mx-0 sm:items-stretch sm:gap-x-[22px] sm:border-b sm:border-line sm:px-0 sm:py-0" : "items-stretch gap-x-[22px] border-b border-line",
        className,
      )}
    >
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          replace={replace}
          scroll={replace ? false : undefined}
          aria-current={t.active ? "page" : undefined}
          className={cn(
            "shrink-0 items-center whitespace-nowrap text-md",
            chips
              ? cn(
                  "inline-flex h-9 gap-1.5 rounded-full border px-3 font-semibold transition-colors max-sm:h-10 [&_svg]:size-4",
                  t.active ? "border-primary-line bg-primary-soft text-primary" : "border-line bg-surface text-text-2 hover:border-line-strong hover:text-text",
                  "sm:-mb-px sm:h-[42px] sm:rounded-none sm:border-0 sm:border-b-2 sm:bg-transparent sm:px-0",
                  t.active ? "sm:border-primary-solid sm:font-bold sm:text-text" : "sm:border-transparent sm:font-medium sm:text-text-2 sm:hover:text-text",
                )
              : "-mb-px flex h-[42px] gap-[7px] border-b-2 border-transparent font-medium text-text-2 hover:text-text aria-[current]:border-primary-solid aria-[current]:font-bold aria-[current]:text-text",
          )}
        >
          {t.label}
          {t.tag !== undefined && t.tag !== null && t.tag !== "" && (
            <span className={cn("text-xs font-semibold tabular", t.alert ? "rounded-md bg-bad-soft px-1.5 text-bad" : "text-text-2 max-md:rounded-full max-md:bg-surface-2 max-md:px-1.5 max-md:leading-[17px]")}>{t.tag}</span>
          )}
          <Pending />
        </Link>
      ))}
      {end}
    </ScrollFade>
  );
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
  if (look === "tabs")
    return (
      <TabRow
        label={label}
        phone="chips"
        replace={!!replace}
        className={className ?? ""}
        items={tabs.map((x) => ({ href: x.href, label: x.label, tag: x.count, alert: x.alert, active: x.active }))}
      />
    );
  return (
    <ScrollFade
      as="nav"
      aria-label={label}
      className={cn(
        "-mx-4 flex items-center gap-2 overflow-x-auto overflow-y-hidden px-4 py-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0.5 [&::-webkit-scrollbar]:hidden",
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
          className={chipClass(t.active)}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn("tabular", t.alert && "rounded-md bg-bad-soft px-1.5 font-semibold text-bad")}>{t.count}</span>
          )}
          <Pending />
        </Link>
      ))}
    </ScrollFade>
  );
}

/**
 * A filter chip that is a link: the one chip (the same as LinkTabs' chips), tinted when on, with its count
 * ("Overdue 2"). `pill` is kept as a name; every chip looks the same.
 */
export const chipClass = (active: boolean) =>
  cn(
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-md font-medium whitespace-nowrap transition-colors max-sm:h-10 [&_svg]:size-4",
    active ? "border-primary-line bg-primary-soft font-semibold text-primary" : "border-line bg-surface text-text-2 hover:border-line-strong hover:text-text",
  );

export function FilterChip({ href, active, count, children }: { href: string; active: boolean; count?: number; pill?: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "true" : undefined} className={chipClass(active)}>
      {children}
      {count !== undefined && <span className="tabular">{count}</span>}
    </Link>
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
          className={cn("inline-flex h-8 items-center rounded-lg px-3 text-md font-medium whitespace-nowrap text-muted transition-colors hover:text-text", o.active && "bg-surface font-semibold text-primary shadow-card")}
        >
          {o.label}
        </Link>
      ))}
    </ScrollFade>
  );
}

