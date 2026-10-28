"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Banknote,
  BarChart3,
  Bell,
  Building2,
  ClipboardList,
  Factory,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  PackageCheck,
  Plus,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  User,
  Users,
  X,
} from "lucide-react";
import { Avatar, buttonClass, cn, Kbd } from "@kebo/ui";
import { logoutAction } from "@/app/login/actions";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const ICONS = {
  dashboard: LayoutDashboard,
  deals: ClipboardList,
  orders: PackageCheck,
  customers: Building2,
  factories: Factory,
  quotations: FileText,
  reports: BarChart3,
  money: Banknote,
  notifications: Bell,
  users: Users,
  settings: Settings,
  audit: ScrollText,
  security: ShieldCheck,
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

function SidebarContent({ groups, companyName, roleLabel }: { groups: NavGroup[]; companyName: string; roleLabel: string }) {
  const pathname = usePathname();
  return (
    <>
      <Link href="/dashboard" className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
        <img src="/brand/kebo-logo-96.png" alt="" width={32} height={32} className="size-8 shrink-0" />
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold text-text">{companyName}</span>
          <span className="block text-[11px] text-muted">RFQ Desk</span>
        </span>
      </Link>
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="mb-1 px-2 text-[11px] font-medium tracking-wide text-muted uppercase">{group.title}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm text-text-2 transition-colors hover:bg-surface-2 hover:text-text",
                        active && "bg-primary-soft font-medium text-primary hover:bg-primary-soft hover:text-primary",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1 truncate">{item.label}</span>
                      {!!item.badge && (
                        <span
                          className="rounded-full bg-warn-soft px-1.5 text-[11px] font-semibold text-warn tabular"
                          aria-label={`${item.badge} unread`}
                        >
                          {item.badge > 99 ? "99+" : item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-3 text-[11px] text-muted">
        Signed in as <span className="font-medium text-text-2">{roleLabel}</span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Shell */

/** Sidebar + top bar around every signed-in screen; a bottom tab bar on phones. */
export function AppShell({
  groups,
  companyName,
  user,
  unread = 0,
  canCreate = false,
  children,
}: {
  groups: NavGroup[];
  companyName: string;
  user: { name: string; email: string; role: string };
  unread?: number;
  canCreate?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

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
    <div className="min-h-dvh lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <SidebarContent groups={groups} companyName={companyName} roleLabel={user.role} />
      </aside>

      {/* Phone / tablet drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-64 animate-slide-in flex-col border-r border-line bg-surface shadow-pop">
            <button
              className="absolute top-3.5 right-3 rounded-md p-1.5 text-muted hover:bg-surface-2"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X className="size-4" />
            </button>
            <SidebarContent groups={groups} companyName={companyName} roleLabel={user.role} />
          </aside>
        </div>
      )}

      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-md sm:px-6">
        <button
          type="button"
          className={cn(buttonClass("ghost", "icon-sm"), "lg:hidden")}
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
        >
          <MenuIcon aria-hidden />
        </button>
        <form action="/inquiries" role="search" className="relative w-full max-w-sm">
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
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px] text-muted"
        >
          <MenuIcon className="size-[22px]" strokeWidth={1.75} aria-hidden />
          Menu
        </button>
      </nav>
    </div>
  );
}
