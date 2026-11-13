"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  Building2,
  ChevronRight,
  ClipboardList,
  House,
  LogOut,
  Menu as MenuIcon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  TrendingUp,
  User,
  Wallet,
  X,
} from "lucide-react";
import { Avatar, buttonClass, cn, Kbd } from "@kebo/ui";
import { logoutAction } from "@/app/login/actions";
import { FOLD_COOKIE, HOME_HREF, isSingle, moduleOf, moduleTotal, OPEN_COOKIE, pageOf, type ModuleKey, type NavIcon, type NavModule, type NavPage } from "@/lib/nav";

export type { NavModule, NavPage } from "@/lib/nav";

const ICONS: Record<NavIcon, typeof House> = {
  home: House,
  sales: Package,
  purchasing: ShoppingCart,
  money: Wallet,
  reports: TrendingUp,
  settings: Settings,
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
      <div role="radiogroup" aria-labelledby="look-label" className="inline-flex overflow-hidden rounded-lg border border-line-strong">
        {options.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => choose(m)}
            className={cn("h-7 px-2.5 text-xs text-text-2 hover:bg-surface-2", mode === m && "bg-primary-soft font-semibold text-text hover:bg-primary-soft")}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Account, New */

function AccountMenu({ user, companyName }: { user: { name: string; email: string; role: string }; companyName: string }) {
  return (
    <Menu
      label="Account"
      className="w-64"
      trigger={
        <span className="flex items-center gap-2.5 rounded-xl lg:py-1 lg:pr-2 lg:pl-1 lg:hover:bg-surface-2">
          <Avatar name={user.name} size={34} className="font-bold" />
          <span className="hidden text-left leading-tight lg:block">
            <span className="block max-w-36 truncate text-[13px] font-semibold text-text">{user.name}</span>
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
    <span className="inline-grid h-[18px] min-w-5 place-items-center rounded-full bg-warn-soft px-1.5 text-[11px] font-semibold text-warn tabular" aria-label={`${n} ${label}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

function writeCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // cookies blocked: the menu just isn't remembered
  }
}

/** A page under its group (the menu, and the menu over the page on a phone). */
function PageLink({ page, active, big }: { page: NavPage; active: boolean; big?: boolean }) {
  return (
    <Link
      href={page.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg pr-2 pl-9 text-[13.5px] text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
        big ? "min-h-11" : "h-8",
        active && "bg-primary-soft font-semibold text-primary hover:bg-primary-soft hover:text-primary",
      )}
    >
      <span className="flex-1 truncate">{page.label}</span>
      {!!page.badge && <Count n={page.badge} label={page.badgeLabel ?? "unread"} />}
    </Link>
  );
}

/**
 * Home, then each group: a button that opens and closes its pages (aria-expanded). Two levels and no
 * more. A closed group shows the total of what waits in it; the group the current page is in is bold.
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
  const row = big ? "min-h-11" : "h-9";
  return (
    <ul className="space-y-0.5">
      <li>
        <Link
          href={HOME_HREF}
          aria-current={home ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-semibold text-text transition-colors hover:bg-surface-2",
            row,
            home && "bg-primary-soft text-primary hover:bg-primary-soft",
          )}
        >
          <House className="size-[17px] shrink-0" aria-hidden />
          <span className="flex-1 truncate">Home</span>
        </Link>
      </li>
      {modules.map((m) => {
        const Icon = ICONS[m.icon];
        const isOpen = open.has(m.key);
        const total = moduleTotal(m);
        const listId = `${id}-${m.key}`;
        // One page with the group's name (Reports): a link like Home, nothing to open.
        if (isSingle(m)) {
          const on = m.key === current;
          return (
            <li key={m.key}>
              <Link
                href={m.pages[0]!.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-semibold text-text transition-colors hover:bg-surface-2",
                  row,
                  on && "bg-primary-soft text-primary hover:bg-primary-soft",
                )}
              >
                <Icon className={cn("size-[17px] shrink-0", !on && "text-text-2")} aria-hidden />
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
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] text-text transition-colors hover:bg-surface-2",
                m.key === current ? "font-bold" : "font-semibold",
                row,
              )}
            >
              <Icon className="size-[17px] shrink-0 text-text-2" aria-hidden />
              <span className="flex-1 truncate">{m.title}</span>
              {!isOpen && total > 0 && <Count n={total} label="to look at" />}
              <ChevronRight className={cn("size-3.5 shrink-0 text-muted transition-transform", isOpen && "rotate-90")} aria-hidden />
            </button>
            {/* Closed: still in the page (hidden), so its addresses are there for the browser and the checks. */}
            <ul id={listId} hidden={!isOpen} className="mt-0.5 mb-1 space-y-0.5">
              {m.pages.map((p) => (
                <li key={p.href} className={cn(p.lineBefore && "relative mt-1.5 pt-1.5 before:absolute before:top-0 before:right-2 before:left-9 before:h-px before:bg-line")}>
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
  return (
    <>
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link href={HOME_HREF} className={cn("flex min-w-0 items-center gap-2.5 rounded-lg", big && "pr-10")} aria-label={`Kebo ERP, ${companyName}, home`}>
          <Logo companyName={companyName} logo={logo} size={32} />
          <span className="truncate text-[15.5px] font-bold tracking-tight text-text">Kebo ERP</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pt-1 pb-4" aria-label="Main">
        <GroupTree modules={modules} pathname={pathname} activeHref={activeHref} current={moduleOf(pathname, modules)} open={open} toggle={toggle} big={big} />
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
                      "flex h-9 items-center justify-between gap-2 rounded-lg px-2.5 text-[13.5px] text-text-2 hover:bg-surface-2 hover:text-text focus-visible:bg-surface-2",
                      active && "bg-primary-soft font-semibold text-primary hover:bg-primary-soft hover:text-primary",
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
        <Link href={HOME_HREF} className="rounded-lg" aria-label={`Kebo ERP, ${companyName}, home`}>
          <Logo companyName={companyName} logo={logo} size={32} />
        </Link>
      </div>
      <nav aria-label="Main" className="flex-1 px-2.5 pt-1">
        <ul className="flex flex-col items-center gap-0.5">
          <li className="flex">
            <Link
              href={HOME_HREF}
              data-strip-item
              aria-label="Home"
              title="Home"
              aria-current={home ? "page" : undefined}
              className={cn(
                "grid size-10 place-items-center rounded-lg text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
                home && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
              )}
            >
              <House className="size-[19px]" aria-hidden />
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

/** From this width the menu is open beside the page unless it was folded; below it, it is the strip of icons. */
const WIDE = "(min-width: 1280px)";

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
  // On a wide screen the button folds and opens the menu beside the page; on a smaller one it opens it over the page.
  const onFoldButton = () => {
    if (!window.matchMedia(WIDE).matches) return setDrawer(true);
    setFold(!folded);
    writeCookie(FOLD_COOKIE, folded ? "0" : "1");
  };

  const tab = (href: string, label: string, Icon: typeof House, badge?: number) => {
    const active = isActive(pathname, href);
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn("relative flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px]", active ? "font-semibold text-primary" : "text-muted")}
      >
        <Icon className="size-[22px]" strokeWidth={active ? 2.25 : 1.75} aria-hidden />
        {label}
        {!!badge && (
          <span className="absolute top-1 left-1/2 ml-2 min-w-4 rounded-full bg-bad-solid px-1 text-center text-[10px] leading-4 font-semibold text-white" aria-label={`${badge} unread`}>
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    // data-menu: lists read it to know how much width the page has (DataTable).
    <div className="group/shell min-h-dvh md:flex" data-menu={folded ? "folded" : "open"}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Desktop: the menu beside the page (from 1280 px, unless folded) */}
      <aside aria-label="Menu" className={cn("no-print sticky top-0 h-dvh w-[232px] shrink-0 flex-col border-r border-line bg-surface", folded ? "hidden" : "hidden xl:flex")}>
        <MenuContent modules={modules} companyName={companyName} logo={logo} open={open} toggle={toggle} />
      </aside>
      {/* Desktop: the menu folded to a strip of icons (always under 1280 px) */}
      <aside aria-label="Menu, folded" className={cn("no-print sticky top-0 h-dvh w-[60px] shrink-0 flex-col border-r border-line bg-surface", folded ? "hidden md:flex" : "hidden md:flex xl:hidden")}>
        <Strip modules={modules} companyName={companyName} logo={logo} />
      </aside>

      {/* Phone and small screens: the whole menu over the page, rows easy to tap */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 xl:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} aria-hidden />
          <aside aria-label="Menu" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-slide-in flex-col border-r border-line bg-surface shadow-pop">
            <button className="absolute top-2 right-2 grid size-10 place-items-center rounded-md text-muted hover:bg-surface-2" onClick={() => setDrawer(false)} aria-label="Close menu">
              <X className="size-4" />
            </button>
            <MenuContent modules={modules} companyName={companyName} logo={logo} open={open} toggle={toggle} big />
          </aside>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-surface">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6 md:pl-3">
            <button type="button" className={cn(buttonClass("ghost", "icon"), "-ml-2 md:hidden")} onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}>
              <MenuIcon aria-hidden />
            </button>
            <Link href={HOME_HREF} className="flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg md:hidden" aria-label={`Kebo ERP, ${companyName}, home`}>
              <Logo companyName={companyName} logo={logo} size={32} />
              <span className="text-[15.5px] font-bold tracking-tight text-text max-[380px]:hidden">Kebo ERP</span>
            </Link>
            {/* Under 1280 px the menu is the strip: the button opens the whole menu over the page. */}
            <button type="button" className={cn(buttonClass("ghost", "icon"), "hidden md:inline-flex xl:hidden")} onClick={() => setDrawer(true)} aria-label="Open the menu" aria-expanded={drawer}>
              <PanelLeftOpen aria-hidden />
            </button>
            <button type="button" className={cn(buttonClass("ghost", "icon"), "hidden xl:inline-flex")} onClick={onFoldButton} aria-label={folded ? "Open the menu" : "Fold the menu"} aria-pressed={folded}>
              {folded ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            </button>
            <form action="/inquiries" role="search" aria-label="Search inquiries" className="relative hidden max-w-[380px] flex-1 md:block">
              <label htmlFor="global-search" className="sr-only">
                Search inquiries
              </label>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                id="global-search"
                name="q"
                type="search"
                placeholder="Search inquiries, customers, numbers…"
                className="h-9 w-full rounded-[10px] border border-line-strong bg-[#f8faf9] pr-10 pl-9 text-[13px] text-text transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-primary-solid focus-visible:bg-surface focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none dark:bg-surface-2"
              />
              <input type="hidden" name="status" value="all" />
              <span className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 lg:inline-flex">
                <Kbd>/</Kbd>
              </span>
            </form>
            <div className="ml-auto flex items-center gap-1.5">
              <Link href="/inquiries" className={cn(buttonClass("ghost", "icon"), "md:hidden")} aria-label="Search inquiries">
                <Search aria-hidden />
              </Link>
              {newItems.length > 0 && (
                <span className="hidden md:block">
                  <NewMenu items={newItems} />
                </span>
              )}
              <Link href="/notifications" className={cn(buttonClass("ghost", "icon"), "relative")} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
                <Bell aria-hidden />
                {!!unread && (
                  <span className="absolute top-0.5 right-0 min-w-[18px] rounded-full bg-action-solid px-1 text-center text-[10px] leading-[18px] font-bold text-white" aria-hidden>
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
              <AccountMenu user={user} companyName={companyName} />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 pt-[18px] pb-28 sm:px-6 md:pb-10">
          {children}
          <p className="no-print mt-6 text-xs text-muted">
            © {new Date().getFullYear()} Kebo ERP · {companyName}
          </p>
        </main>
      </div>

      {/* Phone: bottom tab bar, thumb-reachable, with the main action in the middle */}
      <nav aria-label="Quick" className="no-print fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {tab(HOME_HREF, "Home", House)}
        {tab("/inquiries", "Inquiries", ClipboardList)}
        {canCreate ? (
          <div className="flex flex-1 items-start justify-center">
            <Link href="/inquiries?panel=new-inquiry" aria-label="New inquiry" className="-mt-5 grid size-14 place-items-center rounded-full bg-action-solid text-white shadow-pop ring-4 ring-bg active:scale-95">
              <Plus className="size-7" strokeWidth={2.25} aria-hidden />
            </Link>
          </div>
        ) : (
          tab("/customers", "Customers", Building2)
        )}
        {tab("/notifications", "Alerts", Bell, unread)}
        <button type="button" onClick={() => setDrawer(true)} aria-expanded={drawer} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px] text-muted">
          <MenuIcon className="size-[22px]" strokeWidth={1.75} aria-hidden />
          Menu
        </button>
      </nav>
    </div>
  );
}
