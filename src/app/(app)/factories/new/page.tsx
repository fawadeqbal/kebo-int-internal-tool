import { requirePagePermission } from "@/lib/auth/session";
import { createSupplierAction } from "@/modules/sourcing/actions";
import { SupplierForm } from "@/modules/sourcing/components";
import { Card, CardBody, PageHeader } from "@/components/ui";

export const metadata = { title: "Add factory" };

export default async function NewFactoryPage() {
  await requirePagePermission("sourcing.manage");
  return (
    <>
      <PageHeader title="Add factory" description="Only the name is needed now; fill in the rest when you have it." backHref="/factories" backLabel="Factories" />
      <div className="max-w-3xl">
        <Card>
          <CardBody>
            <SupplierForm action={createSupplierAction} cancelHref="/factories" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
