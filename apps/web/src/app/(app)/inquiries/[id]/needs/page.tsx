import Link from "next/link";
import { Plus } from "lucide-react";
import { can, CHANNEL_LABEL, INQUIRY_CHANNELS, PRIORITIES, PRIORITY_LABEL } from "@kebo/shared";
import { buttonClass } from "@kebo/ui";
import { requireUser } from "@/lib/session";
import { date } from "@/lib/format";
import { dealHistoryOf, dealOf } from "@/lib/deal-data";
import { optional } from "@/components/print/data";
import { StepChanges, StepFrame, StepHeader, StepPrevNext } from "@/components/orders/step-page";
import { DetailsCard, LinesCard, ViewCard, type DetailField } from "@/components/orders/step-view";
import { changesIn, FilesCard } from "@/components/deals/inquiry-side";
import { DocumentChips, DocumentsButton, ItemsEditor, ItemsExcel, ItemsView } from "@/components/deals/needs-cards";
import { dealFieldsAction, describeFileAction, removeFileAction } from "../../actions";
import { askFactories } from "../ask";
import { inquirySteps, itemsLine } from "../steps";

export const metadata = { title: "Inquiry · needs" };

/**
 * Step 1, Needs (board InqV4Needs): who asked and how, what they need (their
 * items, read only until Edit lines) and their URS and documents; the files
 * and the step's changes on the side.
 */
export default async function DealNeeds({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const [d, history] = await Promise.all([dealOf(id), optional(() => dealHistoryOf(id))]);
  const base = `/inquiries/${d.id}`;
  const sourcing = can(me, "sourcing.manage");
  const step = inquirySteps(d, sourcing ? 0 : null).find((s) => s.key === "needs")!;
  const ask = await askFactories(d, me);
  const name = (uid: string | null) => (uid ? (d.people[uid] ?? "Someone") : "System");
  // No contact chosen: the customer's main one is who we talk to.
  const contact = d.customer.contacts.find((c) => c.id === d.contactId) ?? d.customer.contacts.find((c) => c.isPrimary) ?? d.customer.contacts[0] ?? null;
  const urs = d.attachments.find((f) => f.kind === "urs");
  const quoted = d.quotation?.revisions.some((r) => r.status !== "draft") ?? false;
  const files = d.attachments.map((f) => ({
    ...f,
    uploadedBy: name(f.uploadedById),
    when: date(f.createdAt),
    canChange: f.uploadedById === me.id || d.canWork,
    describe: describeFileAction.bind(null, d.id, f.id),
    remove: removeFileAction.bind(null, d.id, f.id),
  }));
  const canEdit = d.allowed.edit;

  const fields: DetailField[] = [
    {
      label: "Customer",
      value: d.customer.name,
      show: (
        <Link href={`/customers/${d.customer.id}`} className="hover:underline">
          {d.customer.name}
        </Link>
      ),
    },
    {
      name: "contactId",
      label: "Contact",
      type: "select",
      value: d.contactId ?? contact?.id ?? null,
      options: d.customer.contacts.map((c) => ({ value: c.id, label: c.name })),
      show: contact ? [contact.name, contact.whatsapp ?? contact.phone ?? contact.email].filter(Boolean).join(" · ") : undefined,
    },
    {
      name: "channel",
      label: "Came by",
      type: "select",
      value: d.channel,
      options: INQUIRY_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })),
      show: `${CHANNEL_LABEL[d.channel]} · ${date(d.createdAt)}`,
    },
    { label: "Handled by", value: d.assignee?.name ?? null },
    { name: "requiredBy", label: "Wanted by", type: "date", value: d.requiredBy, show: d.requiredBy ? date(d.requiredBy) : undefined },
    { name: "category", label: "Category", value: d.category },
    { name: "priority", label: "Priority", type: "select", value: d.priority, options: PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })), panelOnly: true },
    { name: "title", label: "Title", value: d.title, panelOnly: true, wide: true, placeholder: "Leave empty to name it after the items" },
  ];

  return (
    <StepFrame
      header={
        <StepHeader
          step={{
            number: step.number,
            label: step.label,
            state: step.state,
            stateLabel: step.stateLabel,
            line: [itemsLine(d), urs?.fileName ?? null, d.assignee ? `handled by ${d.assignee.name}` : "nobody handles it yet"].filter(Boolean).join(" · "),
          }}
          action={ask?.button}
        />
      }
      side={
        <>
          <FilesCard
            files={d.attachments.map((f) => ({ id: f.id, name: f.fileName }))}
            add={
              <DocumentsButton dealId={d.id} files={files}>
                <Plus className="size-3.5" aria-hidden /> Add files
              </DocumentsButton>
            }
          />
          {history && <StepChanges entries={changesIn(history, "needs")} historyHref={`${base}/history`} />}
        </>
      }
      prevNext={
        <StepPrevNext
          prev={{ href: base, label: "Overview" }}
          next={sourcing ? { href: `${base}/sourcing`, label: "Factory prices" } : { href: `${base}/quotation`, label: "Quotation" }}
        />
      }
    >
      <DetailsCard
        title="Customer and request"
        description=""
        fields={fields}
        action={dealFieldsAction.bind(null, d.id)}
        canEdit={canEdit}
        panelTitle="Edit the customer and request"
        panelDescription="Who asked, how and by when. To change the customer itself, use Edit details at the top."
      />
      <LinesCard
        title="What they need"
        description={itemsLine(d)}
        canEdit={canEdit}
        actions={<ItemsExcel items={d.items} />}
        view={<ItemsView items={d.items} requirements={d.requirements} />}
        phone={<ItemsView items={d.items} requirements={d.requirements} phone />}
        edit={<ItemsEditor items={d.items} requirements={d.requirements} action={dealFieldsAction.bind(null, d.id)} upload={!quoted} />}
      />
      <ViewCard
        id="documents"
        title="URS & documents"
        canEdit={false}
        actions={
          d.attachments.length > 1 ? (
            <a href={`/files/inquiries/${d.id}`} className={buttonClass("ghost", "xs")}>
              Download all
            </a>
          ) : undefined
        }
      >
        <div className="px-4 py-3.5">
          <DocumentChips dealId={d.id} files={files} canAdd />
        </div>
      </ViewCard>
    </StepFrame>
  );
}
