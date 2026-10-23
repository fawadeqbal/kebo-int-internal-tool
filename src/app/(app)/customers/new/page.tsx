import { requirePagePermission } from "@/lib/auth/session";
import { createCustomerAction } from "@/modules/customers/actions";
import { CustomerForm } from "@/modules/customers/components";
import { Card, CardBody, PageHeader } from "@/components/ui";

export const metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  await requirePagePermission("customers.manage");
  return (
    <>
      <PageHeader title="Add customer" backHref="/customers" backLabel="Customers" />
      <Card className="max-w-3xl">
        <CardBody>
          <CustomerForm action={createCustomerAction} cancelHref="/customers" />
        </CardBody>
      </Card>
    </>
  );
}
