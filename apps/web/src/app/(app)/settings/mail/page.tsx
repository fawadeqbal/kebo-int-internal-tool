import { MAIL_PROVIDER_LABEL, MAIL_USE_LABEL, MAIL_USES, type MailAccountView, type MailSettingsView } from "@kebo/shared";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, RULES } from "@kebo/ui";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { crumbsFor, labelFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { disconnectAction, saveAccountAction, saveUsesAction, testMailAction } from "./actions";
import { AccountForm, TestForm, UsesForm } from "./cards";
import { RowMenu } from "@/components/common/more-menu";

export const metadata = { title: "Email accounts · Admin settings" };

/** What an account sends, in words: the uses set to it, and "anything else" for the default. */
function sends(view: MailSettingsView, a: MailAccountView): string {
  const mine = MAIL_USES.filter((u) => view.uses[u] === a.id || (!view.uses[u] && view.defaultId === a.id)).map(
    (u) => MAIL_USE_LABEL[u].label,
  );
  return mine.length ? mine.join(" · ") : view.choose ? "When chosen in a send window" : "Nothing at the moment";
}

/**
 * Admin settings › Email accounts (design 21 Nov 2026): the addresses the company sends from (Gmail, an SMTP
 * server or Resend), which one each kind of email goes from, and a test. ?add opens the form to connect one;
 * ?edit=<id> changes one.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ add?: string; edit?: string }> }) {
  const sp = await searchParams;
  const me = await requirePermission("security.manage");
  const view = await api.get<MailSettingsView>("/mail-settings");
  const editing = sp.edit ? view.accounts.find((a) => a.id === sp.edit) : undefined;
  const adding = sp.add !== undefined || (!view.accounts.length && !view.serverDefault && !editing);
  return (
    <div className={RULES.page.column}>
      <PageHeader
        crumbs={crumbsFor("/settings/mail")}
        title={labelFor("/settings/mail")}
        actions={
          !adding && !editing ? (
            <ButtonLink href="/settings/mail?add" variant="strong">
              <Plus aria-hidden /> Connect an email
            </ButtonLink>
          ) : undefined
        }
      />
      {(adding || editing) && (
        <AccountForm key={editing?.id ?? "new"} account={editing} action={saveAccountAction.bind(null, editing?.id ?? null)} />
      )}
      {(view.accounts.length > 0 || !adding) && (
        <Card className="overflow-hidden">
          <CardHeader
            title="Connected"
            description={
              view.accounts.length
                ? `${view.accounts.length} ${view.accounts.length === 1 ? "address" : "addresses"}`
                : view.serverDefault
                  ? "None yet: email goes through the server's own"
                  : "None yet: no email is sent"
            }
          />
          {view.accounts.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {view.accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3 max-sm:px-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{a.fromEmail}</span>
                      {view.defaultId === a.id && view.accounts.length > 1 && <Badge>Default</Badge>}
                    </div>
                    <div className="truncate text-xs text-text-2">
                      {[a.fromName, a.provider === "smtp" ? `SMTP · ${a.host}` : MAIL_PROVIDER_LABEL[a.provider]]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    <div className="mt-0.5 text-xs text-text-2">Sends: {sends(view, a)}</div>
                  </div>
                  <RowMenu
                    label={`More for ${a.fromEmail}`}
                    items={[
                      { label: "Change", href: `/settings/mail?edit=${a.id}` },
                      {
                        label: "Disconnect",
                        danger: true,
                        confirm: {
                          title: `Disconnect ${a.fromEmail}?`,
                          body:
                            view.accounts.length > 1
                              ? "What it sends will go from the default address."
                              : view.serverDefault
                                ? "Email will go through the server's own again."
                                : "No email will be sent until one is connected again.",
                          confirmLabel: "Disconnect",
                        },
                        action: disconnectAction.bind(null, a.id),
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No email connected"
              description="Connect the address your quotations should come from, like sales@ your company."
            />
          )}
        </Card>
      )}
      {view.accounts.length > 0 && (
        <UsesForm key={JSON.stringify([view.defaultId, view.uses, view.choose])} view={view} action={saveUsesAction} />
      )}
      {view.enabled && <TestForm view={view} me={me.email} action={testMailAction} />}
    </div>
  );
}
