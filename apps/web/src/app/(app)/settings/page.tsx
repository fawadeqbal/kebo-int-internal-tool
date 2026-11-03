import type { Settings } from "@kebo/shared";
import { PageHeader, SectionList } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { saveSettingsAction } from "./actions";
import { SettingsCards } from "./cards";
import { SETTING_GROUPS } from "./groups";
import { AddressCard } from "./address/card";
import { WebsiteFormCard } from "./website-form/card";
import { OrderChecklistCard } from "./order-checklist/card";
import { PapersCard } from "./papers/card";

export const metadata = { title: "Settings" };

/**
 * Settings (design system: Settings frame): the sections down the left (chips
 * on a phone); each section is a few cards with their values read-only and
 * ✎ Edit for the side panel, or switches that save at once. Changes apply to
 * new quotations and orders, not ones already made.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("settings.manage");
  const sp = await searchParams;
  const [settings, lock] = await Promise.all([
    api.get<Settings>("/settings"),
    api.get<{ locked: boolean; reason: string | null }>("/settings/main-currency"),
  ]);
  // The company's own address: only once companies have addresses.
  const sections: { key: string; title: string }[] = [
    ...SETTING_GROUPS,
    { key: "order-checklist", title: "Order checklist" },
    { key: "papers", title: "Papers we use" },
    { key: "website-form", title: "Website form" },
    ...(process.env.BASE_DOMAIN ? [{ key: "address", title: "Company address" }] : []),
  ];
  const current = sections.find((s) => s.key === sp.tab)?.key ?? SETTING_GROUPS[0]!.key;
  const group = SETTING_GROUPS.find((g) => g.key === current);
  return (
    <div>
      <PageHeader title="Settings" summary="How the whole team works. Changes apply to new quotations and orders, not ones already made." />
      <SectionList
        label="Settings sections"
        items={sections.map((s) => ({
          href: s.key === SETTING_GROUPS[0]!.key ? "/settings" : `/settings?tab=${s.key}`,
          label: s.title,
          active: s.key === current,
        }))}
      >
        {current === "address" ? (
          <AddressCard />
        ) : current === "website-form" ? (
          <WebsiteFormCard />
        ) : current === "order-checklist" ? (
          <OrderChecklistCard />
        ) : current === "papers" ? (
          <PapersCard value={settings.papers} />
        ) : group ? (
          <SettingsCards
            key={group.key}
            groupKey={group.key}
            values={settings[group.key] as Record<string, unknown>}
            action={saveSettingsAction.bind(null, group.key)}
            currencyLocked={lock.locked ? lock.reason : null}
          />
        ) : null}
      </SectionList>
    </div>
  );
}
