import { ROLE_LABEL } from "@kebo/shared";
import { Avatar, Card, CardBody, CardHeader, PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import type { TwoStepStatus } from "@/lib/types-people";
import { changePasswordAction, confirmTwoStepAction, newRecoveryCodesAction, startTwoStepAction, turnOffTwoStepAction } from "./actions";
import { PasswordForm, TwoStepPanel } from "./forms";

export const metadata = { title: "My account" };

/** The signed-in person's own sign-in: password and two-step sign-in. */
export default async function AccountPage() {
  const me = await requireUser();
  const status = await api.get<TwoStepStatus>("/me/two-step");
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="My account"
        description={
          <span className="flex items-center gap-2">
            <Avatar name={me.name} size={22} />
            {me.name} · {me.email} · {ROLE_LABEL[me.role]}
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
      <p className="mt-5 text-xs text-muted">To change your name, email or role, ask a Super Admin.</p>
    </div>
  );
}
