import { Suspense } from "react";
import { cookies } from "next/headers";
import { can } from "@kebo/shared";
import { Toast } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { getCompany, requireUser } from "@/lib/session";
import { Alert } from "@kebo/ui";
import { FeaturesProvider } from "@/components/common/features";
import { leaveCompanyAction } from "@/app/platform/actions";
import { demoMode } from "@/lib/demo";
import { AppShell, type NewItem } from "@/components/shell/nav";
import { buildModules, FOLD_COOKIE, MODULE_PAGES, OPEN_COOKIE, type ModuleKey } from "@/lib/nav";
import { KeyboardShortcuts } from "@/components/shell/shortcuts";
import { AccountsProvider, type AccountOption } from "@/components/money/accounts";
import { getSettings } from "@/lib/loaders";

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
    getSettings(),
    getCompany(),
  ]);
  const feature = (f: string) => !company || company.features.includes(f);
  const has = (p: Parameters<typeof can>[1]) => can(me, p);
  // Our money accounts, for every form that records money (payments, factory payments, expenses).
  const accounts = has("payments.record") || has("expenses.manage") || has("money.submit") ? await api.get<AccountOption[]>("/money/accounts").catch(() => []) : [];
  // Money received and expenses sent for approval: approvers see how many wait for them; those who add them, how many were sent back.
  const approves = has("payments.record") || (has("expenses.manage") && feature("expenses"));
  const approvals =
    approves || has("money.submit")
      ? await api
          .get<{ counts: { pending: number; sent_back: number } }>("/submissions", { mine: approves ? undefined : "true", pageSize: 1 })
          .then((r) => (approves ? r.counts.pending : r.counts.sent_back))
          .catch(() => 0)
      : null;

  // The menu's groups: each page only for those who may open it, with the same checks as the page itself.
  const modules = buildModules({
    can: (p) => has(p as Parameters<typeof can>[1]),
    feature,
    approvals,
    approves,
    companyAddresses: !!process.env.BASE_DOMAIN,
  });
  const jar = await cookies();
  const keys = new Set<string>(MODULE_PAGES.map((m) => m.key));
  const initialOpen = (jar.get(OPEN_COOKIE)?.value ?? "").split(".").filter((k): k is ModuleKey => keys.has(k));
  const foldCookie = jar.get(FOLD_COOKIE)?.value;
  const initialFold = foldCookie === "1" ? true : foldCookie === "0" ? false : null;
  // "New" in the top row: what this person may make, each opening the same window as its own page's button.
  const newItems: NewItem[] = [
    has("inquiries.create") && { href: "/inquiries?panel=new-inquiry", label: "Inquiry" },
    has("customers.manage") && { href: "/customers?panel=new-customer", label: "Customer" },
    has("sourcing.manage") && { href: "/factories?panel=new-factory", label: "Supplier" },
    has("payments.record") && { href: "/payments/new", label: "Payment received" },
    has("expenses.manage") && feature("expenses") && { href: "/payments/new?kind=expense", label: "Expense" },
  ].filter((x): x is NewItem => !!x);

  return (
    <>
      <AppShell modules={modules} initialOpen={initialOpen} initialFold={initialFold} newItems={newItems} companyName={settings.company.name} logo={logoUrl(settings.company.logo)} user={{ name: me.name, email: me.email, role: me.roleName }} unread={unread} canCreate={has("inquiries.create")}>
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
          <AccountsProvider accounts={accounts} me={me.name} canAdd={has("expenses.manage") && feature("cash_book")}>
            {children}
          </AccountsProvider>
        </FeaturesProvider>
      </AppShell>
      <Suspense>
        <Toast />
      </Suspense>
      <KeyboardShortcuts canCreate={has("inquiries.create")} />
    </>
  );
}
