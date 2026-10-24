import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { resetPasswordAction, toggleUserActiveAction, updateUserAction } from "@/modules/users/actions";
import { findUserById } from "@/modules/users/repository";
import { isUuid } from "@/lib/utils/ids";
import { PasswordForm, UserForm } from "@/modules/users/components";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ui/client";
import { Badge } from "@/components/ui/badge";
import { twoStepRequired } from "@/lib/auth/permissions";
import { adminResetTwoStepAction } from "@/modules/users/two-step-actions";

export const metadata = { title: "Edit user" };

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("users.manage");
  const { id } = await params;
  const user = isUuid(id) ? await findUserById(id) : null;
  if (!user) notFound();
  return (
    <>
      <PageHeader
        title={user.name}
        description={
          <span className="flex items-center gap-2">
            {user.email}
            {user.isActive ? (
              <Badge tone="ok" dot>
                Active
              </Badge>
            ) : (
              <Badge dot>Deactivated</Badge>
            )}
          </span>
        }
        backHref="/users"
        backLabel="Users"
      />
      <div className="flex max-w-3xl flex-col gap-5">
        <Card>
          <CardHeader title="Profile & role" />
          <CardBody>
            <UserForm action={updateUserAction.bind(null, user.id)} initial={user} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Reset password" description="Set a new temporary password and share it with the user." />
          <CardBody>
            <PasswordForm action={resetPasswordAction.bind(null, user.id)} />
          </CardBody>
        </Card>
        {actor.id !== user.id && (
          <Card>
            <CardHeader
              title="Two-step sign-in"
              description={
                user.twoStepOn
                  ? "On. If they lost their phone and their recovery codes, reset it: they are signed out and set it up again at next sign-in."
                  : twoStepRequired(user.role)
                    ? "Not set up yet. They will be asked to set it up when they next sign in."
                    : "Off (optional for this role)."
              }
            />
            {user.twoStepOn && (
              <CardBody>
                <form action={adminResetTwoStepAction.bind(null, user.id)}>
                  <ConfirmSubmit variant="secondary" size="sm" message={`Reset two-step sign-in for ${user.name}? They will be signed out everywhere.`}>
                    Reset two-step sign-in
                  </ConfirmSubmit>
                </form>
              </CardBody>
            )}
          </Card>
        )}
        {actor.id !== user.id && (
          <Card>
            <CardHeader
              title={user.isActive ? "Deactivate account" : "Reactivate account"}
              description={user.isActive ? "The user is signed out and can no longer sign in. Their history is kept." : "Allow this user to sign in again."}
            />
            <CardBody>
              <form action={toggleUserActiveAction.bind(null, user.id, !user.isActive)}>
                <ConfirmSubmit
                  variant={user.isActive ? "danger" : "secondary"}
                  size="sm"
                  message={user.isActive ? `Deactivate ${user.name}?` : `Reactivate ${user.name}?`}
                >
                  {user.isActive ? "Deactivate" : "Reactivate"}
                </ConfirmSubmit>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
