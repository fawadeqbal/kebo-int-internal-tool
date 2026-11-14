import type { MailSettingsView } from "@kebo/shared";
import { PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { removeMailAction, saveMailAction, testMailAction } from "./actions";
import { MailCards } from "./cards";

export const metadata = { title: "Email sending · Admin settings" };

/** Admin settings › Email sending: the company's own outgoing email (Gmail, an SMTP server or Resend). */
export default async function Page() {
  const me = await requirePermission("security.manage");
  const view = await api.get<MailSettingsView>("/mail-settings");
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/settings/mail")} title={labelFor("/settings/mail")} description="How this company's emails go out: quotations to customers, reminders and sign-in notes." />
      <MailCards view={view} me={me.email} saveAction={saveMailAction} removeAction={removeMailAction} testAction={testMailAction} />
    </div>
  );
}
