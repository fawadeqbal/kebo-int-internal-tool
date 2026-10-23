"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  Users,
  Building2,
  Menu,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
}

const ICONS = {
  dashboard: LayoutDashboard,
  queries: ClipboardList,
  customers: Building2,
  quotations: FileText,
  invoices: Receipt,
  reports: BarChart3,
  notifications: Bell,
  users: Users,
  settings: Settings,
  audit: ScrollText,
};

function NavLinks({ groups, onNavigate }: { groups: { title?: string; items: NavItem[] }[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {groups.map((group, gi) => (
        <div key={gi}>
          {group.title && <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/40">{group.title}</p>}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active ? "bg-white/12 font-medium text-white" : "text-white/70 hover:bg-white/6 hover:text-white",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {!!item.badge && (
                      <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-semibold text-amber-950" aria-label={`${item.badge} unread`}>
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
  );
}

export function Sidebar({
  groups,
  brand,
  footer,
  unread = 0,
  canCreate = false,
}: {
  groups: { title?: string; items: NavItem[] }[];
  brand: React.ReactNode;
  footer: React.ReactNode;
  unread?: number;
  canCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const tab = (href: string, label: string, Icon: typeof LayoutDashboard, badge?: number) => (
    <Link
      href={href}
      aria-current={isActive(href) ? "page" : undefined}
      className={cn("relative flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px]", isActive(href) ? "font-semibold text-brand-700" : "text-muted")}
    >
      <Icon className="h-[22px] w-[22px]" strokeWidth={isActive(href) ? 2.25 : 1.75} aria-hidden />
      {label}
      {!!badge && (
        <span className="absolute left-1/2 top-1 ml-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-semibold leading-4 text-white" aria-label={`${badge} unread`}>
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );

  return (
    <>
      {/* Phone: bottom tab bar, thumb-reachable, with the main action in the middle */}
      <nav
        aria-label="Main"
        className="no-print fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {tab("/dashboard", "Home", LayoutDashboard)}
        {tab("/queries", "Inquiries", ClipboardList)}
        {canCreate ? (
          <div className="flex flex-1 items-start justify-center">
            <Link
              href="/queries/new"
              aria-label="New inquiry"
              className="-mt-5 grid h-14 w-14 place-items-center rounded-full bg-brand-600 text-white shadow-[0_6px_16px_-4px_rgba(14,118,102,0.55)] ring-4 ring-canvas active:scale-95"
            >
              <Plus className="h-7 w-7" strokeWidth={2.25} />
            </Link>
          </div>
        ) : (
          tab("/customers", "Buyers", Building2)
        )}
        {tab("/notifications", "Alerts", Bell, unread)}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px] text-muted"
        >
          <Menu className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
          Menu
        </button>
      </nav>

      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={cn(
          "no-print fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-brand-900 px-3 py-5 text-white transition-transform lg:w-64 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-8 flex items-center justify-between px-3">
          {brand}
          <button onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-white/10 lg:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
        </div>
        <div className="mt-4 border-t border-white/10 px-1 pt-4">{footer}</div>
      </aside>
    </>
  );
}
