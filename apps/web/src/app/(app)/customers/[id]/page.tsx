import { redirect } from "next/navigation";
import { can, PARTY_TYPE_LABEL, UNKNOWN_COUNTRY } from "@kebo/shared";
import { Card, CardBody, CardHeader, RefCode, StatRow, StatTile, StatusBadge, Table, Td, Th, THead, Tr, ButtonLink, EmptyLine } from "@kebo/ui";
import { ArrowRight } from "lucide-react";
import { ORDER_WORD_TONE } from "@kebo/shared";
import { customerPaymentsOf } from "@/lib/party-data";
import { date, whole } from "@/lib/format";

import { hasFeature, requireUser } from "@/lib/session";
import { api } from "@/lib/api";
import type { OrderGroups } from "@/lib/types-facts";
import { customerOf } from "@/lib/party-data";
import { countryName } from "@/lib/countries";
import { OpenPanelButton } from "@/components/common/panel";
import { DetailsCard } from "@/components/common/record";
import { RecordLanding } from "@/components/common/record-nav";
import { getSettings } from "@/lib/loaders";
import { saveCustomerAction } from "../actions";

import { CustomerPanel } from "../customer-panel";
import { currenciesFrom } from "../currencies";
import { customerTitle } from "@/lib/titles";
import { BoxNote } from "@/components/common/record-box";
import { dataOf, failedWhat, part } from "@/lib/part";
import { CouldNotLoad } from "@/components/common/could-not-load";

export const generateMetadata = customerTitle();

/** Old ?tab= links and the history panel → the tab that has them now. */
const TAB_OF: Record<string, string> = {
  inquiries: "inquiries",
  deals: "inquiries",
  orders: "orders",
  money: "money",
  payments: "money",
  account: "money#where",
  history: "notes",
  contacts: "contacts",
};

/**
 * The customer's Overview tab: Performance (from Insights) and Details with ✎ Edit (the side panel), the
 * primary contact among them. Contacts, orders, inquiries, money and notes each have their own tab.
 */
export default async function CustomerOverview({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const old = sp.tab ? TAB_OF[sp.tab] : sp.panel === "history" ? "notes" : undefined;
  if (old) redirect(`/customers/${id}/${old}`);
  const me = await requireUser();
  const canEdit = can(me, "customers.manage");
  const editing = canEdit && sp.panel === "edit-customer";
  const insights = can(me, "reports.view") && (await hasFeature("insights"));
  const [c, settings, pay, groupsPart] = await Promise.all([
    customerOf(id),
    editing ? getSettings() : null,
    customerPaymentsOf(id),
    insights
      ? part("what they bought", () => api.get<OrderGroups>("/insights/facts/orders/groups", { period: "all", by: "company", customerId: id }))
      : null,
  ]);
  const groups = dataOf(groupsPart);
  const failed = failedWhat(groupsPart);
  const facts = groups?.rows[0];
  const latest = [...(pay?.orders ?? [])].sort((a, b) => b.orderedOn.localeCompare(a.orderedOn)).slice(0, 5);
  const openOrders = c.orders.filter((o) => o.status === "open").length;
  const won = c.inquiries.filter((d) => d.stage === "won").length;
  const lost = c.inquiries.filter((d) => d.stage === "lost").length;
  const countryKnown = c.country !== UNKNOWN_COUNTRY;

  return (
    <div className="flex flex-col gap-4">
      <RecordLanding />
      {failed && <CouldNotLoad what={failed} />}
      <StatRow facts>
        <StatTile label="Orders" value={c.orders.filter((o) => o.status !== "cancelled").length} sub={`${openOrders} open`} />
        <StatTile
          label="Win rate"
          value={won + lost ? `${Math.round((won / (won + lost)) * 100)}%` : "—"}
          sub={`${won} of ${won + lost} inquiries`}
        />
        <StatTile
          label="Avg. days to pay"
          value={facts?.daysToPay === null || facts?.daysToPay === undefined ? "—" : String(Math.round(facts.daysToPay))}
          sub="order to paid in full"
        />
        <StatTile
          label="Margin"
          value={facts?.marginQuote === null || facts?.marginQuote === undefined ? "—" : `${Math.round(facts.marginQuote * 10) / 10}%`}
          sub="on their orders"
        />
      </StatRow>
          <DetailsCard
            flash={sp.saved === c.id}
            edit={canEdit ? { panel: "edit-customer", id: c.id, label: `Edit ${c.name}` } : null}
            items={[
              { label: "Type", value: PARTY_TYPE_LABEL[c.type] },
              { label: "Country", value: countryKnown ? countryName(c.country) : null },
              { label: "Default currency", value: c.defaultCurrency },
              { label: "Address", value: c.address && <span className="whitespace-pre-line">{c.address}</span>, wide: true },
              { label: "Initials on documents", value: c.initials },
              { label: "Tax no.", value: c.taxNo },
              { label: "Registration no.", value: c.regNo },
              { label: "Notes", value: c.notes && <span className="whitespace-pre-line">{c.notes}</span>, wide: true },
            ]}
            footer={
              <>
                {!countryKnown && (
                  <BoxNote tone="warn">
                    Their country is not set yet — it decides shipping.{" "}
                    {canEdit ? (
                      <OpenPanelButton panel="edit-customer" id={c.id} variant="link" size="sm" className="h-auto font-semibold">
                        Add it
                      </OpenPanelButton>
                    ) : (
                      "Ask someone who manages customers to add it."
                    )}
                  </BoxNote>
                )}
              </>
            }
          />
          {/* Latest orders (board): number, date, total, what they owe, stage. */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Latest orders"
              actions={
                <ButtonLink href={`/customers/${c.id}/orders`} variant="link" size="sm">
                  <ArrowRight aria-hidden /> All orders
                </ButtonLink>
              }
            />
            {latest.length ? (
              <Table>
                <THead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Date</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">They owe</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {latest.map((o) => (
                    <Tr key={o.id} href={`/orders/${o.id}`}>
                      <Td>
                        <RefCode href={`/orders/${o.id}`}>{o.refNo}</RefCode>
                      </Td>
                      <Td className="whitespace-nowrap">{date(o.orderedOn)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{whole(o.total, o.currency)}</Td>
                      <Td className="text-right whitespace-nowrap tabular">{Number(o.due) > 0.005 ? whole(o.due, o.currency) : "—"}</Td>
                      <Td>
                        <StatusBadge meaning={ORDER_WORD_TONE[o.word]}>{o.word}</StatusBadge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <CardBody>
                <EmptyLine>No orders yet. An order is made when they accept a quotation.</EmptyLine>
              </CardBody>
            )}
          </Card>
      {editing && settings && (
        <CustomerPanel action={saveCustomerAction.bind(null, c.id, c.updatedAt)} customer={c} currencies={currenciesFrom(settings)} onRecord />
      )}
    </div>
  );
}
