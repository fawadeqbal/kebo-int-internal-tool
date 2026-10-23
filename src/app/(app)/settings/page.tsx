import { requirePagePermission } from "@/lib/auth/session";
import { loadSettings } from "@/modules/settings/service";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";
import { WebsiteFormCard } from "./website-card";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requirePagePermission("settings.manage");
  const settings = await loadSettings();
  return (
    <>
      <PageHeader title="Settings" description="Notifications, categories, company details and defaults." />
      <div className="flex flex-col gap-5">
        <SettingsForm settings={settings} smtpConfigured={!!process.env.SMTP_HOST} />
        <WebsiteFormCard appUrl={process.env.APP_URL ?? "https://your-server"} />
      </div>
    </>
  );
}
