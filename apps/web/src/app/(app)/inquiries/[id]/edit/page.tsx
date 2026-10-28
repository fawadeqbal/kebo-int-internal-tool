import { can } from "@kebo/shared";
import { Alert } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requireUser } from "@/lib/session";
import type { DealDetail } from "@/lib/types";
import type { DealFormValues, SalesSettings } from "@/lib/types-deals";
import { DealForm } from "@/components/deals/deal-form";
import { customerContactsAction, saveDealAction, searchCustomersAction } from "../../actions";

export const metadata = { title: "Edit inquiry" };

/** Edit the request: items keep their ids, so factory prices and quotation lines stay linked. */
export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [d, settings] = await Promise.all([
    load(() => api.get<DealDetail>(`/inquiries/${id}`)),
    api.get<{ sales: SalesSettings }>("/settings"),
  ]);
  if (!d.allowed.edit)
    return (
      <Alert tone="warning">
        {d.stage === "won" || d.stage === "lost"
          ? "This inquiry is closed. Reopen it to change the details."
          : "Only the person handling this inquiry or a manager can change it."}
      </Alert>
    );

  const primary = d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0] ?? null;
  const sent = d.quotation?.revisions.some((r) => r.status !== "draft");
  const initial: DealFormValues = {
    customer: {
      id: d.customer.id,
      name: d.customer.name,
      country: d.customer.country,
      primaryContact: primary && { id: primary.id, name: primary.name },
    },
    contactId: d.contactId ?? "",
    channel: d.channel,
    category: d.category,
    title: d.title,
    requirements: d.requirements ?? "",
    priority: d.priority,
    requiredBy: d.requiredBy ?? "",
    assigneeId: d.assignee?.id ?? "",
    items: d.items.map((it) => ({
      id: it.id,
      key: it.id,
      description: it.description,
      model: it.model ?? "",
      quantity: it.quantity,
      unit: it.unit,
      targetPrice: it.targetPrice ?? "",
      parentKey: it.parentId, // saved rows are keyed by id
      priced: it.priced,
    })),
  };
  return (
    <div className="max-w-4xl">
      <h2 className="mb-1 text-base font-semibold">Edit the inquiry</h2>
      <p className="mb-4 text-sm text-muted">
        Factory prices stay linked to the items you keep; prices for a removed item are no longer compared. Who handles the inquiry is changed
        on the Overview tab.
      </p>
      <DealForm
        mode="edit"
        action={saveDealAction.bind(null, d.id)}
        initial={initial}
        initialContacts={d.customer.contacts}
        categories={settings.sales.categories}
        people={null}
        meId={me.id}
        canAssignOthers={can(me, "inquiries.assign")}
        customerLocked={sent ? "Already quoted: the customer cannot change" : undefined}
        itemsFromExcel={!sent}
        searchCustomers={searchCustomersAction}
        loadContacts={customerContactsAction}
        cancelHref={`/inquiries/${d.id}`}
      />
    </div>
  );
}
