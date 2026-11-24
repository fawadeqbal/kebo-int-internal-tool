"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Banknote, Building, CalendarClock, ChartLine, ClipboardCheck, Contact, CreditCard, Factory, FileStack, FileText, Filter, Globe, History, KeyRound, LockKeyhole, Mail, MonitorSmartphone, Package, Receipt, ScrollText, Send, Target, Users, UserCog, Wallet, BellRing, Bell, BriefcaseBusiness, Building2, ChartColumn, ChevronRight, Inbox, Landmark, LayoutDashboard, LogOut, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Plus, ShoppingCart, User, X, ShieldCheck, type LucideIcon, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Avatar, buttonClass, cn, RULES, Badge, CountDot } from "@kebo/ui";
import { NavMemoryKeeper, SegmentedChoice } from "@kebo/ui/client";
import { logoutAction } from "@/app/login/actions";
import { FOLD_COOKIE, HOME_HREF, isSingle, moduleOf, moduleTotal, OPEN_COOKIE, pageOf, type ModuleKey, type NavIcon, type NavModule, type NavPage } from "@/lib/nav";
import { PRODUCT_NAME } from "@/lib/product";
import { useFocusTrap } from "@/components/common/dialog";
import { PhoneSearch, TopSearch } from "./global-search";

export type { NavModule, NavPage } from "@/lib/nav";

/** One line icon per page (the same family and weight as the groups'), so every item is found by its picture too. */
const PAGE_ICONS: Record<string, LucideIcon> = {
  "/inquiries": Inbox,
  "/orders": Package,
  "/customers": Contact,
  "/follow-ups": CalendarClock,
  "/operations/purchase-orders": ClipboardCheck,
  "/suppliers": Factory,
  "/money/due": ArrowDownToLine,
  "/money/payables": ArrowUpFromLine,
  "/payments": CreditCard,
  "/finance/cash-book": Wallet,
  "/money/company-costs": Receipt,
  "/reports": LayoutDashboard,
  "/reports/profit": ChartLine,
  "/reports/cash": Banknote,
  "/reports/spending": Receipt,
  "/reports/customers": Users,
  "/reports/factories": Factory,
  "/reports/people": Target,
  "/reports/funnel": Filter,
  "/settings/company": Building,
  "/settings/address": Globe,
  "/settings/sales": FileText,
  "/settings/books": LockKeyhole,
  "/settings/papers": FileStack,
  "/settings/reminders": BellRing,
  "/settings/emails": Mail,
  "/settings/website-form": Send,
  "/users": UserCog,
  "/access/roles": KeyRound,
  "/access/sign-ins": History,
  "/access/sessions": MonitorSmartphone,
  "/settings/mail": Mail,
  "/audit": ScrollText,
};

/** A page's icon (none known: a plain dot-sized gap keeps the names in line). */
function PageIcon({ href, className }: { href: string; className?: string }) {
  const Icon = PAGE_ICONS[href];
  return Icon ? <Icon className={cn("size-[15px] shrink-0", className)} strokeWidth={1.75} aria-hidden /> : <span className={cn("size-[15px] shrink-0", className)} aria-hidden />;
}

/** One line icon per group, drawn the same weight (lucide): what each is in an office, not a picture of money or a box. */
const ICONS: Record<NavIcon, LucideIcon> = {
  home: LayoutDashboard,
  sales: BriefcaseBusiness,
  purchasing: ShoppingCart,
  money: Landmark,
  reports: ChartColumn,
  company: Building2,
  admin: ShieldCheck,
};

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/* ------------------------------------------------------------------ Popover menu */

/** Small dropdown: closes on outside click, Escape and navigation. */
function Menu({ trigger, label, children, className }: { trigger: ReactNode; label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }
  const button = useRef<HTMLButtonElement>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>("[role=menu] [role=menuitem]") ?? [])];
  useEffect(() => {
    if (!open) return;
    // Opened: its first item takes the focus, and the arrow keys move through it (review 24 Nov, X-27).
    ref.current?.querySelector<HTMLElement>("[role=menu] [role=menuitem]")?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      if (ref.current?.contains(document.activeElement)) button.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex rounded-xl"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full right-0 z-50 mt-2 min-w-44 animate-in rounded-xl border border-line bg-surface p-1 shadow-pop",
            className,
          )}
          // Close after a choice, but not for a form button (removing the form before it submits cancels the submit: Sign out)
          // nor for a setting chosen in place (the look).
          onClick={(e) => !(e.target as HTMLElement).closest("form,[data-keep-open]") && setOpen(false)}
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
            const list = items();
            if (!list.length) return;
            e.preventDefault();
            const at = list.indexOf(document.activeElement as HTMLElement);
            const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
            list[next]!.focus();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

const menuItem =
  "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-text-2 hover:bg-surface-2 hover:text-text [&_svg]:size-4 [&_svg]:text-muted";

/* ------------------------------------------------------------------ Theme */

type Mode = "light" | "dark" | "system";

function applyTheme(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const savedMode = (): Mode => {
  try {
    return (localStorage.getItem("theme") as Mode) || "system";
  } catch {
    // storage blocked: keep the default
    return "system";
  }
};

/** While the look is "Auto", the page follows the computer when it changes between light and dark. */
function useFollowSystemLook() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => savedMode() === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
}

/** The look: light, dark, or what the computer uses. Chosen in the account menu, kept in this browser. */
function LookChoice() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved choice once on mount
    setMode(savedMode());
  }, []);
  const choose = (m: Mode) => {
    try {
      localStorage.setItem("theme", m);
    } catch {
      // storage blocked: the choice lasts until the page is left
    }
    setMode(m);
    applyTheme(m);
  };
  const options: [Mode, string][] = [
    ["light", "Light"],
    ["dark", "Dark"],
    ["system", "Auto"],
  ];
  return (
    <div data-keep-open className="flex h-9 items-center justify-between gap-2 px-2 text-sm text-text-2">
      <span id="look-label">Look</span>
      <SegmentedChoice label="Look" value={mode} options={options.map(([value, label]) => ({ value, label }))} onChange={choose} />
    </div>
  );
}

/* ------------------------------------------------------------------ Account, New */

function AccountMenu({ user, companyName }: { user: { name: string; email: string; role: string }; companyName: string }) {
  return (
    <Menu
      // Starts with what the button shows (name and role), so speech and screen readers find it by its words.
      label={`${user.name} ${user.role}, account menu`}
      className="w-64"
      trigger={
        <span className="flex items-center gap-2.5 rounded-xl lg:py-1 lg:pr-2 lg:pl-1 lg:hover:bg-surface-2">
          <Avatar name={user.name} size={34} className="font-bold" />
          <span className="hidden text-left leading-tight lg:block">
            <span className="block max-w-36 truncate text-md font-semibold text-text">{user.name}</span>{" "}
            <span className="block max-w-36 truncate text-xs text-muted">{user.role}</span>
          </span>
        </span>
      }
    >
      <div className="px-2 py-1.5 text-xs text-muted">
        <span className="block truncate text-sm font-medium text-text">{user.name}</span>
        <span className="block truncate">{user.email}</span>
        <span className="mt-1 block text-text-2">
          {user.role} · {companyName}
        </span>
      </div>
      <div className="-mx-1 my-1 h-px bg-line" />
      <Link href="/account" role="menuitem" className={menuItem}>
        <User aria-hidden />
        My account
      </Link>
      <LookChoice />
      <div className="-mx-1 my-1 h-px bg-line" />
      <form action={logoutAction}>
        <button type="submit" role="menuitem" className={menuItem}>
          <LogOut aria-hidden />
          Sign out
        </button>
      </form>
    </Menu>
  );
}

/** What can be made from anywhere: each opens the same window as its own page's button. */
export type NewItem = { href: string; label: string };

function NewMenu({ items }: { items: NewItem[] }) {
  return (
    <Menu
      label="New"
      className="w-52"
      trigger={
        <span className={cn(buttonClass("secondary", "md"), "h-9 px-3")}>
          <Plus aria-hidden /> New
        </span>
      }
    >
      {items.map((it) => (
        <Link key={it.href} href={it.href} role="menuitem" className={menuItem}>
          {it.label}
        </Link>
      ))}
    </Menu>
  );
}

/* ------------------------------------------------------------------ The menu */

/** A count on a page or a closed group: what waits for this person (payments to verify). */
function Count({ n, label }: { n: number; label: string }) {
  return (
    <Badge size="sm" tone="warn" className="min-w-5 justify-center px-1.5 tabular" aria-label={`${n} ${label}`}>
      {n > 99 ? "99+" : n}
    </Badge>
  );
}

function writeCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // cookies blocked: the menu just isn't remembered
  }
}

/** Each group's tile colour on a phone (a soft tint and its ink), so a group is found by its colour as well as its name. */
const TILES: Record<NavIcon, string> = {
  home: "bg-surface-2 text-text-2",
  sales: "bg-primary-soft text-primary",
  purchasing: "bg-warn-soft text-warn",
  money: "bg-trust-soft text-trust",
  reports: "bg-info-soft text-info",
  company: "bg-surface-2 text-text-2",
  admin: "bg-surface-2 text-text-2",
};

/** The groups of everyday work, then the settings (their own heading). */
const SETTINGS_GROUPS: ModuleKey[] = ["company", "admin"];

/**
 * A page under its group, on the group's thin guide line: the page you are on is green, with a short green
 * mark on the line beside it.
 */
function PageLink({ page, active, big }: { page: NavPage; active: boolean; big?: boolean }) {
  return (
    <Link
      href={page.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-2.5 text-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
        big ? "min-h-11" : "h-8",
        active &&
          "bg-primary-soft font-semibold text-primary before:absolute before:inset-y-1.5 before:-left-[11px] before:w-0.5 before:rounded-full before:bg-primary hover:bg-primary-soft hover:text-primary",
      )}
    >
      <PageIcon href={page.href} className={active ? "text-primary" : "text-muted"} />
      <span className="flex-1 truncate">{page.label}</span>
      {!!page.badge && <Count n={page.badge} label={page.badgeLabel ?? "unread"} />}
    </Link>
  );
}

/** A small heading over a part of the menu (Workspace, Settings). */
function MenuLabel({ children, big }: { children: ReactNode; big?: boolean }) {
  return <li className={cn("px-2.5 pt-4 pb-1.5 text-2xs font-semibold tracking-[0.09em] text-muted uppercase first:pt-1", big && "px-1.5")}>{children}</li>;
}

/**
 * Home, then each group: a button that opens and closes its pages (aria-expanded). Two levels and no
 * more; the pages hang on a thin guide line. A closed group shows the total of what waits in it; the
 * group the current page is in has its icon in green. Workspace first, then Settings, each with its small
 * heading. On a phone (big) each part is a card with bigger rows and a coloured tile for each group.
 */
function GroupTree({
  modules,
  pathname,
  activeHref,
  current,
  open,
  toggle,
  big,
}: {
  modules: NavModule[];
  pathname: string;
  activeHref: string | undefined;
  current: ModuleKey | undefined;
  open: Set<ModuleKey>;
  toggle: (key: ModuleKey) => void;
  big?: boolean;
}) {
  const id = useId();
  const home = isActive(pathname, HOME_HREF);
  const row = big ? "min-h-13 px-3" : "h-9 px-2.5";
  const icon = (key: NavIcon, Icon: LucideIcon, on: boolean) =>
    big ? (
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TILES[key])}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
    ) : (
      <Icon className={cn("size-[17px] shrink-0", on ? "text-primary" : "text-text-2")} aria-hidden />
    );
  const card = big ? "overflow-hidden rounded-2xl border border-line bg-surface [&>li+li]:border-t [&>li+li]:border-line" : "space-y-0.5";
  const group = (m: NavModule) => {
    const Icon = ICONS[m.icon];
    const isOpen = open.has(m.key);
    const total = moduleTotal(m);
    const listId = `${id}-${m.key}`;
    const on = m.key === current;
    // One page with the group's name: a link like Home, nothing to open.
    if (isSingle(m)) {
      return (
        <li key={m.key}>
          <Link
            href={m.pages[0]!.href}
            aria-current={on ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-lg text-md font-semibold text-text transition-colors hover:bg-surface-2", row, on && "bg-primary-soft text-primary hover:bg-primary-soft")}
          >
            {icon(m.icon, Icon, on)}
            <span className="flex-1 truncate">{m.title}</span>
            {total > 0 && <Count n={total} label="to look at" />}
          </Link>
        </li>
      );
    }
    return (
      <li key={m.key}>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => toggle(m.key)}
          className={cn("flex w-full items-center gap-2.5 rounded-lg text-left text-md text-text transition-colors hover:bg-surface-2", on || isOpen ? "font-bold" : "font-semibold", row, big && "rounded-none")}
        >
          {icon(m.icon, Icon, on || isOpen)}
          <span className="flex-1 truncate">{m.title}</span>
          {!isOpen && total > 0 && <Count n={total} label="to look at" />}
          <ChevronRight className={cn("size-3.5 shrink-0 text-muted transition-transform", isOpen && "rotate-90")} aria-hidden />
        </button>
        {/* Closed: still in the page (hidden), so its addresses are there for the browser and the checks. The pages
            hang on one thin line under the group's icon. */}
        <ul id={listId} hidden={!isOpen} className={cn("space-y-0.5 border-l border-line pl-2.5", big ? "mt-0 mr-3 mb-2 ml-[27px]" : "mt-0.5 mb-1.5 ml-[18px]")}>
          {m.pages.map((p) => (
            <li key={p.href} className={cn(p.lineBefore && "relative mt-1.5 pt-1.5 before:absolute before:top-0 before:right-2 before:left-2.5 before:h-px before:bg-line")}>
              <PageLink page={p} active={p.href === activeHref} big={big} />
            </li>
          ))}
        </ul>
      </li>
    );
  };
  const work = modules.filter((m) => !SETTINGS_GROUPS.includes(m.key));
  const settings = modules.filter((m) => SETTINGS_GROUPS.includes(m.key));
  return (
    <ul className={cn(big && "space-y-1")}>
      <MenuLabel big={big}>Workspace</MenuLabel>
      <li>
        <ul className={card}>
          <li>
            <Link
              href={HOME_HREF}
              aria-current={home ? "page" : undefined}
              className={cn("flex items-center gap-2.5 rounded-lg text-md font-semibold text-text transition-colors hover:bg-surface-2", row, big && "rounded-none", home && "bg-primary-soft text-primary hover:bg-primary-soft")}
            >
              {icon("home", LayoutDashboard, home)}
              <span className="flex-1 truncate">Dashboard</span>
            </Link>
          </li>
          {work.map(group)}
        </ul>
      </li>
      {settings.length > 0 && (
        <>
          <MenuLabel big={big}>Settings</MenuLabel>
          <li>
            <ul className={card}>{settings.map(group)}</ul>
          </li>
        </>
      )}
    </ul>
  );
}

/** The company's logo, or its first letter on the green brand tile. */
function Logo({ companyName, logo, size = 40 }: { companyName: string; logo?: string; size?: 32 | 40 }) {
  const box = size === 32 ? "size-8 rounded-lg" : "size-10 rounded-xl";
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element -- a small static logo
    <img src={logo} alt="" width={size} height={size} className={cn("shrink-0 object-contain", box)} />
  ) : (
    <span
      className={cn("grid shrink-0 place-items-center bg-primary-solid font-bold text-primary-fg before:content-[attr(data-letter)]", box, size === 32 ? "text-base" : "text-lg")}
      data-letter={(companyName.trim()[0] ?? "K").toUpperCase()}
      aria-hidden
    />
  );
}

/**
 * The whole menu over the page on a phone: a window like the others (review 24 Nov: focus stayed on the button, Tab
 * went on through the page behind, Esc did nothing). Focus goes to its title and stays inside; Esc closes it, and
 * focus goes back to the Menu button.
 */
function PhoneMenu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  useFocusTrap(box, true);
  return (
    <div className="no-print fixed inset-0 z-50 xl:hidden" data-layer>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <aside
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        }}
        className="outline-none absolute inset-y-0 left-0 flex w-80 max-w-[85vw] animate-slide-in flex-col border-r border-line bg-bg shadow-pop max-md:w-full max-md:max-w-none max-md:border-r-0"
      >
        <button className="absolute top-3 right-3 grid size-10 place-items-center rounded-full border border-line bg-surface text-text-2 hover:bg-surface-2" onClick={onClose} aria-label="Close menu">
          <X className="size-[18px]" />
        </button>
        {children}
      </aside>
    </div>
  );
}

/** The open menu's contents: the logo, Home and the groups. The same on a desktop and over the page on a phone. */
function MenuContent({
  modules,
  companyName,
  logo,
  open,
  toggle,
  big,
}: {
  modules: NavModule[];
  companyName: string;
  logo?: string;
  open: Set<ModuleKey>;
  toggle: (key: ModuleKey) => void;
  big?: boolean;
}) {
  const pathname = usePathname();
  const activeHref = pageOf(pathname, modules.flatMap((m) => m.pages))?.href;
  const tree = <GroupTree modules={modules} pathname={pathname} activeHref={activeHref} current={moduleOf(pathname, modules)} open={open} toggle={toggle} big={big} />;
  // On a phone: the whole screen, "Menu" as its title, the company on a card, the parts as cards, Sign out last.
  if (big)
    return (
      <>
        <div className="flex h-16 shrink-0 items-center px-4">
          <h2 data-autofocus="" tabIndex={-1} className="text-2xl font-bold tracking-tight text-text outline-none">
            Menu
          </h2>
        </div>
        <nav className="flex-1 scroll-y px-4 pb-8" aria-label="Main">
          <Link href={HOME_HREF} className="mb-3 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3" aria-label={`${companyName}, ${PRODUCT_NAME}, home`}>
            <Logo companyName={companyName} logo={logo} size={40} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-lead font-semibold text-text">{companyName}</span>{" "}
              <span className="truncate text-sm text-text-2">{PRODUCT_NAME}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
          </Link>
          {tree}
          <form action={logoutAction} className="mt-5">
            <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-md font-semibold text-bad">
              <LogOut className="size-[18px]" aria-hidden />
              Sign out
            </button>
          </form>
        </nav>
      </>
    );
  return (
    <>
      <div className="flex h-16 shrink-0 items-center px-3">
        {/* The company's name first, as it is shown (the name read out starts with what is seen: WCAG 2.5.3). */}
        <Link href={HOME_HREF} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-line px-2 py-1.5 hover:bg-surface-2" aria-label={`${companyName}, ${PRODUCT_NAME}, home`}>
          <Logo companyName={companyName} logo={logo} size={32} />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-md font-semibold text-text">{companyName}</span>{" "}
            {/* The space keeps the two names apart in the link's text, so what is read out matches what is shown (WCAG 2.5.3). */}
            <span className="truncate text-xs text-muted">{PRODUCT_NAME}</span>
          </span>
        </Link>
      </div>
      <nav className="flex-1 scroll-y px-3 pt-1 pb-4" aria-label="Main">
        {tree}
      </nav>
    </>
  );
}

/**
 * One group in the folded menu: its icon. Hovering, focusing or clicking it shows the group's name
 * and its pages beside it; ↓, Enter or Space moves into them, ↑ ↓ Home End move, Esc closes (back on
 * the icon), Tab moves on to the next icon. The group the current page is in is marked.
 */
function StripGroup({ m, current, activeHref }: { m: NavModule; current: boolean; activeHref: string | undefined }) {
  const Icon = ICONS[m.icon];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLLIElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const focusAt = useRef<number | null>(null);
  // Focus put back on the icon by Esc does not open its pages again.
  const quiet = useRef(false);
  const menuId = useId();
  const total = moduleTotal(m);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    // Beside the icon, kept inside the window (a long group, Settings, moves up to fit).
    const height = 52 + m.pages.length * 36 + (m.pages.some((p) => p.lineBefore) ? 13 : 0);
    setPos({ top: Math.max(8, Math.min(r.top - 6, window.innerHeight - height - 8)), left: r.right + 10 });
  }, [m.pages]);
  const show = () => {
    window.clearTimeout(timer.current);
    place();
    setOpen(true);
  };
  const hide = (delay = 150) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), delay);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Esc closes it wherever focus is (hovered with the mouse, or in the pages: focus goes back to the icon).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      if (wrap.current?.contains(document.activeElement)) {
        quiet.current = true;
        btn.current?.focus();
      }
    };
    const onResize = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  // Into the pages once they are drawn.
  useEffect(() => {
    if (!open || focusAt.current === null) return;
    const list = items();
    const i = focusAt.current < 0 ? list.length - 1 : focusAt.current;
    list[i]?.focus();
    focusAt.current = null;
  }, [open]);
  const enter = (i: number) => {
    if (open) {
      const list = items();
      list[i < 0 ? list.length - 1 : i]?.focus();
    } else {
      focusAt.current = i;
      show();
    }
  };

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      enter(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      enter(-1);
    }
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Tab") {
      // On to the next icon (or back to this one): the pages close.
      e.preventDefault();
      setOpen(false);
      if (e.shiftKey) {
        quiet.current = true;
        btn.current?.focus();
      } else {
        const all = [...(btn.current?.closest("nav")?.querySelectorAll<HTMLElement>("[data-strip-item]") ?? [])];
        const next = all[all.indexOf(btn.current!) + 1];
        (next ?? btn.current)?.focus();
      }
    }
  };

  return (
    <li
      ref={wrap}
      className="relative flex"
      onMouseEnter={show}
      onMouseLeave={() => hide()}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) hide(0);
      }}
    >
      <button
        ref={btn}
        type="button"
        data-strip-item
        aria-label={`${m.title}${total ? `, ${total} to look at` : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onFocus={() => {
          if (quiet.current) quiet.current = false;
          else show();
        }}
        onClick={show}
        onKeyDown={onButtonKey}
        className={cn(
          "relative grid size-10 place-items-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
          open && "bg-surface-2 text-text",
          current && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
        )}
      >
        <Icon className="size-[19px]" aria-hidden />
        {total > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-action-solid ring-2 ring-surface" aria-hidden />}
      </button>
      {open && pos && (
        <div className="fixed z-50 w-56 animate-in rounded-xl border border-line bg-surface p-1.5 shadow-pop" style={{ top: pos.top, left: pos.left }} onMouseEnter={show} onMouseLeave={() => hide()}>
          <p id={`${menuId}-t`} className="px-2.5 pt-1.5 pb-1.5 text-xs font-bold text-text-2">
            {m.title}
          </p>
          <ul ref={menu} id={menuId} role="menu" aria-labelledby={`${menuId}-t`} onKeyDown={onMenuKey}>
            {m.pages.map((p) => {
              const active = p.href === activeHref;
              return (
                <li key={p.href} role="none" className={cn(p.lineBefore && "mt-1.5 border-t border-line pt-1.5")}>
                  <Link
                    href={p.href}
                    role="menuitem"
                    tabIndex={-1}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center justify-between gap-2 rounded-lg px-2.5 text-md text-text-2 hover:bg-surface-2 hover:text-text focus-visible:bg-surface-2",
                      active && "bg-primary-soft font-semibold text-primary hover:bg-primary-soft hover:text-primary",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <PageIcon href={p.href} className={active ? "text-primary" : "text-muted"} />
                      <span className="truncate">{p.label}</span>
                    </span>
                    {!!p.badge && <Count n={p.badge} label={p.badgeLabel ?? "unread"} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

/** The folded menu: the logo, Home and one icon per group. */
function Strip({ modules, companyName, logo }: { modules: NavModule[]; companyName: string; logo?: string }) {
  const pathname = usePathname();
  const activeHref = pageOf(pathname, modules.flatMap((m) => m.pages))?.href;
  const current = moduleOf(pathname, modules);
  const home = isActive(pathname, HOME_HREF);
  return (
    <>
      <div className="grid h-14 shrink-0 place-items-center">
        <Link href={HOME_HREF} className="rounded-lg" aria-label={`${PRODUCT_NAME}, ${companyName}, home`}>
          <Logo companyName={companyName} logo={logo} size={32} />
        </Link>
      </div>
      <nav aria-label="Main" className="flex-1 px-2.5 pt-1">
        <ul className="flex flex-col items-center gap-0.5">
          <li className="flex">
            <Link
              href={HOME_HREF}
              data-strip-item
              aria-label="Dashboard"
              title="Dashboard"
              aria-current={home ? "page" : undefined}
              className={cn(
                "grid size-10 place-items-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
                home && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
              )}
            >
              <LayoutDashboard className="size-[19px]" aria-hidden />
            </Link>
          </li>
          {modules.map((m) => {
            if (!isSingle(m)) return <StripGroup key={m.key} m={m} current={m.key === current} activeHref={activeHref} />;
            const Icon = ICONS[m.icon];
            const on = m.key === current;
            return (
              <li key={m.key} className="flex">
                <Link
                  href={m.pages[0]!.href}
                  data-strip-item
                  aria-label={m.title}
                  title={m.title}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "grid size-10 place-items-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
                    on && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
                  )}
                >
                  <Icon className="size-[19px]" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/* ------------------------------------------------------------------ Shell */

/** From this width the menu can be open beside the page; below it, it is the strip of icons. */
const WIDE = "(min-width: 1280px)";
/*
 * Until the person chooses, the menu is open beside the page only from 1440 px: on a 1280–1439 px laptop the strip
 * leaves the page 188 px more, so a record's tables fit beside its panel (e2e 24 Nov: at 1280 the last column of
 * prices, plans, packing and payments was cut off). Opening or folding it with its button is remembered and wins.
 * Arbitrary breakpoints sort before the named ones, so "under 1440" is written max-[1439.98px], never md:flex with
 * min-[1440px]:hidden after it (that left the strip showing beside the open menu).
 */

/**
 * The frame around every signed-in screen. Desktop: the menu down the left (Home and the groups with
 * their pages: two levels), which folds to a strip of icons, and one row above the page (search, New,
 * alerts, the account). The fold is remembered; on a screen under 1280 px the menu is the strip and
 * its button opens the whole menu over the page. Phone: the row at the top, the menu over the page,
 * and a bottom bar with the main action in the middle.
 */
export function AppShell({
  modules,
  companyName,
  user,
  unread = 0,
  canCreate = false,
  newItems = [],
  logo,
  initialOpen = [],
  initialFold = null,
  children,
}: {
  /** The groups and pages this person may open (the layout leaves out the rest). */
  modules: NavModule[];
  companyName: string;
  /** The company's logo (none: its initial). */
  logo?: string;
  user: { name: string; email: string; role: string };
  unread?: number;
  canCreate?: boolean;
  /** What "New" offers this person (none: no New button). */
  newItems?: NewItem[];
  /** The groups left open (their cookie). */
  initialOpen?: ModuleKey[];
  /** The menu left folded (true) or open (false); null: never chosen. */
  initialFold?: boolean | null;
  children: ReactNode;
}) {
  useFollowSystemLook();
  const [drawer, setDrawer] = useState(false);
  const [fold, setFold] = useState(initialFold);
  const pathname = usePathname();
  const current = moduleOf(pathname, modules);
  // The groups the person opened (remembered in a cookie); the current page's group opens by itself on top,
  // unless they closed it on this page.
  const [opened, setOpened] = useState<Set<ModuleKey>>(() => new Set(initialOpen));
  const [shut, setShut] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setDrawer(false);
    setShut(false);
  }
  const open = new Set(opened);
  if (current && !shut) open.add(current);
  const toggle = (key: ModuleKey) => {
    const next = new Set(opened);
    if (open.has(key)) {
      next.delete(key);
      if (key === current) setShut(true);
    } else {
      next.add(key);
      if (key === current) setShut(false);
    }
    setOpened(next);
    writeCookie(OPEN_COOKIE, [...next].join("."));
  };
  const folded = fold === true;
  /** Never chosen: open from 1440 px, the strip under it. */
  const auto = fold === null;
  // On a wide screen the button folds and opens the menu beside the page; on a smaller one it opens it over the page.
  const choose = (toFold: boolean) => {
    if (!window.matchMedia(WIDE).matches) return setDrawer(true);
    setFold(toFold);
    writeCookie(FOLD_COOKIE, toFold ? "1" : "0");
  };
  /** The button beside the logo: it opens a menu shown as the strip, and folds one shown open. */
  const foldButton = (shownFolded: boolean, className: string) => (
    <button type="button" className={cn(buttonClass("ghost", "icon"), className)} onClick={() => choose(!shownFolded)} aria-label={shownFolded ? "Open the menu" : "Fold the menu"} aria-pressed={shownFolded}>
      {shownFolded ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
    </button>
  );

  const tab = (href: string, label: string, Icon: LucideIcon, badge?: number) => {
    const active = isActive(pathname, href);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs", active ? "font-semibold text-primary" : "text-muted")}
      >
        {/* The tab you are on: its icon on a soft green pill. */}
        <span className={cn("grid h-7 w-11 place-items-center rounded-full", active && "bg-primary-soft")}>
          <Icon className="size-[21px]" strokeWidth={active ? 2 : 1.75} aria-hidden />
        </span>
        {label}
        {!!badge && <CountDot n={badge} className="absolute top-1 left-1/2 ml-2" aria-label={`${badge} unread`} />}
      </Link>
    );
  };

  return (
    // data-menu: lists read it to know how much width the page has (DataTable, globals.css "fits" and "roomy").
    <div className="group/shell min-h-dvh md:flex" data-shell="" data-menu={folded ? "folded" : auto ? "auto" : "open"}>
      {/* Where you have been in this tab: Back returns to a list as you left it. */}
      <Suspense fallback={null}>
        <NavMemoryKeeper />
      </Suspense>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Desktop: the menu beside the page (from 1440 px until chosen, from 1280 px when opened, never when folded) */}
      <aside
        aria-label="Menu"
        className={cn("no-print sticky top-0 h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-surface", folded ? "hidden" : auto ? "hidden min-[1440px]:flex" : "hidden xl:flex")}
      >
        <MenuContent modules={modules} companyName={companyName} logo={logo} open={open} toggle={toggle} />
      </aside>
      {/* Desktop: the menu folded to a strip of icons (always under 1280 px; under 1440 px until chosen) */}
      <aside
        aria-label="Menu, folded"
        className={cn("no-print sticky top-0 h-dvh w-[60px] shrink-0 flex-col border-r border-line bg-surface", folded ? "hidden md:flex" : auto ? "hidden md:max-[1439.98px]:flex" : "hidden md:flex xl:hidden")}
      >
        <Strip modules={modules} companyName={companyName} logo={logo} />
      </aside>

      {/* Phone and small screens: the whole menu over the page, rows easy to tap */}
      {drawer && (
        <PhoneMenu onClose={() => setDrawer(false)}>
          <MenuContent modules={modules} companyName={companyName} logo={logo} open={open} toggle={toggle} big />
        </PhoneMenu>
      )}

      <div className="min-w-0 flex-1">
        {/* On a phone a record's own top bar (← and its name) takes this one's place (globals.css). */}
        <header data-shell-top="" className="no-print sticky top-0 z-30 border-b border-line bg-surface">
          <div className={cn(RULES.page.width, RULES.page.sides, "flex h-14 items-center gap-2 md:pl-3")}>
            <button type="button" className={cn(buttonClass("ghost", "icon"), "-ml-2 md:hidden")} onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
              <MenuIcon aria-hidden />
            </button>
            {/* On a phone a top page's own name takes this one's place (PageHeader's data-page-title, globals.css). */}
            <Link data-shell-logo="" href={HOME_HREF} className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg md:hidden" aria-label={`${PRODUCT_NAME}, ${companyName}, home`}>
              <Logo companyName={companyName} logo={logo} size={32} />
              <span className="text-lead font-bold tracking-tight text-text max-[380px]:hidden">{PRODUCT_NAME}</span>
            </Link>
            {/* Under 1280 px the menu is the strip: the button opens the whole menu over the page. */}
            <button type="button" className={cn(buttonClass("ghost", "icon"), "hidden md:inline-flex xl:hidden")} onClick={() => setDrawer(true)} aria-label="Open the menu" aria-expanded={drawer}>
              <PanelLeftOpen aria-hidden />
            </button>
            {auto ? (
              <>
                {foldButton(true, "hidden xl:max-[1439.98px]:inline-flex")}
                {foldButton(false, "hidden min-[1440px]:inline-flex")}
              </>
            ) : (
              foldButton(folded, "hidden xl:inline-flex")
            )}
            <TopSearch />
            <div className="ml-auto flex items-center gap-1.5">
              <PhoneSearch />
              {newItems.length > 0 && (
                <span className="hidden md:block">
                  <NewMenu items={newItems} />
                </span>
              )}
              <Link href="/notifications" className={cn(buttonClass("ghost", "icon"), "relative")}>
                <Bell aria-hidden />
                <span className="sr-only">{unread ? `Notifications, ${unread} unread` : "Notifications"}</span>
                {!!unread && (
                  <CountDot n={unread} className="absolute top-0.5 right-0" aria-hidden />
                )}
              </Link>
              <AccountMenu user={user} companyName={companyName} />
            </div>
          </div>
        </header>

        <main id="main" className={cn(RULES.page.frame, "pb-28 md:pb-10")}>
          {children}
          <p className="no-print pt-2 text-xs text-muted">
            © {new Date().getFullYear()} {PRODUCT_NAME} · {companyName}
          </p>
        </main>
      </div>

      {/* Phone: bottom tab bar, thumb-reachable, with the main action in the middle. On a record's page with a next
          step, that step's button takes its place (PageHeader's data-record-dock, globals.css). */}
      <nav
        data-quick-nav=""
        aria-label="Quick"
        className="no-print fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30 flex h-16 items-stretch rounded-[22px] border border-line bg-surface/95 px-1.5 shadow-pop backdrop-blur md:hidden"
      >
        {tab(HOME_HREF, "Dashboard", LayoutDashboard)}
        {tab("/inquiries", "Inquiries", Inbox)}
        {canCreate ? (
          <div data-quick-fab="" className="flex flex-1 items-center justify-center">
            <Link href="/inquiries?panel=new-inquiry" aria-label="New inquiry" className="grid size-[50px] place-items-center rounded-2xl bg-primary-solid text-primary-fg shadow-pop active:scale-95">
              <Plus className="size-6" strokeWidth={2.25} aria-hidden />
            </Link>
          </div>
        ) : (
          tab("/customers", "Customers", Building2)
        )}
        {tab("/notifications", "Alerts", Bell, unread)}
        <button type="button" onClick={() => setDrawer(true)} aria-expanded={drawer} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-2xs text-muted">
          <span className="grid h-7 w-11 place-items-center rounded-full">
            <MenuIcon className="size-[21px]" strokeWidth={1.75} aria-hidden />
          </span>
          Menu
        </button>
      </nav>
    </div>
  );
}
