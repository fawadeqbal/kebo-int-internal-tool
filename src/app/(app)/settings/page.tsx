import { requirePagePermission } from "@/lib/auth/session";
import { loadSettings } from "@/modules/settings/service";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePagePermission("settings.manage");
  const settings = await loadSettings();
  return (
    <>
      <PageHeader title="Settings" description="Company details, tax, defaults and reminder rules." />
      <SettingsForm settings={settings} />
    </>
  );
}
