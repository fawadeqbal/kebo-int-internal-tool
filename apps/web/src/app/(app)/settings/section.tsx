import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import type { SettingsKey } from "@kebo/shared";
import { PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { saveSettingsAction } from "./actions";
import { SettingsCards } from "./cards";
import { SETTING_GROUPS } from "./groups";
import { getSettings } from "@/lib/loaders";

/**
 * One page of Settings (design system: Settings frame, design page 33: each section is a page in
 * the sidebar): the breadcrumb and title, then its cards with their values read-only and ✎ Edit
 * for the side panel, or switches that save at once. Changes apply to new quotations and orders,
 * not ones already made.
 */
export async function SettingsPage({ href, description, children, adminOnly }: { href: string; description: ReactNode; children: ReactNode; /** For admins only (the company's address, the website form): not for a manager. */ adminOnly?: boolean }) {
  await requirePermission("settings.manage");
  if (adminOnly) await requirePermission("security.manage");
  return (
    <div>
      <PageHeader crumbs={crumbsFor(href)} title={labelFor(href)} description={description} />
      {children}
    </div>
  );
}

/** A section made of a settings group's cards (Company, Sales and quotations, Reminders, Emails). */
export async function GroupPage({ href, group: key }: { href: string; group: SettingsKey }) {
  await requirePermission("settings.manage");
  const group = SETTING_GROUPS.find((g) => g.key === key);
  if (!group) notFound();
  const [settings, lock] = await Promise.all([
    getSettings(),
    api.get<{ locked: boolean; reason: string | null }>("/settings/main-currency"),
  ]);
  return (
    <SettingsPage href={href} description={group.description}>
      <SettingsCards
        key={group.key}
        groupKey={group.key}
        values={settings[group.key] as Record<string, unknown>}
        action={saveSettingsAction.bind(null, group.key)}
        currencyLocked={lock.locked ? lock.reason : null}
      />
    </SettingsPage>
  );
}
