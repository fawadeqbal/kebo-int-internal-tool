import { Card, CardBody, CardHeader, PageHeader } from "@kebo/ui";
import { requirePlatformAdmin } from "@/lib/platform";
import { PasswordForm } from "./form";

export const metadata = { title: "Your password" };

export default async function PlatformAccountPage() {
  const me = await requirePlatformAdmin();
  return (
    <div className="max-w-xl">
      <PageHeader title="Your password" description={`${me.name} · ${me.email} · two-step sign-in is on`} />
      <Card>
        <CardHeader title="Change your password" />
        <CardBody>
          <PasswordForm />
        </CardBody>
      </Card>
    </div>
  );
}
