"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Activity, Building2, ClipboardList, Gauge, Inbox, LogOut, Package, ScrollText, Settings } from "lucide-react";
import { Avatar, cn, RULES, Badge } from "@kebo/ui";
import { NavMemoryKeeper } from "@kebo/ui/client";
import { platformLogoutAction } from "@/app/platform/actions";

type Counts = { companies?: number; newLeads?: number; plans?: number };

const NAV = [
  { href: "/platform", label: "Overview", icon: Gauge, exact: true },
  { href: "/platform/companies", label: "Companies", icon: Building2, count: "companies" },
  { href: "/platform/leads", label: "Client inquiries", icon: Inbox, count: "newLeads", countLabel: "new" },
  { href: "/platform/plans", label: "Plans", icon: Package, count: "plans" },
  { href: "/platform/log", label: "Platform log", icon: ScrollText },
  { href: "/platform/dev-tools", label: "Dev tools", icon: Activity },
  { href: "/platform/settings", label: "Settings", icon: Settings },
] as const;

/**
 * The platform admin's area, apart from every company (design system: the
 * app's frame, approved page 30): the menu down the left from a laptop up,
 * with counts (companies, new client inquiries, plans), the platform admin
 * and Sign out at its foot; on a phone and a tablet a bar on top and the menu
 * as a row of chips that scrolls sideways.
 */
export function PlatformShell({
  admin,
  counts,
  children,
}: {
  admin: { name: string; email: string };
  counts: Counts;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const count = (key?: keyof Counts) => (key ? counts[key] : undefined);
  return (
    <div className="min-h-dvh lg:pl-56" data-shell="">
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

      {/* Laptop and up: the menu down the left. */}
      <aside
        aria-label="Platform menu"
        className="no-print fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-line bg-surface lg:flex"
      >
        <Link href="/platform" className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <span className="grid size-8 place-items-center rounded-lg bg-primary-solid text-primary-fg">
            <ClipboardList className="size-4.5" aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold">RFQ Desk</span>
            <span className="block text-xs text-muted">Platform admin</span>
          </span>
        </Link>
        <nav aria-label="Platform" className="flex-1 overflow-y-auto px-3">
          <ul className="flex flex-col gap-0.5">
            {NAV.map((n) => {
              const on = active(n.href, "exact" in n && n.exact);
              const c = count("count" in n ? n.count : undefined);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-text-2 hover:bg-surface-2 hover:text-text",
                      on && "bg-primary-soft font-semibold text-primary hover:bg-primary-soft hover:text-primary",
                    )}
                  >
                    <n.icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">{n.label}</span>
                    {!!c && (
                      <span
                        className={cn(
                          "text-xs tabular",
                          "countLabel" in n ? "rounded-full bg-warn-soft px-1.5 font-semibold text-warn" : "text-muted",
                        )}
                      >
                        {c}
                        {"countLabel" in n && <span className="sr-only"> {n.countLabel}</span>}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex items-center gap-2 border-t border-line px-3 py-3">
          <Link
            href="/platform/settings?section=account"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-text-2 hover:bg-surface-2"
            title={admin.email}
          >
            <Avatar name={admin.name} size={26} />
            <span className="truncate">{admin.name}</span>
          </Link>
          <form action={platformLogoutAction}>
            <button
              type="submit"
              className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </div>
      </aside>

      {/* Phone and tablet: a bar on top, the menu as chips. */}
      {/* On a phone a record's own top bar (← and its name) takes this one's place (globals.css). */}
      <header data-shell-top="" className="no-print sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md lg:hidden">
        <div className={cn(RULES.page.width, RULES.page.sides, "flex h-14 items-center gap-3")}>
          <Link href="/platform" className="flex shrink-0 items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary-solid text-primary-fg">
              <ClipboardList className="size-4.5" aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">RFQ Desk</span>
              <span className="block text-2xs text-muted">Platform admin</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Link
              href="/platform/settings?section=account"
              className="grid size-9 place-items-center rounded-lg hover:bg-surface-2"
              aria-label={`My account (${admin.name})`}
            >
              <Avatar name={admin.name} size={26} />
            </Link>
            <form action={platformLogoutAction}>
              <button
                type="submit"
                className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
                aria-label="Sign out"
              >
                <LogOut className="size-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
        <nav
          aria-label="Platform (small screens)"
          className={cn(RULES.page.width, RULES.page.sides, "flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
        >
          {NAV.map((n) => {
            const on = active(n.href, "exact" in n && n.exact);
            const c = count("count" in n ? n.count : undefined);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-text-2",
                  on && "bg-primary-soft font-medium text-primary",
                )}
              >
                <n.icon className="size-4" aria-hidden />
                {n.label}
                {!!c && "countLabel" in n && (
                  <Badge size="sm" tone="warn" className="min-w-5 justify-center px-1.5 tabular">
                    {c}
                    <span className="sr-only"> {n.countLabel}</span>
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>
      </header>
      <main id="main" className={cn(RULES.page.frame, "pb-16")}>
        {children}
      </main>
    </div>
  );
}
