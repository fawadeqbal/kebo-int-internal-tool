import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { changeOwnPasswordAction } from "@/modules/users/actions";
import { PasswordCard } from "@/modules/users/components";
import { ButtonLink, Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/utils/dates";
import { twoStepStatus } from "@/modules/users/two-step";
import { regenerateRecoveryCodesAction, turnOffTwoStepAction } from "@/modules/users/two-step-actions";
import { TwoStepCodeAction } from "@/modules/users/two-step-components";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireUser();
  const twoStep = await twoStepStatus(user.id);
  return (
    <>
      <PageHeader title="My account" />
      <div className="flex max-w-3xl flex-col gap-5">
        <Card>
          <CardHeader title="Profile" description="Ask an administrator to change your name, email or role." />
          <CardBody>
            <DetailList
              items={[
                { label: "Name", value: user.name },
                { label: "Email", value: user.email },
                { label: "Role", value: ROLE_LABELS[user.role] },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Two-step sign-in"
            description={
              twoStep.on
                ? `On since ${formatDate(twoStep.since?.toISOString().slice(0, 10))} · ${twoStep.recoveryLeft} recovery code${twoStep.recoveryLeft === 1 ? "" : "s"} left`
                : "Off. Add a code from your phone to your password, so a stolen password alone can't open your account."
            }
          />
          <CardBody className="flex flex-wrap items-start gap-2">
            {twoStep.on ? (
              <>
                <TwoStepCodeAction
                  action={regenerateRecoveryCodesAction}
                  label="Make new recovery codes"
                  description="Your old recovery codes stop working. Enter a current code from your app."
                />
                <TwoStepCodeAction
                  action={turnOffTwoStepAction.bind(null, "new_phone")}
                  label="Move to a new phone"
                  description="Removes the old phone, then shows a new QR code to scan. Enter a current code from your app first."
                />
                {!twoStep.required && (
                  <TwoStepCodeAction
                    action={turnOffTwoStepAction.bind(null, "off")}
                    label="Turn off"
                    danger
                    description="Your account will be protected by the password only. Enter a current code from your app."
                  />
                )}
              </>
            ) : (
              <ButtonLink href="/two-step/setup" size="sm">
                Set up two-step sign-in
              </ButtonLink>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" />
          <CardBody>
            <PasswordCard action={changeOwnPasswordAction} own title="Change my password" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
