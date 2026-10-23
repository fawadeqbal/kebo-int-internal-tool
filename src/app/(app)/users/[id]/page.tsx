import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { resetPasswordAction, toggleUserActiveAction, updateUserAction } from "@/modules/users/actions";
import { findUserById } from "@/modules/users/repository";
import { isUuid } from "@/lib/utils/ids";
import { PasswordForm, UserForm } from "@/modules/users/components";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ui/client";
import { Badge } from "@/components/ui/badge";

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
        description={user.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Deactivated</Badge>}
        backHref="/users"
        backLabel="Users"
      />
      <div className="flex max-w-3xl flex-col gap-6">
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
              title={user.isActive ? "Deactivate account" : "Reactivate account"}
              description={user.isActive ? "The user is signed out and can no longer sign in. Their history is kept." : "Allow this user to sign in again."}
            />
            <CardBody>
              <form action={toggleUserActiveAction.bind(null, user.id, !user.isActive)}>
                <ConfirmSubmit
                  variant={user.isActive ? "danger" : "secondary"}
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
