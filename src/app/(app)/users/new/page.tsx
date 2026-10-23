import { requirePagePermission } from "@/lib/auth/session";
import { createUserAction } from "@/modules/users/actions";
import { UserForm } from "@/modules/users/components";
import { Card, CardBody, PageHeader } from "@/components/ui";

export const metadata = { title: "Add user" };

export default async function NewUserPage() {
  await requirePagePermission("users.manage");
  return (
    <>
      <PageHeader title="Add user" backHref="/users" backLabel="Users" />
      <Card className="max-w-3xl">
        <CardBody>
          <UserForm action={createUserAction} withPassword />
        </CardBody>
      </Card>
    </>
  );
}
