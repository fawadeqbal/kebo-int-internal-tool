import type { Settings } from "@kebo/shared";
import { PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { saveSettingsAction } from "./actions";
import { SettingsGroupForm } from "./forms";
import { SETTING_GROUPS } from "./groups";

export const metadata = { title: "Settings" };

/** Company details, sales defaults, reminders, order plan timings and email notifications; each group saves on its own. */
export default async function SettingsPage() {
  await requirePermission("settings.manage");
  const settings = await api.get<Settings>("/settings");
  return (
    <div>
      <PageHeader title="Settings" description="How the whole team works. Each section saves on its own; changes apply to new quotations and orders, not ones already made." />
      <div className="grid items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible [scrollbar-width:none]">
            {SETTING_GROUPS.map((g) => (
              <li key={g.key} className="shrink-0">
                <a href={`#${g.key}`} className="block rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-text-2 hover:bg-surface-2 hover:text-text">
                  {g.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex max-w-3xl min-w-0 flex-col gap-6">
          {SETTING_GROUPS.map((g) => (
            <SettingsGroupForm key={g.key} groupKey={g.key} values={settings[g.key] as Record<string, unknown>} action={saveSettingsAction.bind(null, g.key)} />
          ))}
        </div>
      </div>
    </div>
  );
}
