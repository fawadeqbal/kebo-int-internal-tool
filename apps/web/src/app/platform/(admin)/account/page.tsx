import { Card, CardBody, CardHeader, PageHeader } from "@kebo/ui";
import { requirePlatformAdmin } from "@/lib/platform";
import { PasswordEdit } from "./form";

export const metadata = { title: "Your password" };

/** The platform admin's own sign-in (Settings frame): the password read-only, ✎ Change for the side panel. */
export default async function PlatformAccountPage() {
  const me = await requirePlatformAdmin();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Your password" summary={`${me.name} · ${me.email} · two-step sign-in is on`} />
      <Card>
        <CardHeader title="Password" description="Changing it signs you out on your other devices." className="max-sm:flex-row max-sm:gap-3" actions={<PasswordEdit />} />
        <CardBody>
          <dl>
            <dt className="text-xs text-muted">Password</dt>
            <dd className="mt-0.5 text-sm tracking-widest" aria-label="Set, hidden">
              ••••••••••
            </dd>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
