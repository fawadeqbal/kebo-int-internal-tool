
import Link from "next/link";
import { BackArrow, ListLink } from "./back";
import { Pending } from "./pending";
import { ScrollFade } from "./scroll-fade";
import type { ComponentProps, ReactNode } from "react";
import { Info, Package, type LucideIcon } from "lucide-react";
import { cn } from "./cn";
import { RULES } from "./rules";

/* ---------------------------------------------------------------- Button */
/**
 * The one button (canvas "RFQ Desk — the pieces", board "The one button: seven kinds, three sizes, every state").
 * Kinds, each one job:
 *   strong    the page's one big button (a list's + New …): the theme colour like primary, bolder, with a glow — one per screen
 *   primary   Main: the one way to finish a window — Save, Send, Record (the theme colour)
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
  // The page's one big button (a list's "+ New …"): the theme's own colour like every main button, only bolder,
  // so a colour set shows one button colour (orange stays for what needs you: counts, "Today", "Nobody yet").
  strong: "bg-primary-solid font-bold text-primary-fg shadow-[0_6px_16px_color-mix(in_srgb,var(--primary-solid)_28%,transparent)] hover:bg-primary-solid-hover",
  primary: main,
  brand: main,
  soft: "border border-primary/20 bg-primary-soft text-primary hover:border-primary/45",
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
  return <button type={type} data-variant={variant} className={buttonClass(variant, size, className)} {...props} />;
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
  return <Link data-variant={variant} className={buttonClass(variant, size, className)} {...(file && props.prefetch === undefined ? { prefetch: false } : {})} {...props} />;
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
/**
 * A box's head: its title at the box's inset, its buttons ending 10px in, where a small button's own 10px of room
 * puts its words on the inset. A link-look button has no room of its own, so in a head it gets the same 10px: its
 * words then end where an Edit's do ("Statement", "All orders" were 10px nearer the edge).
 */
export const boxHeadClass = "flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line py-2 pr-2.5 pl-4 sm:pl-5 [&_[data-variant=link]]:px-2.5 [&>a:not([data-variant])]:px-2.5";
/** A head's group of buttons: a plain link among them ("Order board →") gets a small button's room, as a link-look button does. */
export const headActionsClass = "[&>a:not([data-variant])]:px-2.5";
export const boxTitleClass = "min-w-0 text-lead font-bold text-text";

/** A heading inside a box or a window, under its title (a group of fields, a part of a list): one look everywhere. */
export const subTitleClass = "text-sm font-semibold text-text";

/** A small label in capitals over a group (a menu's group, a list's part, a panel's kind): one look everywhere. */
export const capsClass = "text-2xs font-semibold tracking-wide text-text-2 uppercase";

/** A link in text (a list's "Show all", a cross-link, "Open the order →"): one look everywhere; its size comes from the text around it. */
export const linkClass = "font-medium text-primary underline-offset-2 hover:underline";

/** A card's look, for the few boxes that cannot be a Card element (the side panel, which measures itself). */
export const cardClass = "rounded-2xl border border-line bg-surface";
/** Parts one under another, RULES.page.gap apart: a page's header, tabs, filters and boxes. */
export function Stack({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(RULES.page.stack, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn(cardClass, className)} {...props} />;
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
      {/* The words shrink (a long description wraps) so the buttons stay at the right on a laptop. */}
      {/* 8rem kept for the words before the buttons go under them: a short title keeps its buttons beside it in a
          320px side box ("Money · Statement"), a long one still wraps its words rather than squeezing them. */}
      {/* Stacked on a phone (a description and buttons), the 8rem is a height: there it takes only its own height. */}
      <div className={cn("min-w-0 flex-[1_1_8rem]", description && actions && "max-sm:flex-none")}>
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
      {actions && <div className={cn(headActionsClass, "ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2")}>{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn(RULES.box.body, className)} {...props} />;
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

/**
 * A record's one strong button on a phone (canvas row "Every page's top on a phone", option A): pinned at the
 * bottom, at the thumb, full width and 48 tall (design rule 10), in the place of the app's bottom bar, which steps
 * aside while it is there (globals.css). With nothing in it (no next step) it is not there and the bar stays.
 */
const DOCK =
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:flex max-md:gap-2 max-md:border-t max-md:border-line max-md:bg-surface max-md:px-3 max-md:pt-2 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-md:shadow-[0_-4px_12px_rgb(0_0_0/0.06)] max-md:[&:not(:has(a,button))]:hidden max-md:[&>*]:min-w-0 max-md:[&>*]:flex-1 max-md:[&_:is(a,button)]:h-12 max-md:[&_:is(a,button)]:w-full max-md:[&_:is(a,button)]:justify-center max-md:[&_:is(a,button)]:text-lead";

export function PageHeader({
  title,
  badge,
  summary,
  papers,
  views,
  primary,
  more,
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
  /** A list page (canvas board "One list page for all 25 lists"): its name from the menu. */
  kind?: "list";
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
}) {
  const framed = badge !== undefined || summary !== undefined || primary !== undefined || papers !== undefined || more !== undefined || views !== undefined;
  const right = actions || papers || views || primary || more;
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
      <header data-page-label={name}>
        {/* Phone: room for the fixed bar above (inside the header, so the page's gap is not added to it). */}
        {up && <div aria-hidden className="h-14 md:hidden" />}
        {trail && <Breadcrumb items={trail} className={up || titleInBar ? "max-md:hidden" : undefined} />}
        {/* phoneStack: one column on a phone, each row the screen's width. (Not a wrapping column: some phone
            browsers then size the title to its text, so a long line runs past the screen and the page zooms out.) */}
        <div className={cn("flex items-start justify-between gap-3", framed ? "sm:flex-wrap" : "flex-wrap", phoneStack && "max-sm:flex-col max-sm:flex-nowrap max-sm:items-stretch")}>
          <div className={cn("flex min-w-0 items-start gap-3", framed ? "flex-1 sm:flex-[1_1_18rem]" : "flex-[1_1_18rem]", phoneStack && "max-sm:w-full max-sm:flex-none")}>
            {/* No icon tile before a title (live audit 20 Nov): a deeper page has ← here, a top page nothing. */}
            {up && <BackArrow up={up.href} label={up.label} root={up.root} className="max-md:hidden" />}
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
            // At the right at every width: on a phone too, where they wrap under the title (they sat right on some
            // pages and left on others: sweep 20 Nov).
            <div className={cn("flex items-center justify-end gap-2", framed ? "shrink-0 sm:flex-wrap" : "flex-wrap", up && !actions && !views && "max-md:contents")}>
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
  return <p className={cn("text-sm text-muted", inset && RULES.box.body, className)} {...props} />;
}

/* ---------------------------------------------------------------- Table */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    // Focusable so a keyboard can scroll a wide table sideways; the edge with more fades on a phone.
    <ScrollFade className="w-full overflow-x-auto focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none" tabIndex={0}>
      {/* On a phone the first column (a name) keeps 9rem and the table scrolls sideways, rather than every column
          squeezing the names onto four lines (sweep 20 Nov: Reports › Customers, Suppliers, People). */}
      <table className={cn("w-full border-collapse text-md max-sm:[&_tbody_td:first-child]:min-w-36 max-sm:[&_thead_th:first-child]:min-w-36", className)} {...props} />
    </ScrollFade>
  );
}
export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-faint", className)} {...props} />;
}
/** A table's first and last cells start where its box's title does (RULES.box.inset), not 14px in. */
const EDGE = "first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
export function Th({ className, ...props }: ComponentProps<"th">) {
  // relative: a hidden (sr-only) name inside is placed in its cell, so a table that scrolls
  // sideways keeps it in its box instead of widening the page.
  return <th scope="col" className={cn("relative h-[42px] border-b border-line px-3.5 text-left text-md font-semibold whitespace-nowrap text-muted", EDGE, className)} {...props} />;
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("h-[52px] border-b border-line px-3.5 py-3 align-middle text-text", EDGE, className)} {...props} />;
}
/**
 * A table row. With `href` it opens its record (one rule in every table, the
 * app's RowClicks): a click anywhere on it goes to `href` (Ctrl/⌘-click: a new
 * tab), a click on a link, button or field in it does its own thing, the row
 * lights on hover, and its first cell should hold a real link to the same place
 * for the keyboard (Enter) and screen readers. `flash`: just saved, lit for 2 seconds.
 * `stay`: the page keeps its place (a row that opens its parts under it).
 */
export function Tr({ href, flash, stay, className, ...props }: ComponentProps<"tr"> & { href?: string; flash?: boolean; stay?: boolean }) {
  return (
    <tr
      data-href={href}
      data-flash={flash ? "" : undefined}
      data-stay={href && stay ? "" : undefined}
      className={cn(
        "transition-colors last:[&>td]:border-b-0",
        href && "group cursor-pointer hover:bg-primary-soft/60",
        flash && "animate-flash",
        className,
      )}
      {...props}
    />
  );
}

/** A list's row (DataTable): a Tr that always opens its record. */
export function DataRow(props: ComponentProps<typeof Tr> & { href: string }) {
  return <Tr {...props} />;
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

/**
 * Label/value rows for detail panels: the record box's rows (label at the left, the value beside it), the same as
 * DetailsCard and BoxFacts; `columns` 2 or 3: two pairs a row on a wide screen.
 */
export function DetailList({ items, columns = 2, className }: { items: { label: ReactNode; value: ReactNode; hidden?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm",
        columns > 1 && "lg:grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)_minmax(6.5rem,auto)_minmax(0,1fr)] lg:gap-x-6",
        className,
      )}
    >
      {items
        .filter((i) => !i.hidden)
        .map((i, idx) => (
          <div key={idx} className="contents">
            <dt className="text-text-2">{i.label}</dt>
            <dd className="min-w-0 font-medium break-words text-text">{i.value ?? "—"}</dd>
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
/** An empty value in a table or a list of facts: a quiet dash. */
export function Dash() {
  return <span className="font-normal text-muted">—</span>;
}

/**
 * A count in a small round bubble: unread notifications (the bell, the phone's tab), filters chosen. Over 9: "9+".
 * `tone`: action (something waits for you, the default) or primary (what you chose).
 */
export function CountDot({ n, tone = "action", className, ...props }: ComponentProps<"span"> & { n: number; tone?: "action" | "primary" }) {
  return (
    <span
      className={cn(
        "grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-2xs leading-none font-bold text-white tabular",
        tone === "action" ? "bg-action-solid" : "bg-primary-solid",
        className,
      )}
      {...props}
    >
      {n > 9 ? "9+" : n}
    </span>
  );
}

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
  look = "tabs",
}: {
  tabs: { href: string; label: ReactNode; count?: number; active: boolean; alert?: boolean }[];
  className?: string;
  label: string;
  /** Switch in place (no new history step): tabs inside a window. */
  replace?: boolean;
  /**
   * "tabs" (the default; design "list pages" 18 Nov: a page's stages or views): on a laptop underlined tabs like a
   * record's, with their counts; on a phone round chips that slide sideways. "chips": chips everywhere — only for a
   * filter inside a box.
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

/**
 * The one switch between a few views (List | Board, Month | Quarter, For the bank | All): its track and its
 * segments. Segmented (links), SegmentedChoice (buttons) and the app's ViewSwitch all draw these two.
 */
export const segmentsClass = "inline-flex max-w-full overflow-x-auto rounded-[10px] border border-line bg-surface-2 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
export const segmentClass = (active: boolean) =>
  cn(
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-md font-medium whitespace-nowrap text-muted transition-colors hover:text-text max-sm:h-10 [&_svg]:size-4",
    active && "bg-surface font-semibold text-primary shadow-card",
  );

/** Pill links for a small set of options (e.g. This month / Last month). */
export function Segmented({ options, className, label }: { options: { href: string; label: ReactNode; active: boolean }[]; className?: string; label: string }) {
  return (
    <ScrollFade
      as="nav"
      aria-label={label}
      className={cn(segmentsClass, className)}
    >
      {options.map((o) => (
        <Link key={o.href} href={o.href} scroll={false} aria-current={o.active ? "page" : undefined} className={segmentClass(o.active)}>
          {o.label}
        </Link>
      ))}
    </ScrollFade>
  );
}

