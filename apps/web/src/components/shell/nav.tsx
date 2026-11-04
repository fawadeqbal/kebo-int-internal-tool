"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Banknote,
  BarChart3,
  Bell,
  Building2,
  ChevronRight,
  ClipboardList,
  Factory,
  FileText,
  House,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  SquareCheckBig,
  Sun,
  User,
  Users,
  X,
} from "lucide-react";
import { Avatar, buttonClass, cn, Kbd } from "@kebo/ui";
import { logoutAction } from "@/app/login/actions";
import { HOME_HREF, moduleOf, moduleTotal, OPEN_COOKIE, pageOf, RAIL_COOKIE, type ModuleKey, type NavIcon, type NavModule, type NavPage } from "@/lib/nav";

export type { NavModule, NavPage } from "@/lib/nav";

const ICONS: Record<NavIcon, typeof House> = {
  home: House,
  work: SquareCheckBig,
  sales: FileText,
  orders: Package,
  purchasing: Factory,
  finance: Banknote,
  reports: BarChart3,
  settings: Settings,
  access: Users,
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
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
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
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="flex rounded-full"
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
          // Close after a choice, but not for a form button: removing the form before it submits cancels the submit (Sign out).
          onClick={(e) => !(e.target as HTMLElement).closest("form") && setOpen(false)}
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

function ThemeMenu() {
  const [mode, setMode] = useState<Mode>("system");
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let saved: Mode = "system";
    try {
      saved = (localStorage.getItem("theme") as Mode) || "system";
    } catch {
      // storage blocked: keep the default
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved choice once on mount
    setMode(saved);
    setDark(document.documentElement.classList.contains("dark"));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let m: Mode = "system";
      try {
        m = (localStorage.getItem("theme") as Mode) || "system";
      } catch {
        // storage blocked: keep the default
      }
      if (m === "system") {
        applyTheme("system");
        setDark(mq.matches);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const choose = (m: Mode) => {
    try {
      localStorage.setItem("theme", m);
    } catch {
      // storage blocked: keep the default
    }
    setMode(m);
    applyTheme(m);
    setDark(document.documentElement.classList.contains("dark"));
  };
  const options: [Mode, string, typeof Sun][] = [
    ["light", "Light", Sun],
    ["dark", "Dark", Moon],
    ["system", "System", Monitor],
  ];
  return (
    <Menu
      label="Theme"
      trigger={<span className={buttonClass("ghost", "icon-sm")}>{dark ? <Moon aria-hidden /> : <Sun aria-hidden />}</span>}
    >
      {options.map(([m, label, Icon]) => (
        <button
          key={m}
          type="button"
          role="menuitemradio"
          aria-checked={mode === m}
          onClick={() => choose(m)}
          className={cn(menuItem, mode === m && "font-medium text-primary [&_svg]:text-primary")}
        >
          <Icon aria-hidden />
          {label}
        </button>
      ))}
    </Menu>
  );
}

/* ------------------------------------------------------------------ Account */

function AccountMenu({ user }: { user: { name: string; email: string; role: string } }) {
  return (
    <Menu label="Account" className="w-60" trigger={<Avatar name={user.name} size={30} />}>
      <div className="px-2 py-1.5 text-xs text-muted">
        <span className="block truncate text-sm font-medium text-text">{user.name}</span>
        <span className="block truncate">{user.email}</span>
      </div>
      <div className="-mx-1 my-1 h-px bg-line" />
      <Link href="/account" role="menuitem" className={menuItem}>
        <User aria-hidden />
        Your account & password
      </Link>
      <form action={logoutAction}>
        <button type="submit" role="menuitem" className={menuItem}>
          <LogOut aria-hidden />
          Sign out
        </button>
      </form>
    </Menu>
  );
}

/* ------------------------------------------------------------------ Sidebar */

/** A count on a page or a closed module: what waits for this person. */
function Count({ n, label, tone = "warn" }: { n: number; label: string; tone?: "warn" | "neutral" }) {
  return (
    <span
      className={cn(
        "inline-grid h-[18px] min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular",
        tone === "warn" ? "bg-warn-soft text-warn" : "bg-surface-2 text-text-2",
      )}
      aria-label={`${n} ${label}`}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function writeCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // cookies blocked: the sidebar just isn't remembered
  }
}

/** The page link inside an open module (expanded sidebar and phone drawer). */
function PageLink({ page, active, big }: { page: NavPage; active: boolean; big?: boolean }) {
  return (
    <Link
      href={page.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2 rounded-lg pr-2 pl-9 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
        big ? "min-h-11" : "h-8",
        active && "bg-primary-soft font-semibold text-primary hover:bg-primary-soft hover:text-primary",
      )}
    >
      {active && <span className="absolute inset-y-1.5 -left-3 w-[3px] rounded-full bg-primary-solid" aria-hidden />}
      <span className="flex-1 truncate">{page.label}</span>
      {!!page.badge && <Count n={page.badge} label={page.badgeLabel ?? "unread"} />}
    </Link>
  );
}

/** Home, then each module: a button that opens and closes its pages (aria-expanded); a closed one shows its total. */
function ModuleTree({
  modules,
  pathname,
  activeHref,
  open,
  toggle,
  big,
}: {
  modules: NavModule[];
  pathname: string;
  activeHref: string | undefined;
  open: Set<ModuleKey>;
  toggle: (key: ModuleKey) => void;
  big?: boolean;
}) {
  const id = useId();
  const home = isActive(pathname, HOME_HREF);
  const row = big ? "min-h-11" : "h-9";
  return (
    <ul className="space-y-0.5">
      <li>
        <Link
          href={HOME_HREF}
          aria-current={home ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-2.5 rounded-lg px-2 text-sm font-semibold text-text transition-colors hover:bg-surface-2",
            row,
            home && "bg-primary-soft text-primary hover:bg-primary-soft",
          )}
        >
          {home && <span className="absolute inset-y-1.5 -left-3 w-[3px] rounded-full bg-primary-solid" aria-hidden />}
          <House className="size-4 shrink-0" aria-hidden />
          <span className="flex-1 truncate">Home</span>
        </Link>
      </li>
      {modules.map((m) => {
        const Icon = ICONS[m.icon];
        const isOpen = open.has(m.key);
        const total = moduleTotal(m);
        const listId = `${id}-${m.key}`;
        return (
          <li key={m.key}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={listId}
              onClick={() => toggle(m.key)}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-semibold text-text transition-colors hover:bg-surface-2", row)}
            >
              <Icon className="size-4 shrink-0 text-text-2" aria-hidden />
              <span className="flex-1 truncate">{m.title}</span>
              {!isOpen && total > 0 && <Count n={total} label="to look at" tone="neutral" />}
              <ChevronRight className={cn("size-3.5 shrink-0 text-muted transition-transform", isOpen && "rotate-90")} aria-hidden />
            </button>
            {/* Closed: still in the page (hidden), so its addresses are there for the browser and the checks. */}
            <ul id={listId} hidden={!isOpen} className="mt-0.5 mb-1 space-y-0.5">
              {m.pages.map((p) => (
                <li key={p.href}>
                  <PageLink page={p} active={p.href === activeHref} big={big} />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

/** The company's logo, or its initials. */
function Logo({ companyName, logo }: { companyName: string; logo?: string }) {
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element -- a small static logo
    <img src={logo} alt="" width={32} height={32} className="size-8 shrink-0" />
  ) : (
    <Avatar name={companyName} size={32} className="shrink-0" />
  );
}

/**
 * The collapsed sidebar: one icon per module. Hovering or focusing one shows its pages in a small
 * menu beside it; ↓, Enter or Space moves into the menu, ↑ ↓ Home End move in it, Esc closes it
 * (back on the icon), Tab moves on to the next icon.
 */
function RailModule({ m, current, activeHref }: { m: NavModule; current: boolean; activeHref: string | undefined }) {
  const Icon = ICONS[m.icon];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const focusAt = useRef<number | null>(null);
  // Focus put back on the icon by Esc does not open the menu again.
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
    // Beside the icon, kept inside the window.
    const height = 44 + m.pages.length * 36;
    setPos({ top: Math.max(8, Math.min(r.top - 6, window.innerHeight - height - 8)), left: r.right + 10 });
  }, [m.pages.length]);
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
  // Esc closes it wherever focus is (hovered with the mouse, or in the menu: focus goes back to the icon).
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
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  // Into the menu once it is drawn.
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
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
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
      // On to the next icon (or back to this one): the menu closes.
      e.preventDefault();
      setOpen(false);
      if (e.shiftKey) {
        quiet.current = true;
        btn.current?.focus();
      } else {
        const icons = [...(btn.current?.closest("nav")?.querySelectorAll<HTMLElement>("[data-rail-item]") ?? [])];
        const next = icons[icons.indexOf(btn.current!) + 1];
        (next ?? btn.current)?.focus();
      }
    }
  };

  return (
    <div
      ref={wrap}
      className="relative"
      onMouseEnter={show}
      onMouseLeave={() => hide()}
      onBlur={(e) => {
        if (!wrap.current?.contains(e.relatedTarget as Node)) hide(0);
      }}
    >
      <button
        ref={btn}
        type="button"
        data-rail-item
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
          "relative grid size-10 place-items-center rounded-[10px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
          open && "bg-surface-2 text-text",
          current && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
        )}
      >
        <Icon className="size-[18px]" aria-hidden />
        {total > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-warn ring-2 ring-surface" aria-hidden />}
      </button>
      {open && pos && (
        <div
          className="fixed z-50 w-56 animate-in rounded-xl border border-line bg-surface p-2 shadow-pop"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={show}
          onMouseLeave={() => hide()}
        >
          <p id={`${menuId}-t`} className="px-2.5 pt-1 pb-2 text-[13px] font-semibold text-text">
            {m.title}
          </p>
          <ul ref={menu} id={menuId} role="menu" aria-labelledby={`${menuId}-t`} onKeyDown={onMenuKey}>
            {m.pages.map((p) => {
              const active = p.href === activeHref;
              return (
                <li key={p.href} role="none">
                  <Link
                    href={p.href}
                    role="menuitem"
                    tabIndex={-1}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center justify-between gap-2 rounded-lg px-2.5 text-sm text-text-2 hover:bg-surface-2 hover:text-text focus-visible:bg-surface-2",
                      active && "bg-primary-soft font-medium text-primary hover:bg-primary-soft hover:text-primary",
                    )}
                  >
                    <span className="truncate">{p.label}</span>
                    {!!p.badge && <Count n={p.badge} label={p.badgeLabel ?? "unread"} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The sidebar's contents: the company at the top, the modules, who is signed in. */
function SidebarContent({
  modules,
  companyName,
  roleLabel,
  logo,
  open,
  toggle,
  big,
  onCollapse,
}: {
  modules: NavModule[];
  companyName: string;
  roleLabel: string;
  logo?: string;
  open: Set<ModuleKey>;
  toggle: (key: ModuleKey) => void;
  big?: boolean;
  onCollapse?: () => void;
}) {
  const pathname = usePathname();
  const activeHref = pageOf(pathname, modules.flatMap((m) => m.pages))?.href;
  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line pr-2 pl-4">
        <Link href={HOME_HREF} className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg", big && "pr-10")}>
          <Logo companyName={companyName} logo={logo} />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold text-text">{companyName}</span>
            <span className="block text-[11px] text-muted">RFQ Desk</span>
          </span>
        </Link>
        {onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="Collapse the sidebar" title="Collapse the sidebar" className={buttonClass("ghost", "icon-sm")}>
            <PanelLeftClose aria-hidden />
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
        <ModuleTree modules={modules} pathname={pathname} activeHref={activeHref} open={open} toggle={toggle} big={big} />
      </nav>
      <div className="border-t border-line p-3 text-[11px] text-muted">
        Signed in as <span className="font-medium text-text-2">{roleLabel}</span>
      </div>
    </>
  );
}

/** The collapsed sidebar: the logo, the button that opens it again, Home and one icon per module. */
function RailContent({ modules, companyName, logo, onExpand }: { modules: NavModule[]; companyName: string; logo?: string; onExpand: () => void }) {
  const pathname = usePathname();
  const activeHref = pageOf(pathname, modules.flatMap((m) => m.pages))?.href;
  const current = moduleOf(pathname, modules);
  const home = isActive(pathname, HOME_HREF);
  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-center border-b border-line">
        <Link href={HOME_HREF} aria-label={`${companyName}, home`} className="rounded-lg">
          <Logo companyName={companyName} logo={logo} />
        </Link>
      </div>
      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto px-3 py-3" aria-label="Main">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand the sidebar"
          title="Expand the sidebar"
          className="mb-1 grid size-10 place-items-center rounded-[10px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <PanelLeftOpen className="size-[18px]" aria-hidden />
        </button>
        <Link
          href={HOME_HREF}
          data-rail-item
          aria-label="Home"
          aria-current={home ? "page" : undefined}
          title="Home"
          className={cn(
            "grid size-10 place-items-center rounded-[10px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
            home && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
          )}
        >
          <House className="size-[18px]" aria-hidden />
        </Link>
        {modules.map((m) => (
          <RailModule key={m.key} m={m} current={m.key === current} activeHref={activeHref} />
        ))}
      </nav>
    </>
  );
}

/* ------------------------------------------------------------------ Shell */

/** Sidebar + top bar around every signed-in screen; a bottom tab bar on phones. */
export function AppShell({
  modules,
  companyName,
  user,
  unread = 0,
  canCreate = false,
  logo,
  initialRail = false,
  initialOpen = [],
  children,
}: {
  /** The modules and pages this person may open (the layout leaves out the rest). */
  modules: NavModule[];
  companyName: string;
  /** The company's logo (none: its initials). */
  logo?: string;
  user: { name: string; email: string; role: string };
  unread?: number;
  canCreate?: boolean;
  /** The sidebar was left collapsed to icons (its cookie), so the first paint is already right. */
  initialRail?: boolean;
  /** The modules left open (their cookie). */
  initialOpen?: ModuleKey[];
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  const [rail, setRail] = useState(initialRail);
  const pathname = usePathname();
  const current = moduleOf(pathname, modules);
  // The modules the person opened (remembered in a cookie); the current page's module opens by itself on top,
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
  const setRailAndRemember = (v: boolean) => {
    setRail(v);
    writeCookie(RAIL_COOKIE, v ? "1" : "0");
  };

  const tab = (href: string, label: string, Icon: typeof LayoutDashboard, badge?: number) => {
    const active = isActive(pathname, href);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px]",
          active ? "font-medium text-primary" : "text-muted",
        )}
      >
        <Icon className="size-[22px]" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
        {label}
        {!!badge && (
          <span
            className="absolute top-1 left-1/2 ml-2 min-w-4 rounded-full bg-bad-solid px-1 text-center text-[10px] leading-4 font-semibold text-white"
            aria-label={`${badge} unread`}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className={cn("min-h-dvh", rail ? "lg:pl-16" : "lg:pl-60")} data-sidebar={rail ? "rail" : "open"}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Desktop sidebar: the modules, or (collapsed) their icons */}
      <aside
        aria-label="Sidebar"
        className={cn("no-print fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface lg:flex", rail ? "w-16" : "w-60")}
      >
        {rail ? (
          <RailContent modules={modules} companyName={companyName} logo={logo} onExpand={() => setRailAndRemember(false)} />
        ) : (
          <SidebarContent
            modules={modules}
            companyName={companyName}
            roleLabel={user.role}
            logo={logo}
            open={open}
            toggle={toggle}
            onCollapse={() => setRailAndRemember(true)}
          />
        )}
      </aside>

      {/* Phone / tablet drawer: the same modules, rows easy to tap */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-hidden />
          <aside aria-label="Menu" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-slide-in flex-col border-r border-line bg-surface shadow-pop">
            <button
              className="absolute top-2 right-2 grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2"
              onClick={() => setDrawer(false)}
              aria-label="Close menu"
            >
              <X className="size-4" />
            </button>
            <SidebarContent modules={modules} companyName={companyName} roleLabel={user.role} logo={logo} open={open} toggle={toggle} big />
          </aside>
        </div>
      )}

      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
        <button
          type="button"
          className={cn(buttonClass("ghost", "icon-sm"), "lg:hidden")}
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
          aria-expanded={drawer}
        >
          <MenuIcon aria-hidden />
        </button>
        <form action="/inquiries" role="search" aria-label="Search inquiries" className="relative w-full max-w-sm">
          <label htmlFor="global-search" className="sr-only">
            Search inquiries
          </label>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="global-search"
            name="q"
            type="search"
            placeholder="Search inquiries…"
            className="h-8 w-full rounded-lg border border-line bg-surface pr-10 pl-9 text-sm text-text shadow-card transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          />
          <input type="hidden" name="status" value="all" />
          <span className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline-flex">
            <Kbd>/</Kbd>
          </span>
        </form>
        <div className="ml-auto flex items-center gap-1.5">
          {canCreate && (
            <Link href="/inquiries/new" className={cn(buttonClass("primary", "sm"), "mr-1 hidden lg:inline-flex")} title="New inquiry (N)">
              <Plus aria-hidden /> New inquiry
            </Link>
          )}
          <Link
            href="/notifications"
            className={cn(buttonClass("ghost", "icon-sm"), "relative hidden lg:inline-flex")}
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          >
            <Bell aria-hidden />
            {!!unread && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-bad-solid ring-2 ring-bg" aria-hidden />}
          </Link>
          <ThemeMenu />
          <AccountMenu user={user} />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-28 sm:px-6 lg:pb-10">
        {children}
      </main>

      {/* Phone: bottom tab bar, thumb-reachable, with the main action in the middle */}
      <nav
        aria-label="Quick"
        className="no-print fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {tab("/dashboard", "Home", LayoutDashboard)}
        {tab("/inquiries", "Inquiries", ClipboardList)}
        {canCreate ? (
          <div className="flex flex-1 items-start justify-center">
            <Link
              href="/inquiries/new"
              aria-label="New inquiry"
              className="-mt-5 grid size-14 place-items-center rounded-full bg-primary-solid text-primary-fg shadow-pop ring-4 ring-bg active:scale-95"
            >
              <Plus className="size-7" strokeWidth={2.25} aria-hidden />
            </Link>
          </div>
        ) : (
          tab("/customers", "Customers", Building2)
        )}
        {tab("/notifications", "Alerts", Bell, unread)}
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-expanded={drawer}
          className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px] text-muted"
        >
          <MenuIcon className="size-[22px]" strokeWidth={1.75} aria-hidden />
          Menu
        </button>
      </nav>
    </div>
  );
}
