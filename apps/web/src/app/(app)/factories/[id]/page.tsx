import Link from "next/link";
import { can, EXPENSE_CATEGORY_LABEL } from "@kebo/shared";
import { ButtonLink, Card, CardBody, CardHeader, DetailList, EmptyState, LinkTabs, PageHeader, Table, Td, Th, THead, Tr } from "@kebo/ui";
import { api } from "@/lib/api";
import { load, requirePermission, hasFeature } from "@/lib/session";
import { date, money } from "@/lib/format";
import type { ExpenseList } from "@/lib/types-money";
import type { FactoryDetail } from "@/lib/types-people";
import type { HistoryEntry } from "@/lib/types";
import { HistoryList } from "@/components/common/history-list";
import { ConfirmAction } from "@/components/people/confirm-action";
import { removeFactoryAction } from "../actions";

export const metadata = { title: "Factory" };

type Tab = "prices" | "costs" | "details" | "history";

export default async function FactoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requirePermission("sourcing.manage");
  const managers = can(me, "expenses.manage") && (await hasFeature("expenses"));
  const tabs: Tab[] = ["prices", ...(managers ? (["costs"] as const) : []), "details", "history"];
  const tab: Tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : "prices";
  const f = await load(() => api.get<FactoryDetail>(`/factories/${id}`));
  const history = tab === "history" ? await api.get<HistoryEntry[]>("/history", { type: "factory", id }) : [];
  const costs = tab === "costs" ? await api.get<ExpenseList>("/expenses", { factoryId: id }) : null;
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
      <LinkTabs
        label="Factory sections"
        className="mb-5"
        tabs={[
          { href: `/factories/${f.id}`, label: "Price quotes", count: f.quotes.length, active: tab === "prices" },
          ...(managers ? [{ href: `/factories/${f.id}?tab=costs`, label: "Visits and costs", active: tab === "costs" }] : []),
          { href: `/factories/${f.id}?tab=details`, label: "Details", active: tab === "details" },
          { href: `/factories/${f.id}?tab=history`, label: "History", active: tab === "history" },
        ]}
      />
      {tab === "prices" && (
          <Card>
            <CardHeader title="Price quotes" description="Prices this factory gave on our inquiries, newest first" />
            {f.quotes.length === 0 ? (
              <EmptyState title="No prices yet" description="Prices are recorded on an inquiry, under Factory prices." className="py-8" />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <Th>Inquiry</Th>
                    <Th className="text-right">Lines</Th>
                    <Th className="text-right">Currency</Th>
                    <Th className="text-right">Received</Th>
                  </tr>
                </THead>
                <tbody>
                  {f.quotes.map((q) => (
                    <Tr key={q.id} className="hover:bg-surface-2/50">
                      <Td>
                        <Link href={`/inquiries/${q.inquiry.id}/sourcing`} className="font-medium hover:text-primary">
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
      )}
      {tab === "costs" && costs && (
        <Card>
          <CardHeader
            title="Visits and costs"
            description="Managers only. Expenses that name this factory: trips to check its products, inspections there."
            actions={<span className="text-sm font-semibold tabular">{money(costs.total, costs.currency)}</span>}
          />
          {costs.rows.length === 0 ? (
            <EmptyState title="Nothing spent here yet" description="When adding an expense, choose this factory under Factory visited." className="py-8" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Date</Th>
                  <Th>What for</Th>
                  <Th>For</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </THead>
              <tbody>
                {costs.rows.map((e) => (
                  <Tr key={e.id} className={e.voided ? "text-muted line-through" : undefined}>
                    <Td className="text-sm whitespace-nowrap">{date(e.spentOn)}</Td>
                    <Td>
                      <span className="text-sm">{e.description}</span>
                      <span className="block text-xs text-muted">{EXPENSE_CATEGORY_LABEL[e.category]}</span>
                    </Td>
                    <Td className="text-sm">
                      {e.deal ? (
                        <Link href={`/inquiries/${e.deal.id}`} className="hover:text-primary">
                          {e.deal.refNo}
                        </Link>
                      ) : e.order ? (
                        <Link href={`/orders/${e.order.id}/money`} className="hover:text-primary">
                          {e.order.refNo}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {e.customer && <span className="block text-xs text-muted">{e.customer.name}</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">{money(e.amount, e.currency)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      {tab === "details" && (
        <div className="grid items-start gap-5 lg:grid-cols-2">
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
          {canRemove && (
            <Card>
              <CardHeader title="Remove factory" description="Hides it from lists and pickers. Its past prices stay on their inquiries." />
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
        </div>
      )}
      {tab === "history" && (
          <Card>
            <CardHeader title="History" description="Changes to this factory, with the reason when one was asked" />
            <CardBody>
              <HistoryList entries={history} />
            </CardBody>
          </Card>
      )}
    </div>
  );
}
