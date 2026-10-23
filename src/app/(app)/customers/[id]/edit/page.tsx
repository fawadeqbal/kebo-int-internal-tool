import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { customerName } from "@/lib/utils/names";
import { isUuid } from "@/lib/utils/ids";
import { updateCustomerAction } from "@/modules/customers/actions";
import { CustomerForm } from "@/modules/customers/components";
import { findCustomer } from "@/modules/customers/repository";
import { Card, CardBody, PageHeader } from "@/components/ui";

export const metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("customers.manage");
  const { id } = await params;
  const customer = isUuid(id) ? await findCustomer(id) : null;
  if (!customer) notFound();
  return (
    <>
      <PageHeader title={`Edit ${customerName(customer)}`} backHref={`/customers/${id}`} backLabel={customerName(customer)} />
      <Card className="max-w-3xl">
        <CardBody>
          <CustomerForm action={updateCustomerAction.bind(null, id)} initial={customer} cancelHref={`/customers/${id}`} />
        </CardBody>
      </Card>
    </>
  );
}
