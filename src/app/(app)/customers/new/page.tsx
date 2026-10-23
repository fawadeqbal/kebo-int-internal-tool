import { requirePagePermission } from "@/lib/auth/session";
import { createCustomerAction } from "@/modules/customers/actions";
import { CustomerForm } from "@/modules/customers/components";
import { Card, CardBody, PageHeader } from "@/components/ui";

export const metadata = { title: "Add buyer" };

export default async function NewCustomerPage() {
  await requirePagePermission("customers.manage");
  return (
    <>
      <PageHeader title="Add buyer" backHref="/customers" backLabel="Buyers" />
      <Card className="max-w-3xl">
        <CardBody>
          <CustomerForm action={createCustomerAction} cancelHref="/customers" />
        </CardBody>
      </Card>
    </>
  );
}
