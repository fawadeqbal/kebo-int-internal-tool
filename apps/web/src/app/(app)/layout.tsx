import { Suspense } from "react";
import { can } from "@kebo/shared";
import { Toast } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { getCompany, requireUser } from "@/lib/session";
import { Alert } from "@kebo/ui";
import { FeaturesProvider } from "@/components/common/features";
import { leaveCompanyAction } from "@/app/platform/actions";
import { demoMode } from "@/lib/demo";
import { AppShell, type NavGroup, type NavItem } from "@/components/shell/nav";
import { KeyboardShortcuts } from "@/components/shell/shortcuts";
import { AccountsProvider, type AccountOption } from "@/components/money/accounts";

/** The company's own logo (Settings → Company), at a link that changes when the logo does; none: the app's icon. */
function logoUrl(logo: string | undefined) {
  if (!logo) return undefined;
  let h = 0;
  for (let i = 0; i < logo.length; i += 97) h = (h * 31 + logo.charCodeAt(i)) | 0;
  return `/company-logo?v=${logo.length.toString(36)}${(h >>> 0).toString(36)}`;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const [{ unread }, settings, company] = await Promise.all([
    api.get<{ unread: number }>("/notifications", { take: 1 }),
    api.get<{ company: { name: string; logo?: string } }>("/settings"),
    getCompany(),
  ]);
  const feature = (f: string) => !company || company.features.includes(f);
  const has = (p: Parameters<typeof can>[1]) => can(me, p);
  // Our money accounts, for every form that records money (payments, factory payments, expenses).
  const accounts = has("payments.record") || has("expenses.manage") ? await api.get<AccountOption[]>("/money/accounts").catch(() => []) : [];

  const work: NavItem[] = [
    { href: "/dashboard", label: "Home", icon: "dashboard" },
    { href: "/inquiries", label: "Inquiries", icon: "deals" },
    { href: "/orders", label: "Orders", icon: "orders" },
    { href: "/customers", label: "Customers", icon: "customers" },
    { href: "/notifications", label: "Notifications", icon: "notifications", badge: unread },
  ];
  const trade: NavItem[] = [
    ...(has("sourcing.manage") ? [{ href: "/factories", label: "Factories", icon: "factories" } as NavItem] : []),
    ...(has("sourcing.manage") ? [{ href: "/money", label: "Money", icon: "money" } as NavItem] : []),
    ...(has("reports.view") && feature("insights") ? [{ href: "/insights", label: "Insights", icon: "reports" } as NavItem] : []),
  ];
  const admin: NavItem[] = [
    ...(has("users.manage") ? [{ href: "/users", label: "Users", icon: "users" } as NavItem] : []),
    ...(has("security.manage") ? [{ href: "/security", label: "Security", icon: "security" } as NavItem] : []),
    ...(has("settings.manage") ? [{ href: "/settings", label: "Settings", icon: "settings" } as NavItem] : []),
    ...(has("audit.view") && feature("audit_log") ? [{ href: "/audit", label: "Audit log", icon: "audit" } as NavItem] : []),
  ];
  const groups: NavGroup[] = [{ title: "Work", items: work }, ...(trade.length ? [{ title: "Trade", items: trade }] : []), ...(admin.length ? [{ title: "Administration", items: admin }] : [])];

  return (
    <>
      <AppShell groups={groups} companyName={settings.company.name} logo={logoUrl(settings.company.logo)} user={{ name: me.name, email: me.email, role: me.roleName }} unread={unread} canCreate={has("inquiries.create")}>
        {me.viaPlatform && (
          <form action={leaveCompanyAction} className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary-soft/60 px-3 py-2 text-sm">
            <span>
              <strong className="font-semibold">Platform admin</strong> · you are working in {company?.name ?? "this company"}. Everything you do is in its history under your name.
            </span>
            <button type="submit" className="text-sm font-medium text-primary hover:underline">
              Back to the platform
            </button>
          </form>
        )}
        {company?.notices.map((n) => (
          <Alert key={n.text} tone={n.tone === "danger" ? "error" : n.tone === "warn" ? "warning" : "info"} className="no-print mb-4">
            {n.text}
          </Alert>
        ))}
        {demoMode() && (
          <p className="no-print mb-4 rounded-xl border border-info/30 bg-info-soft px-3 py-2 text-sm text-info">
            <strong className="font-semibold">Demo</strong> · everything here is sample data. Look around and change anything; it is reset regularly.
          </p>
        )}
        <FeaturesProvider features={company?.features ?? null}>
          <AccountsProvider accounts={accounts}>{children}</AccountsProvider>
        </FeaturesProvider>
      </AppShell>
      <Suspense>
        <Toast />
      </Suspense>
      <KeyboardShortcuts canCreate={has("inquiries.create")} />
    </>
  );
}
