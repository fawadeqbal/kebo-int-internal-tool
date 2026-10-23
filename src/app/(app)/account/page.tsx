import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { changeOwnPasswordAction } from "@/modules/users/actions";
import { PasswordForm } from "@/modules/users/components";
import { Card, CardBody, CardHeader, DetailList, PageHeader } from "@/components/ui";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireUser();
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
          <CardHeader title="Change password" />
          <CardBody>
            <PasswordForm action={changeOwnPasswordAction} own />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
