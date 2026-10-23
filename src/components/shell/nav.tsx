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

export function Sidebar({ groups, brand, footer }: { groups: { title?: string; items: NavItem[] }[]; brand: React.ReactNode; footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Mobile top bar */}
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-brand-900 px-4 py-3 text-white lg:hidden">
        {brand}
        <button onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Open menu" aria-expanded={open}>
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside
        className={cn(
          "no-print fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-brand-900 px-3 py-5 text-white transition-transform lg:translate-x-0",
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
