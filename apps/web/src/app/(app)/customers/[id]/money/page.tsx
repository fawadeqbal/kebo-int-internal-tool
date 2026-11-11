import { can } from "@kebo/shared";
import { requireUser, hasFeature } from "@/lib/session";
import { customerOf } from "@/lib/party-data";
import { CustomerMoney } from "@/components/money/customer-money";

export const metadata = { title: "Customer money" };

/** The customer's Money tab: what they paid and still owe, and (managers) what they earned us. */
export default async function CustomerMoneyTab({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const [c, managers] = await Promise.all([customerOf(id), can(me, "expenses.manage") ? hasFeature("expenses") : false]);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[15px] font-semibold">
        Money <span className="text-xs font-normal text-muted">· what they paid and still owe{managers ? ", and what they earned us" : ""}</span>
      </h2>
      <CustomerMoney
        customerId={c.id}
        customerName={c.name}
        view={sp.view === "profit" ? "profit" : "payments"}
        managers={managers}
        records={can(me, "payments.record")}
      />
    </div>
  );
}
