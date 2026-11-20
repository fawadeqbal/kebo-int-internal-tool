import { KeyRound, LogOut } from "lucide-react";
import { Badge, Card, CardHeader, PageHeader, StatusBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date, timeAgo } from "@/lib/format";
import type { SessionRow, TwoStepStatus } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { PanelButton } from "@/components/orders/step-view";
import { changePasswordAction, confirmTwoStepAction, endMySessionAction, newRecoveryCodesAction, renameSelfAction, signOutOthersAction, startTwoStepAction, turnOffTwoStepAction } from "./actions";
import { PasswordCardForm, ProfileForm, TwoStepPanel } from "./forms";
import { RecordBody } from "@/components/records/record-frame";

export const metadata = { title: "My account" };

/**
 * My account (board "My account"): Profile and Password on the left; Two-step sign-in and where you are
 * signed in on the right.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const [status, sessions, profile] = await Promise.all([
    api.get<TwoStepStatus>("/me/two-step"),
    api.get<SessionRow[]>("/me/sessions"),
    api.get<{ phone: string | null; language: string }>("/me/profile").catch(() => null),
  ]);
  const twoStep = (
    <TwoStepPanel
      status={status}
      sinceText={status.since ? date(status.since) : null}
      start={startTwoStepAction}
      confirm={confirmTwoStepAction}
      newCodes={newRecoveryCodesAction}
      turnOff={turnOffTwoStepAction}
    />
  );
  // This device first, then the latest four; the rest are signed out together.
  const shown = [
    ...sessions.filter((x) => x.current),
    ...sessions
      .filter((x) => !x.current)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, 4),
  ];
  const others = sessions.filter((x) => !x.current).length;
  // Asked for (a reminder's link), or needed and still off: the setup shows in the card itself.
  const inline = sp.tab === "two-step" || (status.required && !status.on);
  return (
    <>
      <PageHeader crumbs={[{ label: "My account" }]} title="My account" summary={`${me.name} · ${me.roleName}`} />
      <RecordBody
        panelLabel="Beside your account"
        panel={
          <>
          <Card>
            <CardHeader title="Two-step sign-in" />
            <div className="flex flex-col items-start gap-2.5 p-5 text-sm">
              <p>
                {status.on ? (
                  <StatusBadge meaning="ok">On</StatusBadge>
                ) : (
                  <StatusBadge meaning={status.required ? "warn" : "neutral"}>Off</StatusBadge>
                )}{" "}
                Two-step sign-in with an authenticator app
              </p>
              {status.required && <p className="text-md text-muted">Your role requires it.</p>}
              {inline ? (
                <div className="w-full">{twoStep}</div>
              ) : (
                <PanelButton
                  size="sm"
                  className="w-full justify-start"
                  icon={<KeyRound aria-hidden />}
                  label={status.on ? "Recovery codes" : "Turn on two-step sign-in"}
                  title="Two-step sign-in"
                  description="A code from your phone as well as your password."
                  body={<div className="p-5">{twoStep}</div>}
                />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Where you are signed in" />
            <ul className="flex flex-col gap-3 p-5 text-md">
              {shown.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-text">
                      {s.device}
                      {s.ip && <span className="text-muted"> · {s.ip}</span>}
                    </span>
                    <span className="block text-text-2">{s.current ? "this device" : timeAgo(s.lastSeenAt)}</span>
                  </span>
                  {s.current ? (
                    <Badge tone="ok">Now</Badge>
                  ) : (
                    <ConfirmAction
                      action={endMySessionAction.bind(null, s.id)}
                      confirm={`Sign out ${s.device}?`}
                      label="Sign out"
                      icon={<LogOut aria-hidden />}
                      pendingText="Signing out…"
                      variant="secondary"
                      size="xs"
                      showSuccess={false}
                    />
                  )}
                </li>
              ))}
              {others > shown.length - 1 && (
                <li className="flex items-center justify-between gap-3 border-t border-surface-2 pt-3 text-text-2">
                  <span>
                    {others} other device{others === 1 ? "" : "s"} in all
                  </span>
                  <ConfirmAction
                    action={signOutOthersAction}
                    confirm={`Sign out your ${others} other devices?`}
                    label="Sign out all"
                    icon={<LogOut aria-hidden />}
                    pendingText="Signing out…"
                    variant="secondary"
                    size="xs"
                    showSuccess={false}
                  />
                </li>
              )}
            </ul>
          </Card>
          </>
        }
      >
          <Card>
            <CardHeader title="Profile" />
            <div className="p-5">
              <ProfileForm
                action={renameSelfAction}
                name={me.name}
                email={me.email}
                phone={profile?.phone}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Password" />
            <div className="p-5">
              <PasswordCardForm action={changePasswordAction} />
            </div>
          </Card>
      </RecordBody>
    </>
  );
}
