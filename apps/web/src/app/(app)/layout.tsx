import { Suspense } from "react";
import { can } from "@kebo/shared";
import { Toast } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { AppShell, type NavGroup, type NavItem } from "@/components/shell/nav";
import { KeyboardShortcuts } from "@/components/shell/shortcuts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const [{ unread }, settings] = await Promise.all([api.get<{ unread: number }>("/notifications", { take: 1 }), api.get<{ company: { name: string } }>("/settings")]);
  const has = (p: Parameters<typeof can>[1]) => can(me, p);

  const work: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/deals", label: "Deals", icon: "deals" },
    { href: "/orders", label: "Orders", icon: "orders" },
    { href: "/customers", label: "Customers", icon: "customers" },
    { href: "/notifications", label: "Notifications", icon: "notifications", badge: unread },
  ];
  const trade: NavItem[] = [
    ...(has("sourcing.manage") ? [{ href: "/factories", label: "Factories", icon: "factories" } as NavItem] : []),
    ...(has("sourcing.manage") ? [{ href: "/money", label: "Money", icon: "money" } as NavItem] : []),
    ...(has("reports.view") ? [{ href: "/reports", label: "Reports", icon: "reports" } as NavItem] : []),
  ];
  const admin: NavItem[] = [
    ...(has("users.manage") ? [{ href: "/users", label: "Users", icon: "users" } as NavItem] : []),
    ...(has("security.manage") ? [{ href: "/security", label: "Security", icon: "security" } as NavItem] : []),
    ...(has("settings.manage") ? [{ href: "/settings", label: "Settings", icon: "settings" } as NavItem] : []),
    ...(has("audit.view") ? [{ href: "/audit", label: "Audit log", icon: "audit" } as NavItem] : []),
  ];
  const groups: NavGroup[] = [{ title: "Work", items: work }, ...(trade.length ? [{ title: "Trade", items: trade }] : []), ...(admin.length ? [{ title: "Administration", items: admin }] : [])];

  return (
    <>
      <AppShell groups={groups} companyName={settings.company.name} user={{ name: me.name, email: me.email, role: me.roleName }} unread={unread} canCreate={has("inquiries.create")}>
        {children}
      </AppShell>
      <Suspense>
        <Toast />
      </Suspense>
      <KeyboardShortcuts canCreate={has("inquiries.create")} />
    </>
  );
}
