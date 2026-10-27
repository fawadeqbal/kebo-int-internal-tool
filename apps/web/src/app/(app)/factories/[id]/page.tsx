import Link from "next/link";
import { can } from "@kebo/shared";
import { ButtonLink, Card, CardBody, CardHeader, DetailList, EmptyState, PageHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requirePermission } from "@/lib/session";
import { date } from "@/lib/format";
import type { FactoryDetail } from "@/lib/types-people";
import type { HistoryEntry } from "@/lib/types";
import { HistoryList } from "@/components/common/history-list";
import { ConfirmAction } from "@/components/people/confirm-action";
import { removeFactoryAction } from "../actions";

export const metadata = { title: "Factory" };

export default async function FactoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requirePermission("sourcing.manage");
  const f = await load(() => api.get<FactoryDetail>(`/factories/${id}`));
  const history = await api.get<HistoryEntry[]>("/history", { type: "factory", id });
  const canRemove = can(me, "inquiries.updateAny");
  return (
    <div>
      <PageHeader
        backHref="/factories"
        backLabel="Factories"
        title={f.name}
        description={[f.owner ? `Looked after by ${f.owner.name}` : "Nobody looks after it yet", f.contactPerson]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <ButtonLink href={`/factories/${f.id}/edit`} size="sm">
            Edit factory
          </ButtonLink>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Price quotes" description="Prices this factory gave on our deals, newest first" />
            {f.quotes.length === 0 ? (
              <EmptyState title="No prices yet" description="Prices are recorded on a deal, under Factory prices." className="py-8" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Deal</Th>
                    <Th className="text-right">Lines</Th>
                    <Th className="text-right">Currency</Th>
                    <Th className="text-right">Received</Th>
                  </tr>
                </THead>
                <tbody>
                  {f.quotes.map((q) => (
                    <Tr key={q.id} className="hover:bg-surface-2/50">
                      <Td>
                        <Link href={`/deals/${q.inquiry.id}/sourcing`} className="font-medium hover:text-primary">
                          {q.inquiry.refNo}
                        </Link>
                        <span className="block max-w-80 truncate text-xs text-muted">{q.inquiry.title}</span>
                      </Td>
                      <Td className="text-right tabular">{q._count.lines}</Td>
                      <Td className="text-right text-sm">{q.currency}</Td>
                      <Td className="text-right text-xs whitespace-nowrap text-muted">{date(q.receivedOn)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <aside className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DetailList
                columns={1}
                items={[
                  { label: "Looked after by", value: f.owner?.name ?? "Nobody yet" },
                  { label: "Contact person", value: f.contactPerson },
                  {
                    label: "Phone",
                    value: f.phone && (
                      <a href={`tel:${f.phone}`} className="hover:underline">
                        {f.phone}
                      </a>
                    ),
                  },
                  { label: "WeChat", value: f.wechat },
                  {
                    label: "Email",
                    value: f.email && (
                      <a href={`mailto:${f.email}`} className="break-all hover:underline">
                        {f.email}
                      </a>
                    ),
                  },
                  { label: "Address", value: f.address && <span className="whitespace-pre-line">{f.address}</span> },
                  { label: "Bank details", value: f.bankDetails && <span className="whitespace-pre-line">{f.bankDetails}</span> },
                  { label: "Notes", value: f.notes && <span className="whitespace-pre-line">{f.notes}</span>, hidden: !f.notes },
                  { label: "Added", value: date(f.createdAt) },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" description="Changes to this factory, with the reason when one was asked" />
            <CardBody>
              <HistoryList entries={history} />
            </CardBody>
          </Card>
          {canRemove && (
            <Card>
              <CardHeader title="Remove factory" description="Hides it from lists and pickers. Its past prices stay on their deals." />
              <CardBody>
                <ConfirmAction
                  action={removeFactoryAction.bind(null, f.id)}
                  confirm={`Remove ${f.name}? It will no longer appear in lists and pickers.`}
                  label="Remove this factory"
                  pendingText="Removing…"
                  variant="danger-ghost"
                />
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
