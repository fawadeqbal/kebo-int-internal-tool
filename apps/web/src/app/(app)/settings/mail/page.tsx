import type { MailSettingsView } from "@kebo/shared";
import { PageHeader, RULES } from "@kebo/ui";
import { api } from "@/lib/api";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { removeMailAction, saveMailAction, testMailAction } from "./actions";
import { MailCards } from "@/components/common/mail-cards";
import { MoreMenu } from "@/components/common/more-menu";

export const metadata = { title: "Email sending · Admin settings" };

/** Admin settings › Email sending: the company's own outgoing email (Gmail, an SMTP server or Resend). */
export default async function Page() {
  const me = await requirePermission("security.manage");
  const view = await api.get<MailSettingsView>("/mail-settings");
  return (
    <div className={RULES.page.column}>
      <PageHeader
        crumbs={crumbsFor("/settings/mail")}
        title={labelFor("/settings/mail")}
        // Remove the company's own setting: last in ⋯, in red, with a confirm (not a red line under the cards).
        more={
          view.provider ? (
            <MoreMenu
              label="More for email sending"
              items={[
                {
                  label: "Remove this setting",
                  danger: true,
                  confirm: {
                    title: "Remove this company's own email setting?",
                    body: view.serverDefault ? "Its emails will go through the server's own again." : "No email will be sent until one is set again.",
                    confirmLabel: "Remove",
                  },
                  action: removeMailAction,
                },
              ]}
            />
          ) : undefined
        }
      />
      <MailCards view={view} me={me.email} saveAction={saveMailAction} testAction={testMailAction} />
    </div>
  );
}
