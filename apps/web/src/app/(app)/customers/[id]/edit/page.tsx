import { PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requirePermission } from "@/lib/session";
import type { CustomerDetail } from "@/lib/types-people";
import { saveCustomerAction } from "../../actions";
import { CustomerForm } from "../../customer-form";
import { currenciesFrom, type SalesCurrencies } from "../../currencies";

export const metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("customers.manage");
  const [c, settings] = await Promise.all([load(() => api.get<CustomerDetail>(`/customers/${id}`)), api.get<SalesCurrencies>("/settings")]);
  return (
    <div className="max-w-4xl">
      <PageHeader backHref={`/customers/${c.id}`} backLabel={c.name} title={`Edit ${c.name}`} description="Removing a contact keeps them on past inquiries; they just stop appearing in pickers." />
      <CustomerForm action={saveCustomerAction.bind(null, c.id)} customer={c} currencies={currenciesFrom(settings)} cancelHref={`/customers/${c.id}`} />
    </div>
  );
}
