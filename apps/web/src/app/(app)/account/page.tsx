import { Avatar, Card, CardBody, CardHeader, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import type { SessionRow, SignInRow, TwoStepStatus } from "@/lib/types-people";
import { ConfirmAction } from "@/components/people/confirm-action";
import { SessionList } from "@/components/security/session-list";
import { SignInList } from "@/components/security/sign-in-list";
import { changePasswordAction, confirmTwoStepAction, endMySessionAction, newRecoveryCodesAction, signOutOthersAction, startTwoStepAction, turnOffTwoStepAction } from "./actions";
import { PasswordForm, TwoStepPanel } from "./forms";

export const metadata = { title: "My account" };

/** The signed-in person's own sign-in: password and two-step sign-in. */
export default async function AccountPage() {
  const me = await requireUser();
  const [status, sessions, signIns] = await Promise.all([api.get<TwoStepStatus>("/me/two-step"), api.get<SessionRow[]>("/me/sessions"), api.get<SignInRow[]>("/me/sign-ins")]);
  const others = sessions.filter((s) => !s.current).length;
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="My account"
        description={
          <span className="flex items-center gap-2">
            <Avatar name={me.name} size={22} />
            {me.name} · {me.email} · {me.roleName}
          </span>
        }
      />
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card>
          <CardHeader title="Password" description="Changing it signs you out on your other devices" />
          <CardBody>
            <PasswordForm action={changePasswordAction} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Two-step sign-in" description="A code from your phone as well as your password" />
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
      </div>
      <div className="mt-5 grid items-start gap-5 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
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
          {signIns.length ? <SignInList rows={signIns} /> : <p className="px-4 pb-4 text-sm text-muted">None yet.</p>}
        </Card>
      </div>
      <p className="mt-5 text-xs text-muted">To change your name, email or role, ask a Super Admin.</p>
    </div>
  );
}
