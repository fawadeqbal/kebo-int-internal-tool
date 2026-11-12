import { UserRound } from "lucide-react";
import { Avatar, Card, CardBody, CardHeader, PageHeader, SectionList, StatusBadge } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import type { SessionRow, SignInRow, TwoStepStatus } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { SessionList } from "@/components/security/session-list";
import { SignInList } from "@/components/security/sign-in-list";
import { changePasswordAction, confirmTwoStepAction, endMySessionAction, newRecoveryCodesAction, signOutOthersAction, startTwoStepAction, turnOffTwoStepAction } from "./actions";
import { PasswordEdit, TwoStepPanel } from "./forms";

export const metadata = { title: "My account" };

type Tab = "password" | "two-step" | "devices";

/**
 * The signed-in person's own sign-in, in the Settings frame: the sections down
 * the left (chips on a phone); the password read-only with ✎ Change for the
 * side panel, two-step sign-in, and the devices and sign-ins.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "two-step" || sp.tab === "devices" ? sp.tab : "password";
  const [status, sessions, signIns] = await Promise.all([api.get<TwoStepStatus>("/me/two-step"), api.get<SessionRow[]>("/me/sessions"), api.get<SignInRow[]>("/me/sign-ins")]);
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div>
      <PageHeader
        crumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "My account" }]}
        icon={UserRound}
        title="My account"
        summary={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Avatar name={me.name} size={22} />
            {me.name} · {me.email} · {me.roleName}
          </span>
        }
      />
      <SectionList
        label="Account sections"
        wide={tab === "devices"}
        items={[
          { href: "/account", label: "Password", active: tab === "password" },
          { href: "/account?tab=two-step", label: "Two-step sign-in", count: status.on ? "on" : "off", alert: !status.on && status.required, active: tab === "two-step" },
          { href: "/account?tab=devices", label: "Devices and sign-ins", count: sessions.length, active: tab === "devices" },
        ]}
      >
        {tab === "password" && (
          <Card>
            <CardHeader title="Password" description="What you sign in with. Changing it signs you out on your other devices." className="max-sm:flex-row max-sm:gap-3" actions={<PasswordEdit action={changePasswordAction} />} />
            <CardBody>
              <dl>
                <dt className="text-xs text-muted">Password</dt>
                <dd className="mt-0.5 text-sm tracking-widest" aria-label="Set, hidden">
                  ••••••••••
                </dd>
              </dl>
            </CardBody>
          </Card>
        )}
        {tab === "two-step" && (
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  Two-step sign-in {status.on ? <StatusBadge meaning="ok">On</StatusBadge> : <StatusBadge meaning={status.required ? "warn" : "neutral"}>Off</StatusBadge>}
                </span>
              }
              description="A code from your phone as well as your password."
            />
            <CardBody>
              <TwoStepPanel
                status={status}
                sinceText={status.since ? date(status.since) : null}
                start={startTwoStepAction}
                confirm={confirmTwoStepAction}
                newCodes={newRecoveryCodesAction}
                turnOff={turnOffTwoStepAction}
              />
            </CardBody>
          </Card>
        )}
        {tab === "devices" && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Card className="overflow-hidden">
              <CardHeader
                title="Where you are signed in"
                description="Browsers and phones that can use your account. Sign out any you do not recognise, then change your password."
                actions={
                  others > 0 ? (
                    <ConfirmAction action={signOutOthersAction} confirm={`Sign out your ${others} other device${others === 1 ? "" : "s"}?`} label="Sign out the others" pendingText="Signing out…" variant="secondary" size="xs" />
                  ) : undefined
                }
              />
              <SessionList sessions={sessions} end={(id) => endMySessionAction.bind(null, id)} />
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="Recent sign-ins" description="Yours, right and wrong. A wrong password you did not type means someone is trying: change it." />
              {signIns.length ? <SignInList rows={signIns} /> : <p className="px-4 py-3 text-sm text-muted">None yet.</p>}
            </Card>
          </div>
        )}
        <p className="text-xs text-muted">To change your name, email or role, ask a Super Admin.</p>
      </SectionList>
    </div>
  );
}
