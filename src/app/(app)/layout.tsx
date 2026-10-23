import { Suspense } from "react";
import Link from "next/link";
import { LogOut, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { logoutAction } from "@/modules/users/auth-actions";
import { unreadCount } from "@/modules/notifications/repository";
import { getSettings } from "@/modules/settings/service";
import { Sidebar, type NavItem } from "@/components/shell/nav";
import { Toast } from "@/components/ui/client";
import { KeyboardShortcuts } from "@/components/shell/shortcuts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [unread, settings] = await Promise.all([unreadCount(user.id), getSettings()]);

  const work: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/queries", label: "Queries", icon: "queries" },
    { href: "/customers", label: "Customers", icon: "customers" },
    { href: "/quotations", label: "Quotations", icon: "quotations" },
    ...(can(user.role, "invoices.manage") ? [{ href: "/invoices", label: "Invoices", icon: "invoices" } as NavItem] : []),
    ...(can(user.role, "reports.view") ? [{ href: "/reports", label: "Reports", icon: "reports" } as NavItem] : []),
    { href: "/notifications", label: "Notifications", icon: "notifications", badge: unread },
  ];
  const admin: NavItem[] = [
    ...(can(user.role, "users.manage") ? [{ href: "/users", label: "Users", icon: "users" } as NavItem] : []),
    ...(can(user.role, "settings.manage") ? [{ href: "/settings", label: "Settings", icon: "settings" } as NavItem] : []),
    ...(can(user.role, "audit.view") ? [{ href: "/audit", label: "Audit log", icon: "audit" } as NavItem] : []),
  ];
  const groups = [{ items: work }, ...(admin.length ? [{ title: "Administration", items: admin }] : [])];

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
        <svg viewBox="0 0 32 32" className="h-4 w-4" aria-hidden>
          <path d="M8 10h16M8 16h11M8 22h7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </span>
      <span className="max-w-40 truncate text-sm font-semibold">{settings.companyName}</span>
    </Link>
  );

  const footer = (
    <div className="flex items-center gap-3 px-2">
      <Link href="/account" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 hover:bg-white/6">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-semibold">
          {user.name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{user.name}</span>
          <span className="block truncate text-xs text-white/50">{ROLE_LABELS[user.role]}</span>
        </span>
      </Link>
      <form action={logoutAction}>
        <button className="rounded-md p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen">
      <Sidebar groups={groups} brand={brand} footer={footer} />
      <div className="lg:pl-64">
        <div className="no-print sticky top-0 z-20 hidden h-14 items-center justify-end gap-3 border-b border-line bg-canvas/85 px-8 backdrop-blur lg:flex">
          {can(user.role, "queries.create") && (
            <Link
              href="/queries/new"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
              title="New query (N)"
            >
              <Plus className="h-4 w-4" aria-hidden /> New query
            </Link>
          )}
        </div>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
      <Suspense>
        <Toast />
      </Suspense>
      <KeyboardShortcuts canCreate={can(user.role, "queries.create")} />
    </div>
  );
}
