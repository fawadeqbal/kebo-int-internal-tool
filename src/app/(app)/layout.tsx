import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { unreadCount } from "@/modules/notifications/repository";
import { getSettings } from "@/modules/settings/service";
import { AppShell, type NavGroup, type NavItem } from "@/components/shell/nav";
import { Toast } from "@/components/ui/client";
import { KeyboardShortcuts } from "@/components/shell/shortcuts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [unread, settings] = await Promise.all([unreadCount(user.id), getSettings()]);

  const work: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/queries", label: "Inquiries", icon: "queries" },
    { href: "/customers", label: "Customers", icon: "customers" },
    { href: "/notifications", label: "Notifications", icon: "notifications", badge: unread },
  ];
  const money: NavItem[] = [
    ...(can(user.role, "sourcing.manage") ? [{ href: "/factories", label: "Factories", icon: "factories" } as NavItem] : []),
    { href: "/quotations", label: "Quotations", icon: "quotations" },
    ...(can(user.role, "invoices.manage") ? [{ href: "/invoices", label: "Invoices", icon: "invoices" } as NavItem] : []),
    ...(can(user.role, "reports.view") ? [{ href: "/reports", label: "Reports", icon: "reports" } as NavItem] : []),
  ];
  const admin: NavItem[] = [
    ...(can(user.role, "users.manage") ? [{ href: "/users", label: "Users", icon: "users" } as NavItem] : []),
    ...(can(user.role, "settings.manage") ? [{ href: "/settings", label: "Settings", icon: "settings" } as NavItem] : []),
    ...(can(user.role, "audit.view") ? [{ href: "/audit", label: "Audit log", icon: "audit" } as NavItem] : []),
  ];
  const groups: NavGroup[] = [
    { title: "Work", items: work },
    { title: "Sales", items: money },
    ...(admin.length ? [{ title: "Administration", items: admin }] : []),
  ];

  return (
    <>
      <AppShell
        groups={groups}
        companyName={settings.companyName}
        user={{ name: user.name, email: user.email, role: ROLE_LABELS[user.role] }}
        unread={unread}
        canCreate={can(user.role, "queries.create")}
      >
        {children}
      </AppShell>
      <Suspense>
        <Toast />
      </Suspense>
      <KeyboardShortcuts canCreate={can(user.role, "queries.create")} />
    </>
  );
}
