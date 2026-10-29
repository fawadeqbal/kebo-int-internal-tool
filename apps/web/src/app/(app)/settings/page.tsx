import type { Settings } from "@kebo/shared";
import Link from "next/link";
import { cn, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { saveSettingsAction } from "./actions";
import { SettingsGroupForm } from "./forms";
import { SETTING_GROUPS } from "./groups";
import { AddressCard } from "./address/card";
import { WebsiteFormCard } from "./website-form/card";

export const metadata = { title: "Settings" };

/** Company details, sales defaults, reminders and email notifications; each group saves on its own. */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const [settings, lock] = await Promise.all([
    api.get<Settings>("/settings"),
    api.get<{ locked: boolean; reason: string | null }>("/settings/main-currency"),
  ]);
  // The company's own address: only once companies have addresses.
  const tabs: { key: string; title: string }[] = [
    ...SETTING_GROUPS,
    { key: "website-form", title: "Website form" },
    ...(process.env.BASE_DOMAIN ? [{ key: "address", title: "Company address" }] : []),
  ];
  const address = sp.tab === "address" && !!process.env.BASE_DOMAIN;
  const websiteForm = sp.tab === "website-form";
  const own = address ? "address" : websiteForm ? "website-form" : null;
  const group = SETTING_GROUPS.find((g) => g.key === sp.tab) ?? SETTING_GROUPS[0]!;
  return (
    <div>
      <PageHeader
        title="Settings"
        description="How the whole team works. Choose a section on the left; each saves on its own, and changes apply to new quotations and orders, not ones already made."
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20">
          <ul className="flex gap-1 overflow-x-auto border-b border-line pb-1 lg:flex-col lg:overflow-visible lg:border-0 [scrollbar-width:none]">
            {tabs.map((g) => {
              const active = own ? g.key === own : g.key === group.key;
              return (
                <li key={g.key} className="shrink-0">
                  <Link
                    href={g.key === SETTING_GROUPS[0]!.key ? "/settings" : `/settings?tab=${g.key}`}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-text-2 hover:bg-surface-2 hover:text-text",
                      active && "bg-primary-soft font-medium text-primary hover:bg-primary-soft hover:text-primary",
                    )}
                  >
                    {g.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex max-w-3xl min-w-0 flex-col gap-6">
          {address ? (
            <AddressCard />
          ) : websiteForm ? (
            <WebsiteFormCard />
          ) : (
            <SettingsGroupForm
              key={group.key}
              groupKey={group.key}
              values={settings[group.key] as Record<string, unknown>}
              action={saveSettingsAction.bind(null, group.key)}
              currencyLocked={lock.locked ? lock.reason : null}
            />
          )}
        </div>
      </div>
    </div>
  );
}
