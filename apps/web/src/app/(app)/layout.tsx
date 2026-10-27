import { Suspense } from "react";
import { can } from "@kebo/shared";
import { Toast } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { demoMode } from "@/lib/demo";
import { AppShell, type NavGroup, type NavItem } from "@/components/shell/nav";
import { KeyboardShortcuts } from "@/components/shell/shortcuts";
import { AccountsProvider, type AccountOption } from "@/components/money/accounts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const [{ unread }, settings] = await Promise.all([api.get<{ unread: number }>("/notifications", { take: 1 }), api.get<{ company: { name: string } }>("/settings")]);
  const has = (p: Parameters<typeof can>[1]) => can(me, p);
  // Our money accounts, for every form that records money (payments, factory payments, expenses).
  const accounts = has("payments.record") || has("expenses.manage") ? await api.get<AccountOption[]>("/money/accounts").catch(() => []) : [];

  const work: NavItem[] = [
    { href: "/dashboard", label: "Home", icon: "dashboard" },
    { href: "/deals", label: "Deals", icon: "deals" },
    { href: "/orders", label: "Orders", icon: "orders" },
    { href: "/customers", label: "Customers", icon: "customers" },
    { href: "/notifications", label: "Notifications", icon: "notifications", badge: unread },
  ];
  const trade: NavItem[] = [
    ...(has("sourcing.manage") ? [{ href: "/factories", label: "Factories", icon: "factories" } as NavItem] : []),
    ...(has("sourcing.manage") ? [{ href: "/money", label: "Money", icon: "money" } as NavItem] : []),
    ...(has("reports.view") ? [{ href: "/insights", label: "Insights", icon: "reports" } as NavItem] : []),
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
        {demoMode() && (
          <p className="no-print mb-4 rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
            <strong className="font-semibold">Demo</strong> · everything here is sample data. Look around and change anything; it is reset regularly.
          </p>
        )}
        <AccountsProvider accounts={accounts}>{children}</AccountsProvider>
      </AppShell>
      <Suspense>
        <Toast />
      </Suspense>
      <KeyboardShortcuts canCreate={has("inquiries.create")} />
    </>
  );
}
