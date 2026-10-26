import { PageHeader } from "@kebo/ui";
import { api } from "@/lib/api";
import { requirePermission } from "@/lib/session";
import { saveCustomerAction } from "../actions";
import { CustomerForm } from "../customer-form";
import { currenciesFrom, type SalesCurrencies } from "../currencies";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  await requirePermission("customers.manage");
  const settings = await api.get<SalesCurrencies>("/settings");
  return (
    <div className="max-w-4xl">
      <PageHeader backHref="/customers" backLabel="Customers" title="New customer" description="Add the buyer and at least one person you can reach. If they may already exist, you will be told before saving." />
      <CustomerForm action={saveCustomerAction.bind(null, null)} customer={null} currencies={currenciesFrom(settings)} cancelHref="/customers" />
    </div>
  );
}
