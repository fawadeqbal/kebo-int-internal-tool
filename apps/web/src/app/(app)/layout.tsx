import { Suspense } from "react";
import { cookies } from "next/headers";
import { can } from "@kebo/shared";
import { Toast } from "@kebo/ui/client";
import { api } from "@/lib/api";
import { getCompany, requireUser, timeStyleOf } from "@/lib/session";
import { Notice, linkClass, cn } from "@kebo/ui";
import { FeaturesProvider } from "@/components/common/features";
import { leaveCompanyAction } from "@/app/platform/actions";
import { demoMode } from "@/lib/demo";
import { AppShell, type NewItem } from "@/components/shell/nav";
import { buildModules, FOLD_COOKIE, MODULE_PAGES, OPEN_COOKIE, type ModuleKey } from "@/lib/nav";
import { KeyboardShortcuts } from "@/components/shell/shortcuts";
import { AccountsProvider, type AccountOption } from "@/components/money/accounts";
import { CompanyTime } from "@/lib/time-client";
import { RememberColours } from "./remember-colours";
import { getSettings } from "@/lib/loaders";
import { RowClicks } from "@/components/common/row-clicks";
import { AppFileViewer } from "@/components/files/viewer";

/** The company's own logo (Settings → Company), at a link that changes when the logo does; none: the app's icon. */
function logoUrl(logo: string | undefined) {
  if (!logo) return undefined;
  let h = 0;
  for (let i = 0; i < logo.length; i += 97) h = (h * 31 + logo.charCodeAt(i)) | 0;
  return `/company-logo?v=${logo.length.toString(36)}${(h >>> 0).toString(36)}`;
}

export default async function AppLayout({ children, window: win }: { children: React.ReactNode; window: React.ReactNode }) {
  const me = await requireUser();
  const has = (p: Parameters<typeof can>[1]) => can(me, p);
  const companyP = getCompany();
  const featureOf = (c: Awaited<typeof companyP>) => (f: string) => !c || c.features.includes(f);
  // Money received and expenses sent for approval: approvers see how many wait for them; those who add them, how many were sent back.
  const approvesIn = (c: Awaited<typeof companyP>) => has("payments.record") || (has("expenses.manage") && featureOf(c)("expenses"));
  // Everything the frame needs, asked for at the same time rather than one after another.
  const [{ unread }, settings, company, accounts, approvals] = await Promise.all([
    api.get<{ unread: number }>("/notifications", { take: 1 }),
    getSettings(),
    companyP,
    // Our money accounts, for every form that records money (payments, supplier payments, expenses): the list to choose from only.
    has("payments.record") || has("expenses.manage") || has("money.submit") ? api.get<AccountOption[]>("/money/accounts", { choose: "true" }).catch(() => []) : [],
    companyP.then((c) => {
      const approves = approvesIn(c);
      if (!approves && !has("money.submit")) return null;
      return api
        .get<{ counts: { pending: number; sent_back: number } }>("/submissions", { mine: approves ? undefined : "true", pageSize: 1 })
        .then((r) => (approves ? r.counts.pending : r.counts.sent_back))
        .catch(() => 0);
    }),
  ]);
  const feature = featureOf(company);
  const approves = approvesIn(company);

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
    has("sourcing.manage") && { href: "/suppliers?panel=new-factory", label: "Supplier" },
    has("payments.record") && { href: "/payments/new", label: "Payment received" },
    has("expenses.manage") && feature("expenses") && { href: "/payments/new?kind=expense", label: "Expense" },
  ].filter((x): x is NewItem => !!x);

  return (
    <CompanyTime style={timeStyleOf(me)}>
      {/* Files and papers open over the page, in the app (Fawad 21 Nov: not in a new tab). */}
      <AppFileViewer>
      {/* The company's colours (Settings › Company › The app's colours): the page takes the set it names, from the
          first paint and without a script (packages/ui/src/styles/theme.css). */}
      <span id="app-colours" data-colours={settings.company.colours} hidden />
      <RememberColours colours={settings.company.colours} />
      <AppShell modules={modules} initialOpen={initialOpen} initialFold={initialFold} newItems={newItems} companyName={settings.company.name} logo={logoUrl(settings.company.logo)} user={{ name: me.name, email: me.email, role: me.roleName }} unread={unread} canCreate={has("inquiries.create")}>
        {me.viaPlatform && (
          <form action={leaveCompanyAction.bind(null, me.company?.slug)} className="no-print flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary-soft/60 px-3 py-2 text-sm">
            <span>
              <strong className="font-semibold">Platform admin</strong> · you are working in {company?.name ?? "this company"}. Everything you do is in its history under your name.
            </span>
            <button type="submit" className={cn(linkClass, "text-sm")}>
              Back to the platform
            </button>
          </form>
        )}
        {company?.notices.map((n) => (
          <Notice key={n.text} tone={n.tone === "danger" ? "bad" : n.tone === "warn" ? "todo" : "info"} className="no-print">
            {n.text}
          </Notice>
        ))}
        {demoMode() && (
          <Notice tone="info" className="no-print">
            <strong>Demo</strong> · everything here is sample data. Look around and change anything; it is reset regularly.
          </Notice>
        )}
        <FeaturesProvider features={company?.features ?? null}>
          <AccountsProvider accounts={accounts} me={me.name} meId={me.id} canAdd={has("expenses.manage") && feature("cash_book")}>
            {children}
            {win}
          </AccountsProvider>
        </FeaturesProvider>
      </AppShell>
      <Suspense>
        <Toast />
        <RowClicks />
      </Suspense>
      <KeyboardShortcuts canCreate={has("inquiries.create")} />
      </AppFileViewer>
    </CompanyTime>
  );
}
