"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Building2, ClipboardList, Gauge, Globe, Inbox, KeyRound, LogOut, Package, ScrollText } from "lucide-react";
import { Avatar, cn } from "@kebo/ui";
import { platformLogoutAction } from "@/app/platform/actions";

const NAV = [
  { href: "/platform", label: "Overview", icon: Gauge, exact: true },
  { href: "/platform/leads", label: "Client inquiries", icon: Inbox },
  { href: "/platform/companies", label: "Companies & demos", icon: Building2 },
  { href: "/platform/plans", label: "Plans", icon: Package },
  { href: "/platform/website", label: "Website", icon: Globe },
  { href: "/platform/log", label: "Platform log", icon: ScrollText },
];

/** The platform admin's area: its own nav, apart from every company. */
export function PlatformShell({
  admin,
  newLeads,
  children,
}: {
  admin: { name: string; email: string };
  newLeads: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <div className="min-h-dvh">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 sm:px-6">
          <Link href="/platform" className="flex shrink-0 items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-primary-solid text-primary-fg">
              <ClipboardList className="size-4.5" aria-hidden />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">RFQ Desk</span>
              <span className="block text-[11px] text-muted">Platform</span>
            </span>
          </Link>
          <nav aria-label="Platform" className="ml-4 hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href, n.exact) ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-text-2 hover:bg-surface-2 hover:text-text",
                  active(n.href, n.exact) && "bg-primary-soft font-medium text-primary hover:bg-primary-soft hover:text-primary",
                )}
              >
                <n.icon className="size-4" aria-hidden />
                {n.label}
                {n.href === "/platform/leads" && newLeads > 0 && (
                  <span className="rounded-full bg-warn-soft px-1.5 text-[11px] font-semibold text-warn tabular">{newLeads}</span>
                )}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/platform/account"
              className="hidden items-center gap-2 rounded-lg px-2 py-1 text-sm text-text-2 hover:bg-surface-2 sm:flex"
              title={admin.email}
            >
              <Avatar name={admin.name} size={26} />
              <span className="max-w-40 truncate">{admin.name}</span>
            </Link>
            <Link href="/platform/account" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 sm:hidden" aria-label="Your password">
              <KeyRound className="size-4" aria-hidden />
            </Link>
            <form action={platformLogoutAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
                title="Sign out"
              >
                <LogOut className="size-4" aria-hidden />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </form>
          </div>
        </div>
        <nav aria-label="Platform (small screens)" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href, n.exact) ? "page" : undefined}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-text-2",
                active(n.href, n.exact) && "bg-primary-soft font-medium text-primary",
              )}
            >
              <n.icon className="size-4" aria-hidden />
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-16 sm:px-6">
        {children}
      </main>
    </div>
  );
}
