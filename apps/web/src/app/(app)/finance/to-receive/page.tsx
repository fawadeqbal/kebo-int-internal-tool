import { redirect } from "next/navigation";
import { PageHeader } from "@kebo/ui";
import { crumbsFor } from "@/lib/nav";
import { requirePermission } from "@/lib/session";
import { moneyAccess, ReceiveBody } from "../sections";

export const metadata = { title: "To receive" };

/** Finance › To receive: what customers still owe us, order by order, the most overdue first. */
export default async function ToReceivePage() {
  const me = await requirePermission("sourcing.manage");
  if (!(await moneyAccess(me)).recorders) redirect("/forbidden");
  return (
    <div>
      <PageHeader crumbs={crumbsFor("/finance/to-receive")} title="To receive" description="What customers still owe us, order by order. Overdue first." />
      <ReceiveBody />
    </div>
  );
}
